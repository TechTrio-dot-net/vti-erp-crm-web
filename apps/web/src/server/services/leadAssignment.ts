import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { campaignBdmRules, leadAssignments, leadSourceBdms, leads, users, type AssignmentReason } from '../db/schema';
import { APP_TIMEZONE, BDM_ROLE, CLOSED_STAGES } from '../lib/crm';
import { notifyUsers } from './activityService';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

/**
 * Round-robin pick: among active BDMs who are Started (in rotation) and not on leave today, the one who
 * received a lead longest ago. The row is locked and stamped in the same statement, so concurrent intakes
 * (sheet sync + webhook + manual) never hand two leads to the same person out of turn. The stamp is the real
 * clock, not now(): now() stays at the transaction's start, so a batch handed out in one transaction would
 * give everyone the same stamp after the first round and the rest would all go to one person.
 */
async function claimNextBdm(tx: Tx, restrictTo?: string[], excludeUserId?: string): Promise<string | null> {
  const restriction = restrictTo?.length ? sql`AND u.id IN (${sql.join(restrictTo.map((id) => sql`${id}`), sql`, `)})` : sql``;
  const exclusion = excludeUserId ? sql`AND u.id <> ${excludeUserId}` : sql``;
  const result = await tx.execute<{ id: string }>(sql`
    UPDATE users SET last_assigned_at = clock_timestamp()
    WHERE id = (
      SELECT u.id FROM users u
      WHERE u.role = ${BDM_ROLE} AND u.is_active AND u.in_rotation
        AND NOT EXISTS (
          SELECT 1 FROM bdm_leaves l
          WHERE l.user_id = u.id AND (now() AT TIME ZONE ${APP_TIMEZONE})::date BETWEEN l.from_date AND l.to_date
        )
        ${restriction}
        ${exclusion}
      ORDER BY u.last_assigned_at ASC NULLS FIRST, u.rotation_position ASC, u.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`);
  return result.rows[0]?.id ?? null;
}

/**
 * Who gets the next lead:
 * 1. campaign rule → rotation among that campaign's BDMs (falls through if none of them is online)
 * 2. source team (e.g. "Sheet B → 2 BDMs") → rotation among that team only; if nobody in the team is
 *    online the lead waits unassigned and is handed out when one of them presses Start
 * 3. otherwise → rotation among every online BDM
 */
export async function pickBdm(
  tx: Tx,
  opts: { campaign?: string | null; sourceId?: string | null; excludeUserId?: string } = {}
): Promise<{ userId: string | null; reason: AssignmentReason }> {
  const { campaign, sourceId, excludeUserId } = opts;
  if (campaign) {
    const rules = await tx.select({ userId: campaignBdmRules.userId }).from(campaignBdmRules).where(eq(campaignBdmRules.campaign, campaign));
    if (rules.length) {
      const userId = await claimNextBdm(tx, rules.map((r) => r.userId), excludeUserId);
      if (userId) return { userId, reason: 'campaign' };
    }
  }
  if (sourceId) {
    const team = await tx.select({ userId: leadSourceBdms.userId }).from(leadSourceBdms).where(eq(leadSourceBdms.sourceId, sourceId));
    if (team.length) {
      return { userId: await claimNextBdm(tx, team.map((t) => t.userId), excludeUserId), reason: 'auto' };
    }
  }
  return { userId: await claimNextBdm(tx, undefined, excludeUserId), reason: 'auto' };
}

/**
 * How long a waiting backlog is held after the first BDM comes online, so the rest of the team can press
 * Start and share it. Without this the first person online got every waiting lead (97 to one BDM, once).
 */
export const WAITING_GRACE_MS = 10 * 60_000;

/** True while the team is still coming online: every open Start session began within the grace period */
async function teamStillStarting(): Promise<boolean> {
  const result = await db.execute<{ first: Date | string | null }>(sql`
    SELECT min(s.started_at) AS first FROM bdm_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.ended_at IS NULL AND u.role = ${BDM_ROLE} AND u.is_active AND u.in_rotation`);
  const first = result.rows[0]?.first;
  return !!first && Date.now() - new Date(first).getTime() < WAITING_GRACE_MS;
}

/**
 * Hands out leads that arrived while nobody eligible was online (never assigned before — leads an admin
 * deliberately unassigned are left alone). Runs when a BDM presses Start and with every sheet sync. While
 * the team is still coming online the backlog is held (see WAITING_GRACE_MS), then shared in turn among
 * everyone who is online; `force` hands it out at once.
 */
