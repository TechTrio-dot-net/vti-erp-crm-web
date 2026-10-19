import crypto from 'crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { callLogs, leads, type CallDirection, type CallSource } from '../db/schema';
import { normalizePhone } from '../lib/crm';

export interface IncomingCall {
  phone: string;
  direction: CallDirection;
  startedAt: Date;
  durationSec: number;
  contactName?: string | null;
}

/** A call "connected" when someone actually talked */
export const isConnected = (c: { direction: string; durationSec: number }) =>
  (c.direction === 'outgoing' || c.direction === 'incoming') && c.durationSec > 0;

/**
 * Finds the lead a phone number belongs to: the caller's own open lead first, then any open lead,
 * then the most recent lead with that number.
 */
async function matchLeads(userId: string | null, phones: string[]) {
  if (!phones.length) return new Map<string, { id: string; assignedTo: string | null }>();
  const rows = await db
    .select({ id: leads.id, phone: leads.phoneNormalized, assignedTo: leads.assignedTo, stage: leads.stage, createdAt: leads.createdAt })
    .from(leads)
    .where(inArray(leads.phoneNormalized, phones))
    .orderBy(desc(leads.createdAt));
  const rank = (l: (typeof rows)[number]) => (l.assignedTo === userId ? 0 : 2) + (l.stage === 'WON' || l.stage === 'LOST' ? 1 : 0);
  const best = new Map<string, (typeof rows)[number]>();
  for (const l of rows) {
    const current = best.get(l.phone!);
    if (!current || rank(l) < rank(current)) best.set(l.phone!, l);
  }
  return new Map([...best].map(([phone, l]) => [phone, { id: l.id, assignedTo: l.assignedTo }]));
}

/**
 * Marks the lead as contacted after a connected call by its owner: first/last contact times and
 * New → Contacted. Calls from before the lead was assigned don't count as the first response.
 */
export async function applyCallToLead(leadId: string, call: { userId: string | null; direction: string; durationSec: number; startedAt: Date }) {
  if (!isConnected(call)) return;
  await db
    .update(leads)
    .set({
      lastContactAt: sql`GREATEST(coalesce(${leads.lastContactAt}, ${call.startedAt}), ${call.startedAt})`,
      firstContactAt: sql`CASE WHEN ${leads.firstContactAt} IS NULL AND (${leads.assignedAt} IS NULL OR ${call.startedAt} >= ${leads.assignedAt} - interval '5 minutes')
        THEN ${call.startedAt} ELSE ${leads.firstContactAt} END`,
      stage: sql`CASE WHEN ${leads.stage} = 'AWARENESS' THEN 'CONTACTED' ELSE ${leads.stage} END`,
    })
    .where(and(eq(leads.id, leadId), call.userId ? sql`(${leads.assignedTo} = ${call.userId} OR ${leads.assignedTo} IS NULL)` : undefined));
}

export const deviceCallId = (userId: string, c: IncomingCall) =>
  crypto
    .createHash('sha1')
    .update([userId, normalizePhone(c.phone) ?? c.phone, c.startedAt.getTime(), c.durationSec, c.direction].join('|'))
    .digest('hex');

/** Stores calls from a phone, skipping ones already synced, and links them to leads */
export async function recordDeviceCalls(userId: string, deviceId: string, incoming: IncomingCall[], options: { leadsOnly?: boolean } = {}) {
  const phones = [...new Set(incoming.map((c) => normalizePhone(c.phone)).filter((p): p is string => !!p))];
  const matches = await matchLeads(userId, phones);
  // Personal phones: keep only calls with numbers that are CRM leads (other numbers never reach the database)
  const calls = options.leadsOnly ? incoming.filter((c) => matches.has(normalizePhone(c.phone) ?? '')) : incoming;
  const values = calls.map((c) => {
    const phoneNormalized = normalizePhone(c.phone);
    return {
      source: 'device' as CallSource,
      externalId: deviceCallId(userId, c),
      userId,
      leadId: phoneNormalized ? matches.get(phoneNormalized)?.id ?? null : null,
      phone: c.phone,
      phoneNormalized,
      contactName: c.contactName ?? null,
      direction: c.direction,
      status: 'completed',
      startedAt: c.startedAt,
      durationSec: Math.max(0, Math.round(c.durationSec)),
      deviceId,
    };
  });

  const inserted: Array<{ leadId: string | null; direction: string; durationSec: number; startedAt: Date }> = [];
  for (let i = 0; i < values.length; i += 500) {
    const rows = await db
      .insert(callLogs)
      .values(values.slice(i, i + 500))
      .onConflictDoNothing()
      .returning({ leadId: callLogs.leadId, direction: callLogs.direction, durationSec: callLogs.durationSec, startedAt: callLogs.startedAt });
    inserted.push(...rows);
  }
  for (const call of inserted.filter((c) => c.leadId).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())) {
    await applyCallToLead(call.leadId!, { ...call, userId });
  }
  return {
    received: incoming.length,
    skippedPersonal: incoming.length - calls.length,
    inserted: inserted.length,
    matched: inserted.filter((c) => c.leadId).length,
    connected: inserted.filter(isConnected).length,
  };
}

/** Links earlier unmatched calls to a lead once it exists (e.g. created from an unknown number) */
export async function linkCallsToLead(leadId: string, phoneNormalized: string | null) {
  if (!phoneNormalized) return 0;
  const linked = await db
    .update(callLogs)
    .set({ leadId })
    .where(and(eq(callLogs.phoneNormalized, phoneNormalized), sql`${callLogs.leadId} IS NULL`))
    .returning({ userId: callLogs.userId, direction: callLogs.direction, durationSec: callLogs.durationSec, startedAt: callLogs.startedAt });
  for (const c of linked) await applyCallToLead(leadId, c);
  return linked.length;
}

export { matchLeads };
