import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { leadFollowups, leads, type BusinessType, type FollowupOutcome, type LeadStage } from '../db/schema';
import { CLOSED_STAGES } from '../lib/crm';
import { HttpError, optionalDate } from '../lib/http';

export const STAGES: LeadStage[] = ['AWARENESS', 'CONTACTED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'];
export const OUTCOMES: FollowupOutcome[] = ['CONNECTED', 'CALL_BACK', 'NOT_REACHABLE', 'INTERESTED', 'NOT_INTERESTED', 'CONVERTED', 'LOST'];
const STAGE_ORDER: Record<string, number> = { AWARENESS: 0, CONTACTED: 1, PROPOSAL: 2, NEGOTIATION: 3, WON: 4, LOST: 4 };

/** Labels as the website shows them (apps/web/src/lib/crm.ts), for the phone app's form */
export const STAGE_LABELS: Record<LeadStage, string> = {
  AWARENESS: 'New', CONTACTED: 'Contacted', PROPOSAL: 'Interested', NEGOTIATION: 'Negotiation', WON: 'Won', LOST: 'Lost',
};
export const OUTCOME_LABELS: Record<FollowupOutcome, string> = {
  CONNECTED: 'Connected', CALL_BACK: 'Call back', NOT_REACHABLE: 'Not reachable', INTERESTED: 'Interested',
  NOT_INTERESTED: 'Not interested', CONVERTED: 'Converted (won)', LOST: 'Lost',
};
export const LOST_REASONS = ['Price too high', 'Not interested', 'Chose competitor', 'Not reachable', 'Location / timing', 'Duplicate / invalid', 'Other'];

type LeadRow = typeof leads.$inferSelect;

export interface FollowupInput {
  outcome: unknown;
  note?: unknown;
  nextFollowupAt?: unknown;
  estimatedValue?: unknown;
  lostReason?: unknown;
  stage?: unknown;
  /** Call details: what happened, the status in the BDM's words, how long, and why it was lost */
  callActivity?: string | null;
  statusLabel?: string | null;
  callDurationSec?: number | null;
  reason?: string | null;
  /** After-call form answers */
  connected?: boolean;
  interested?: boolean;
  sampleShared?: boolean;
  businessType?: BusinessType;
}

/**
 * Logs a call / follow-up on a lead and moves the lead along: first/last contact, stage (Connected →
 * Contacted, Interested → Interested, Converted → Won, Lost / Not interested → Lost), the next follow-up
 * and reopening a closed lead. Used by the website's lead drawer and the phone app's after-call form.
 *
 * With a `clientRef` the same form sent twice (the phone retrying after a dropped connection) is saved
 * once; the result says whether this call saved it.
 */
export async function logFollowup(
  lead: LeadRow,
  userId: string,
  input: FollowupInput,
  extra: { source?: 'web' | 'phone'; callLogId?: string | null; clientRef?: string | null; at?: Date } = {}
): Promise<{ saved: boolean }> {
  const outcome = input.outcome as FollowupOutcome;
  if (!OUTCOMES.includes(outcome)) throw new HttpError(400, 'Choose a call outcome');
  const nextFollowupAt = optionalDate(input.nextFollowupAt, 'nextFollowupAt') ?? null;
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 5000) : '';
  const now = extra.at ?? new Date();

  const updates: Partial<typeof leads.$inferInsert> = {
    lastContactAt: now,
    firstContactAt: lead.firstContactAt ?? now,
    nextFollowupAt,
    updatedBy: userId,
  };
  const advanceTo = (stage: LeadStage) => {
    if (STAGE_ORDER[stage] > STAGE_ORDER[lead.stage]) updates.stage = stage;
  };
  if (outcome === 'CONNECTED' || outcome === 'CALL_BACK') advanceTo('CONTACTED');
  if (outcome === 'INTERESTED') advanceTo('PROPOSAL');
  if (outcome === 'CONVERTED') {
    updates.stage = 'WON';
    updates.closedAt = now;
    updates.nextFollowupAt = null;
    if (input.estimatedValue !== undefined && input.estimatedValue !== null && input.estimatedValue !== '') {
      updates.estimatedValue = Number(input.estimatedValue) || 0;
    }
  }
  if (outcome === 'LOST' || outcome === 'NOT_INTERESTED') {
    updates.stage = 'LOST';
    updates.closedAt = now;
    updates.nextFollowupAt = null;
    updates.lostReason = (typeof input.lostReason === 'string' && input.lostReason.trim()) || (outcome === 'NOT_INTERESTED' ? 'Not interested' : 'Other');
  }
  if (input.businessType) updates.businessType = input.businessType;
  if (input.sampleShared && !lead.sampleSharedAt) updates.sampleSharedAt = now;
  if (typeof input.stage === 'string' && STAGES.includes(input.stage as LeadStage)) {
    updates.stage = input.stage as LeadStage;
    updates.closedAt = CLOSED_STAGES.includes(input.stage as (typeof CLOSED_STAGES)[number]) ? now : null;
  }
  // The lead's status (as on the BDM dashboard) follows the call; a stage change without one ends the old status
  if (input.statusLabel) updates.statusLabel = input.statusLabel;
  else if (updates.stage && updates.stage !== lead.stage) updates.statusLabel = outcome === 'NOT_INTERESTED' ? 'Not Interested' : null;
  if (!CLOSED_STAGES.includes((updates.stage ?? lead.stage) as (typeof CLOSED_STAGES)[number]) && lead.closedAt) {
    updates.closedAt = null; // reopened
    updates.lostReason = null;
  }

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(leadFollowups)
      .values({
        leadId: lead.id,
        userId,
        outcome,
        note: note || null,
        nextFollowupAt: updates.nextFollowupAt ?? null,
        source: extra.source ?? 'web',
        callLogId: extra.callLogId ?? null,
        clientRef: extra.clientRef ?? null,
        callActivity: input.callActivity ?? null,
        statusLabel: input.statusLabel ?? null,
        callDurationSec: input.callDurationSec ?? null,
        reason: input.reason ?? (outcome === 'LOST' || outcome === 'NOT_INTERESTED' ? (updates.lostReason ?? null) : null),
        connected: input.connected ?? null,
        interested: input.interested ?? null,
        sampleShared: input.sampleShared ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: leadFollowups.id });
    if (!inserted.length) return { saved: false };
    await tx.update(leads).set(updates).where(eq(leads.id, lead.id));
    return { saved: true };
  });
}