export async function assignWaitingLeads(options: { force?: boolean } = {}): Promise<number> {
  if (!options.force && (await teamStillStarting())) return 0;
  const byUser: Record<string, number> = {};
  await db.transaction(async (tx) => {
    const waiting = await tx
      .select({ id: leads.id, campaign: leads.campaign, sourceId: leads.sourceId })
      .from(leads)
      .where(
        and(
          sql`${leads.assignedTo} IS NULL`,
          sql`${leads.stage} NOT IN (${sql.join(CLOSED_STAGES.map((s) => sql`${s}`), sql`, `)})`,
          sql`NOT EXISTS (SELECT 1 FROM lead_assignments a WHERE a.lead_id = ${leads.id})`
        )
      )
      .orderBy(leads.createdAt)
      .limit(500)
      .for('update', { skipLocked: true });
    for (const lead of waiting) {
      const picked = await pickBdm(tx, { campaign: lead.campaign, sourceId: lead.sourceId });
      if (!picked.userId) continue;
      await assignLead(tx, { leadId: lead.id, fromUserId: null, toUserId: picked.userId, reason: picked.reason, note: 'Waiting lead' });
      byUser[picked.userId] = (byUser[picked.userId] ?? 0) + 1;
    }
  });
  await notifyAssignees(Object.entries(byUser).map(([userId, count]) => ({ userId, count })));
  return Object.values(byUser).reduce((a, b) => a + b, 0);
}

/** Sets the owner and records the hand-over. Does not notify — call notifyAssignees after commit. */
export async function assignLead(
  executor: Executor,
  params: { leadId: string; fromUserId: string | null; toUserId: string | null; reason: AssignmentReason; byUserId?: string | null; note?: string }
): Promise<void> {
  await executor
    .update(leads)
    .set({ assignedTo: params.toUserId, assignedAt: params.toUserId ? new Date() : null })
    .where(eq(leads.id, params.leadId));
  await executor.insert(leadAssignments).values({
    leadId: params.leadId,
    fromUserId: params.fromUserId,
    toUserId: params.toUserId,
    reason: params.reason,
    byUserId: params.byUserId ?? null,
    note: params.note,
  });
}

export async function notifyAssignees(assigned: Array<{ userId: string; count: number; sample?: string }>): Promise<void> {
  await Promise.all(
    assigned
      .filter((a) => a.count > 0)
      .map((a) =>
        notifyUsers([a.userId], {
          title: a.count === 1 ? 'New lead assigned' : `${a.count} leads assigned to you`,
          body: a.sample,
          type: 'lead-assigned',
          link: '/crm/leads',
        })
      )
  );
}

/**
 * Moves a BDM's leads to another BDM, or back through the rotation when `toUserId` is "rotation".
 * `onlyPending` limits to leads nobody has contacted yet.
 */
export async function transferLeads(params: {
  fromUserId: string;
  toUserId: string | 'rotation';
  leadIds?: string[];
  onlyPending?: boolean;
  reason: AssignmentReason;
  byUserId: string;
  note?: string;
}): Promise<{ moved: number; byUser: Record<string, number> }> {
  const byUser: Record<string, number> = {};
  const moved = await db.transaction(async (tx) => {
    const conditions = [
      eq(leads.assignedTo, params.fromUserId),
      sql`${leads.stage} NOT IN (${sql.join(CLOSED_STAGES.map((s) => sql`${s}`), sql`, `)})`,
    ];
    if (params.leadIds?.length) conditions.push(inArray(leads.id, params.leadIds));
    if (params.onlyPending) conditions.push(sql`${leads.firstContactAt} IS NULL`);
    const rows = await tx.select({ id: leads.id, campaign: leads.campaign, sourceId: leads.sourceId }).from(leads).where(and(...conditions)).for('update');

    for (const lead of rows) {
      let toUserId: string | null;
      if (params.toUserId === 'rotation') {
        // Never hand a lead back to the person it is being moved away from
        toUserId = (await pickBdm(tx, { campaign: lead.campaign, sourceId: lead.sourceId, excludeUserId: params.fromUserId })).userId;
        if (!toUserId) break; // nobody else available — leave the rest where they are
      } else {
        toUserId = params.toUserId;
      }
      await assignLead(tx, { leadId: lead.id, fromUserId: params.fromUserId, toUserId, reason: params.reason, byUserId: params.byUserId, note: params.note });
      byUser[toUserId] = (byUser[toUserId] ?? 0) + 1;
    }
    return Object.values(byUser).reduce((a, b) => a + b, 0);
  });
  await notifyAssignees(Object.entries(byUser).map(([userId, count]) => ({ userId, count, sample: params.note })));
  return { moved, byUser };
}

/** Active BDM ids — used to validate assignment targets */
export async function isAssignableBdm(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true), inArray(users.role, [BDM_ROLE, 'SUPER_ADMIN', 'MANAGEMENT'])))
    .limit(1);
  return !!row;
}
