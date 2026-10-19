import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../db/index';
import { callLogs, leadFollowups, leads, services, users, type BusinessType, type CallDirection, type FollowupOutcome } from '../db/schema';
import { BDM_ROLE, normalizePhone } from '../lib/crm';
import { HttpError, optionalId, pickColumns } from '../lib/http';
import { emitCrmUpdated } from '../lib/realtime';
import type { Role } from '../lib/auth';
import { deviceCallId, linkCallsToLead, matchLeads, recordDeviceCalls, type IncomingCall } from './calls';
import { LOST_REASONS, OUTCOME_LABELS, OUTCOMES, STAGE_LABELS, STAGES, logFollowup, type FollowupInput } from './followups';
import { intakeLead } from './leadIntake';
import { leadQuery } from './leadQueries';

/**
 * The phone app's after-call form. When a call ends the app shows who was called (lookup), the BDM picks
 * what happened and when to follow up, and one request (submit) stores the call, creates the lead for a new
 * number if asked, updates the lead's details and logs the follow-up — the same rules as the website.
 */

type Actor = { id: string; role: Role };

const DIRECTIONS: CallDirection[] = ['outgoing', 'incoming', 'missed', 'rejected'];

/** BDMs work only on their own leads; CRM admins and managers on any */
const mayActOn = (actor: Actor, lead: { assignedTo: string | null }) => actor.role !== BDM_ROLE || lead.assignedTo === actor.id;

let servicesCache: { at: number; rows: Array<{ id: string; name: string }> } | null = null;
async function activeServices() {
  if (servicesCache && Date.now() - servicesCache.at < 5 * 60_000) return servicesCache.rows;
  const rows = await db.select({ id: services.id, name: services.name }).from(services).where(eq(services.active, true)).orderBy(asc(services.name));
  servicesCache = { at: Date.now(), rows };
  return rows;
}

/** Choices the form offers, with the website's labels */
export async function formOptions() {
  return {
    outcomes: OUTCOMES.map((key) => ({ key, label: OUTCOME_LABELS[key] })),
    stages: STAGES.map((key) => ({ key, label: STAGE_LABELS[key] })),
    lostReasons: LOST_REASONS,
    services: await activeServices(),
  };
}

async function findLeadForPhone(actor: Actor, phone: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) return { lead: null, otherOwner: false };
  const match = (await matchLeads(actor.id, [normalized])).get(normalized);
  if (!match) return { lead: null, otherOwner: false };
  if (!mayActOn(actor, match)) return { lead: null, otherOwner: true };
  const [lead] = await leadQuery().where(eq(leads.id, match.id));
  return { lead: lead ?? null, otherOwner: false };
}

/** Who the number belongs to, their last few follow-ups and the form's choices */
export async function lookupNumber(actor: Actor, phone: unknown) {
  if (typeof phone !== 'string' || !normalizePhone(phone)) throw new HttpError(400, 'A phone number is required');
  const [{ lead, otherOwner }, options] = await Promise.all([findLeadForPhone(actor, phone), formOptions()]);
  const history = lead
    ? await db
        .select({
          outcome: leadFollowups.outcome, note: leadFollowups.note, nextFollowupAt: leadFollowups.nextFollowupAt, createdAt: leadFollowups.createdAt, userName: users.name,
          callActivity: leadFollowups.callActivity, statusLabel: leadFollowups.statusLabel, callDurationSec: leadFollowups.callDurationSec, reason: leadFollowups.reason,
        })
        .from(leadFollowups)
        .leftJoin(users, eq(users.id, leadFollowups.userId))
        .where(eq(leadFollowups.leadId, lead.id))
        .orderBy(desc(leadFollowups.createdAt))
        .limit(3)
    : [];
  return {
    phone,
    lead: lead && {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      city: lead.city,
      service: lead.service,
      serviceId: lead.serviceId,
      stage: lead.stage,
      stageLabel: STAGE_LABELS[lead.stage as keyof typeof STAGE_LABELS] ?? lead.stage,
      estimatedValue: lead.estimatedValue,
      notes: lead.notes,
      source: lead.source,
      campaign: lead.campaign,
      assignedName: lead.assignedName,
      nextFollowupAt: lead.nextFollowupAt,
      lastContactAt: lead.lastContactAt,
      closedAt: lead.closedAt,
      businessType: lead.businessType,
      statusLabel: lead.statusLabel,
      lastRemark: lead.lastRemark,
      sampleSharedAt: lead.sampleSharedAt,
    },
    // Someone else's lead: BDMs aren't shown whose or what, only that they can't log on it
    otherOwner,
    history: history.map((h) => ({ ...h, outcomeLabel: OUTCOME_LABELS[h.outcome] ?? h.outcome })),
    options,
  };
}

