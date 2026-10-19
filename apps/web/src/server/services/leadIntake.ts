import { and, desc, eq, notInArray, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { leads, type AssignmentReason } from '../db/schema';
import { BDM_ROLE, CLOSED_STAGES, normalizePhone } from '../lib/crm';
import { HttpError } from '../lib/http';
import { background } from '../lib/background';
import { assignLead, notifyAssignees, pickBdm } from './leadAssignment';

export interface IntakeInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  source?: string | null;
  campaign?: string | null;
  adName?: string | null;
  formName?: string | null;
  platform?: string | null;
  sourceId?: string | null;
  externalId?: string | null;
  serviceId?: string | null;
  service?: string | null;
  notes?: string | null;
  estimatedValue?: number | null;
  isManual?: boolean;
  /** Explicit owner; otherwise the rotation decides */
  assignTo?: string | null;
  createdBy?: string | null;
  /** When the lead was actually generated (e.g. Meta created_time) */
  createdAt?: Date | null;
  /** Import with no owner (recorded, so the waiting-leads job leaves it alone) */
  leaveUnassigned?: boolean;
  /** Old rows from before the source was connected: don't bump repeat leads or notify per lead */
  history?: boolean;
}

export type IntakeResult =
  | { status: 'created'; leadId: string; assignedTo: string | null }
  | { status: 'duplicate'; leadId: string; assignedTo: string | null };

/**
 * Single entry point for every new lead — Add Inquiry, Google Sheet rows and Meta leads.
 * A repeat enquiry from a mobile number that already has an open lead does not create a second lead: the
 * original gets a note and is due for follow-up now, so one customer is never called by two people.
 */
export async function intakeLead(input: IntakeInput): Promise<IntakeResult> {
  const name = input.name?.trim();
  if (!name) throw new HttpError(400, 'Name is required');
  const phoneNormalized = normalizePhone(input.phone);
  if (!phoneNormalized && !input.email?.trim()) throw new HttpError(400, 'A mobile number or email is required');

  const result = await db.transaction(async (tx) => {
    const [existing] = phoneNormalized
      ? await tx
          .select({ id: leads.id, assignedTo: leads.assignedTo })
          .from(leads)
          .where(and(eq(leads.phoneNormalized, phoneNormalized), notInArray(leads.stage, [...CLOSED_STAGES])))
          .orderBy(desc(leads.createdAt))
          .limit(1)
      : [];

    if (existing) {
      const stamp = (input.history && input.createdAt ? input.createdAt : new Date()).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
      const detail = [input.campaign && `campaign: ${input.campaign}`, input.source && `source: ${input.source}`].filter(Boolean).join(', ');
      await tx
        .update(leads)
        .set({
          notes: sql`concat_ws(E'\n', ${leads.notes}, ${`[${stamp}] Repeat enquiry${detail ? ` (${detail})` : ''}`}::text)`,
          ...(!input.history && { nextFollowupAt: new Date() }),
        })
        .where(eq(leads.id, existing.id));
      return { status: 'duplicate' as const, leadId: existing.id, assignedTo: existing.assignedTo };
    }

    const [lead] = await tx
      .insert(leads)
      .values({
        companyName: name,
        contactName: name,
        phone: input.phone?.toString().trim() || null,
        phoneNormalized,
        email: input.email?.trim().toLowerCase() || null,
        city: input.city?.trim() || null,
        source: input.source?.trim() || (input.isManual ? 'manual' : 'website'),
        campaign: input.campaign?.trim() || null,
        adName: input.adName?.trim() || null,
        formName: input.formName?.trim() || null,
        platform: input.platform?.trim() || null,
        sourceId: input.sourceId ?? null,
        externalId: input.externalId ?? null,
        serviceId: input.serviceId ?? null,
        service: input.service?.trim() || null,
        notes: input.notes?.trim() || null,
        estimatedValue: input.estimatedValue ?? 0,
        isManual: !!input.isManual,
        stage: 'AWARENESS',
        createdBy: input.createdBy ?? null,
        ...(input.createdAt && { createdAt: input.createdAt }),
      })
      .returning({ id: leads.id });

    let assignedTo: string | null = input.assignTo ?? null;
    let reason: AssignmentReason = 'manual';
    if (input.leaveUnassigned) {
      await assignLead(tx, { leadId: lead.id, fromUserId: null, toUserId: null, reason: 'manual', byUserId: input.createdBy, note: 'Imported without an owner' });
      return { status: 'created' as const, leadId: lead.id, assignedTo: null };
    }
    let note: string | undefined;
    if (!assignedTo && phoneNormalized) {
      // Same person for the same customer: a number that was a lead before (now won or lost) goes back to
      // the BDM who handled it, if they are still active, instead of to whoever is next in turn
      const previous = await tx.execute<{ id: string }>(sql`
        SELECT u.id FROM leads l JOIN users u ON u.id = l.assigned_to
        WHERE l.phone_normalized = ${phoneNormalized} AND l.id <> ${lead.id} AND u.is_active AND u.role = ${BDM_ROLE}
        ORDER BY l.created_at DESC LIMIT 1`);
      if (previous.rows[0]) {
        assignedTo = previous.rows[0].id;
        reason = 'auto';
        note = "Same BDM as this number's earlier lead";
      }
    }
    if (!assignedTo) {
      const picked = await pickBdm(tx, { campaign: input.campaign, sourceId: input.sourceId });
      assignedTo = picked.userId;
      reason = picked.reason;
    }
    if (assignedTo) {
      await assignLead(tx, { leadId: lead.id, fromUserId: null, toUserId: assignedTo, reason, byUserId: input.createdBy, note });
    }
    return { status: 'created' as const, leadId: lead.id, assignedTo };
  });

  if (input.history) return result;
  const sample = [name, input.phone, input.campaign].filter(Boolean).join(' · ');
  if (result.status === 'created' && result.assignedTo) {
    void background(notifyAssignees([{ userId: result.assignedTo, count: 1, sample }]), 'Lead notification');
  } else if (result.status === 'duplicate' && result.assignedTo) {
    void background(notifyAssignees([{ userId: result.assignedTo, count: 1, sample: `Repeat enquiry: ${sample}` }]), 'Lead notification');
  }
  return result;
}