function parseCall(raw: unknown): IncomingCall {
  const c = (raw ?? {}) as Record<string, unknown>;
  const startedAt = new Date(typeof c.startedAt === 'string' && !/^\d+$/.test(c.startedAt) ? c.startedAt : Number(c.startedAt));
  const direction = String(c.direction) as CallDirection;
  if (typeof c.phone !== 'string' || !normalizePhone(c.phone)) throw new HttpError(400, 'The call has no phone number');
  if (Number.isNaN(startedAt.getTime()) || startedAt.getTime() > Date.now() + 3600_000) throw new HttpError(400, 'Invalid call time');
  if (!DIRECTIONS.includes(direction)) throw new HttpError(400, 'Invalid call direction');
  return {
    phone: c.phone.trim().slice(0, 30),
    direction,
    startedAt,
    durationSec: Math.max(0, Math.round(Number(c.durationSec) || 0)),
    contactName: typeof c.contactName === 'string' ? c.contactName.slice(0, 120) : null,
  };
}

const text = (value: unknown, max = 200) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined);

export interface AfterCallBody {
  clientRef?: unknown;
  deviceId?: unknown;
  call?: unknown;
  leadId?: unknown;
  /** Unknown number: create a lead with these details (else only the call is stored) */
  newLead?: { name?: unknown; email?: unknown; city?: unknown; serviceId?: unknown; notes?: unknown } | null;
  /** Corrections to the existing lead's details */
  details?: { name?: unknown; email?: unknown; city?: unknown; serviceId?: unknown; estimatedValue?: unknown } | null;
  outcome?: unknown;
  note?: unknown;
  nextFollowupAt?: unknown;
  estimatedValue?: unknown;
  lostReason?: unknown;
  /** Personal / not a customer: store the call (unless the phone is set to leads only) and nothing else */
  skip?: unknown;
  /** The phone's "personal phone" setting: calls to numbers that aren't leads are never stored */
  leadsOnly?: unknown;
  /** 2 = the question form (connected, interested, sample, business type, follow-up within 72 hours) */
  form?: unknown;
  connected?: unknown;
  interested?: unknown;
  sampleShared?: unknown;
  businessType?: unknown;
}

/** The latest a follow-up may be set: 72 hours after the call ended */
export const FOLLOWUP_WINDOW_MS = 72 * 3600_000;
/** Slack for the phone's clock and the time between filling in the form and it arriving */
const CLOCK_SLACK_MS = 10 * 60_000;
const BUSINESS_TYPES: BusinessType[] = ['B2B', 'B2C'];

/**
 * Checks the question form's answers — every one is required — and turns them into the follow-up to log:
 * not connected → Not reachable, not interested → Lost with a reason, interested → Interested; any
 * follow-up must be set and fall within 72 hours of the call ending.
 */
export function questionFormFollowup(body: AfterCallBody, call: IncomingCall): FollowupInput {
  const yesNo = (value: unknown, question: string) => {
    if (typeof value !== 'boolean') throw new HttpError(400, question);
    return value;
  };
  const connected = yesNo(body.connected, 'Answer whether the call connected');
  const interested = connected ? yesNo(body.interested, 'Answer whether the customer is interested') : undefined;
  const sampleShared = interested ? yesNo(body.sampleShared, 'Answer whether a sample was shared') : undefined;
  if (!BUSINESS_TYPES.includes(body.businessType as BusinessType)) throw new HttpError(400, 'Choose the business type: B2B or B2C');
  const businessType = body.businessType as BusinessType;

  const outcome: FollowupOutcome = !connected ? 'NOT_REACHABLE' : interested ? 'INTERESTED' : 'NOT_INTERESTED';
  if (outcome === 'NOT_INTERESTED') {
    if (!text(body.lostReason)) throw new HttpError(400, 'Choose why the customer is not interested');
    return {
      outcome, note: body.note, lostReason: body.lostReason, connected, interested, businessType,
      callActivity: 'Connected', statusLabel: 'Not Interested', callDurationSec: call.durationSec, reason: text(body.lostReason) ?? null,
    };
  }

  const next = new Date(typeof body.nextFollowupAt === 'string' ? body.nextFollowupAt : NaN);
  if (Number.isNaN(next.getTime())) throw new HttpError(400, 'Set the next follow-up');
  const callEnd = call.startedAt.getTime() + call.durationSec * 1000;
  if (next.getTime() < callEnd - CLOCK_SLACK_MS) throw new HttpError(400, 'The next follow-up must be after the call');
  // A form filled in late (or saved offline and sent later) gets 72 hours from when it arrives
  if (next.getTime() > Math.max(callEnd, Date.now()) + FOLLOWUP_WINDOW_MS + CLOCK_SLACK_MS) {
    throw new HttpError(400, 'The next follow-up must be within 72 hours of the call');
  }
  return {
    outcome, note: body.note, nextFollowupAt: next.toISOString(), connected, interested, sampleShared, businessType,
    callActivity: connected ? 'Connected' : 'Not connected',
    statusLabel: !connected ? 'Not reachable' : sampleShared ? 'Interested · sample shared' : 'Interested',
    callDurationSec: call.durationSec,
  };
}

export async function submitAfterCall(actor: Actor, body: AfterCallBody) {
  const clientRef = text(body.clientRef, 100);
  if (!clientRef) throw new HttpError(400, 'clientRef is required');
  const deviceId = text(body.deviceId, 100);
  if (!deviceId) throw new HttpError(400, 'deviceId is required');
  const call = parseCall(body.call);
  const phoneNormalized = normalizePhone(call.phone);
  // Older app versions send a chosen outcome instead; the question form's answers are checked up front
  const questionForm = body.form === 2 && body.skip !== true ? questionFormFollowup(body, call) : null;

  // 1. The call itself — the same record the background sync creates, so it is never stored twice
  // (a new number the BDM turns into a lead below is stored even on a personal phone)
  await recordDeviceCalls(actor.id, deviceId, [call], { leadsOnly: body.leadsOnly === true && body.skip === true });
  const [callLog] = await db
    .select({ id: callLogs.id, leadId: callLogs.leadId })
    .from(callLogs)
    .where(and(eq(callLogs.source, 'device'), eq(callLogs.externalId, deviceCallId(actor.id, call))))
    .limit(1);

  if (body.skip === true) {
    emitCrmUpdated();
    return { status: 'call-only' as const, lead: null, saved: false };
  }

  // 2. Which lead: the one the form showed, else the number's lead, else a new one
  let leadId = optionalId(body.leadId, 'leadId') ?? null;
  let created = false;
  if (!leadId && phoneNormalized) {
    const match = (await matchLeads(actor.id, [phoneNormalized])).get(phoneNormalized);
    if (match) {
      if (!mayActOn(actor, match)) throw new HttpError(403, 'This number is another BDM\'s lead');
      leadId = match.id;
    }
  }
  if (!leadId) {
    const n = body.newLead;
    if (!n) throw new HttpError(400, 'This number isn\'t a lead yet — add the customer\'s name to create one, or choose Skip');
    const result = await intakeLead({
      name: text(n.name, 120) || call.contactName || call.phone,
      phone: call.phone,
      email: text(n.email, 200) ?? null,
      city: text(n.city, 100) ?? null,
      serviceId: optionalId(n.serviceId, 'serviceId') ?? null,
      notes: text(n.notes, 2000) ?? null,
      source: 'phone call',
      isManual: true,
      assignTo: actor.id,
      createdBy: actor.id,
      createdAt: call.startedAt,
    });
    leadId = result.leadId;
    created = result.status === 'created';
    await linkCallsToLead(leadId, phoneNormalized);
  }

  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new HttpError(404, 'Lead not found');
  if (!mayActOn(actor, lead)) throw new HttpError(403, 'This lead is assigned to someone else');

  // The call may have been synced before the lead existed, or matched to another lead with the same number
  if (callLog && callLog.leadId !== lead.id) await db.update(callLogs).set({ leadId: lead.id }).where(eq(callLogs.id, callLog.id));

  // 3. Corrected details (name, email, city, service, deal value)
  const d = body.details;
  if (d) {
    const updates: Partial<typeof leads.$inferInsert> = pickColumns(leads, { email: text(d.email, 200), city: text(d.city, 100), serviceId: optionalId(d.serviceId, 'serviceId'), estimatedValue: d.estimatedValue === '' || d.estimatedValue === undefined || d.estimatedValue === null ? undefined : Number(d.estimatedValue) || 0 }, ['email', 'city', 'serviceId', 'estimatedValue']);
    const name = text(d.name, 120);
    if (name) {
      updates.companyName = name;
      updates.contactName = name;
    }
    if (Object.keys(updates).length) await db.update(leads).set({ ...updates, updatedBy: actor.id }).where(eq(leads.id, lead.id));
  }

  // 4. The follow-up: outcome, note, next follow-up — moves the lead's stage like the website does
  const [fresh] = await db.select().from(leads).where(eq(leads.id, lead.id)).limit(1);
  const input: FollowupInput = questionForm
    ? questionForm
    : { outcome: body.outcome, note: body.note, nextFollowupAt: body.nextFollowupAt, estimatedValue: body.estimatedValue, lostReason: body.lostReason };
  const { saved } = await logFollowup(fresh, actor.id, input, { source: 'phone', callLogId: callLog?.id ?? null, clientRef });

  emitCrmUpdated();
  const [row] = await leadQuery().where(eq(leads.id, lead.id));
  return { status: created ? ('lead-created' as const) : ('updated' as const), lead: row, saved };
}
