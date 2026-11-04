import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { leadRetargets, leads, services, users } from '../db/schema';
import { BDM_ROLE, todayLocal } from '../lib/crm';
import { leadColumns } from './leadQueries';
import { notifyUsers } from './activityService';

/** How many old leads one BDM is handed in a day when they press their button */
export const DAILY_RETARGET_LIMIT = 100;

/**
 * How quiet a lead has to have gone before it counts as "old". Without it a lead that came in this week
 * would be retargeted alongside the 2019 ones, which is not what the batch is for.
 */
export const RETARGET_MIN_AGE_DAYS = 30;

/**
 * The leads a BDM can still be handed back. Their own leads only - retargeting is deliberately not a
 * reassignment, so a lead never leaves the person who worked it:
 *  - won deals are customers now, so they stay out
 *  - the lead has to have gone quiet (see RETARGET_MIN_AGE_DAYS)
 *  - nothing that has been retargeted before, which is what makes each day's batch new
 */
const poolCondition = (userId: string) =>
  and(
    eq(leads.assignedTo, userId),
    ne(leads.stage, 'WON'),
    sql`coalesce(${leads.lastContactAt}, ${leads.createdAt}) < now() - make_interval(days => ${RETARGET_MIN_AGE_DAYS})`,
    sql`NOT EXISTS (SELECT 1 FROM lead_retargets r WHERE r.lead_id = ${leads.id})`
  );

export type RetargetingRow = {
  userId: string;
  name: string;
  username: string;
  isActive: boolean;
  /** Old leads of theirs still waiting to be retargeted */
  pool: number;
  /** Of that pool, the ones that were lost - what retargeting is mostly about */
  lostInPool: number;
  allottedToday: number;
  /** How many of today's batch they have already followed up */
  doneToday: number;
  totalRetargeted: number;
  lastBatchDate: string | null;
  /** The oldest lead waiting in the pool, which is the one the next batch starts from */
  oldestInPool: string | null;
};

/**
 * One row per BDM for the retargeting screen. Written as scalar sub-queries (like /crm/bdms) so the whole
 * board is one round trip; `only` narrows it to a single BDM, which is all a BDM may see of it.
 */
export async function retargetingSummary(only?: string): Promise<RetargetingRow[]> {
  const today = todayLocal();
  const quiet = sql.raw(`coalesce(l.last_contact_at, l.created_at) < now() - make_interval(days => ${RETARGET_MIN_AGE_DAYS})`);
  const inPool = sql`l.assigned_to = u.id AND l.stage <> 'WON' AND ${quiet} AND NOT EXISTS (SELECT 1 FROM lead_retargets r WHERE r.lead_id = l.id)`;
  const { rows } = await db.execute<RetargetingRow>(sql`
    SELECT
      u.id AS "userId", u.name, u.username, u.is_active AS "isActive",
      (SELECT count(*)::int FROM leads l WHERE ${inPool}) AS pool,
      (SELECT count(*)::int FROM leads l WHERE ${inPool} AND l.stage = 'LOST') AS "lostInPool",
      (SELECT min(l.created_at) FROM leads l WHERE ${inPool}) AS "oldestInPool",
      (SELECT count(*)::int FROM lead_retargets t WHERE t.user_id = u.id AND t.batch_date = ${today}::date) AS "allottedToday",
      (SELECT count(*)::int FROM lead_retargets t WHERE t.user_id = u.id AND t.batch_date = ${today}::date
         AND EXISTS (SELECT 1 FROM lead_followups f WHERE f.lead_id = t.lead_id AND f.created_at >= t.created_at)) AS "doneToday",
      (SELECT count(*)::int FROM lead_retargets t WHERE t.user_id = u.id) AS "totalRetargeted",
      (SELECT max(t.batch_date) FROM lead_retargets t WHERE t.user_id = u.id) AS "lastBatchDate"
    FROM users u
    WHERE u.role = ${BDM_ROLE} AND (u.is_active OR EXISTS (SELECT 1 FROM lead_retargets t WHERE t.user_id = u.id))
      ${only ? sql`AND u.id = ${only}` : sql``}
    ORDER BY u.is_active DESC, u.rotation_position ASC, u.name ASC`);
  return rows;
}

/**
 * Hands the BDM their batch for today: the oldest of their own old leads, up to DAILY_RETARGET_LIMIT.
 * Pressing the button twice in a day tops the batch up to the limit rather than handing out another 100.
 */
export async function allotRetargetBatch(params: { userId: string; byUserId: string }): Promise<{
  allotted: number;
  allottedToday: number;
  remainingPool: number;
}> {
  const batchDate = todayLocal();
  const allotted = await db.transaction(async (tx) => {
    const [{ already }] = await tx
      .select({ already: sql<number>`count(*)::int` })
      .from(leadRetargets)
      .where(and(eq(leadRetargets.userId, params.userId), eq(leadRetargets.batchDate, batchDate)));
    const room = DAILY_RETARGET_LIMIT - already;
    if (room <= 0) return [];

    // Locked while we claim them, so the same lead can never land in two batches at once; the unique
    // index on lead_id is the backstop, and onConflictDoNothing means a race just hands out fewer.
    const picked = await tx
      .select({ id: leads.id })
      .from(leads)
      .where(poolCondition(params.userId))
      .orderBy(asc(leads.createdAt), asc(leads.id))
      .limit(room)
      .for('update', { skipLocked: true });
    if (!picked.length) return [];

    return tx
      .insert(leadRetargets)
      .values(picked.map((lead) => ({ leadId: lead.id, userId: params.userId, batchDate, byUserId: params.byUserId })))
      .onConflictDoNothing()
      .returning({ id: leadRetargets.id });
  });

  if (allotted.length) {
    await notifyUsers([params.userId], {
      title: `${allotted.length} old lead${allotted.length === 1 ? '' : 's'} to call again`,
      body: 'Your retargeting list for today is ready',
      type: 'lead-assigned',
      link: '/crm/retargeting',
    });
  }
  const [after] = await retargetingSummary(params.userId);
  return { allotted: allotted.length, allottedToday: after?.allottedToday ?? allotted.length, remainingPool: after?.pool ?? 0 };
}

/**
 * One day's batch for one BDM, oldest lead first - the order it was handed out in. `done` says whether
 * they have logged a follow-up since, which is how they keep their place in a list of a hundred.
 */
export async function retargetBatch(params: { userId: string; date: string }) {
  return db
    .select({
      ...leadColumns,
      retargetedAt: leadRetargets.createdAt,
      batchDate: leadRetargets.batchDate,
      done: sql<boolean>`EXISTS (SELECT 1 FROM lead_followups f WHERE f.lead_id = ${leadRetargets.leadId} AND f.created_at >= ${leadRetargets.createdAt})`,
    })
    .from(leadRetargets)
    .innerJoin(leads, eq(leads.id, leadRetargets.leadId))
    .leftJoin(users, eq(users.id, leads.assignedTo))
    .leftJoin(services, eq(services.id, leads.serviceId))
    .where(and(eq(leadRetargets.userId, params.userId), eq(leadRetargets.batchDate, params.date)))
    .orderBy(asc(leads.createdAt), asc(leads.id));
}

/** The days a BDM has batches on, newest first, for the date picker on the retargeting screen */
export async function retargetBatchDays(userId: string): Promise<Array<{ date: string; count: number; done: number }>> {
  const { rows } = await db.execute<{ date: string; count: number; done: number }>(sql`
    SELECT t.batch_date::text AS date, count(*)::int AS count,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM lead_followups f WHERE f.lead_id = t.lead_id AND f.created_at >= t.created_at
      ))::int AS done
    FROM lead_retargets t
    WHERE t.user_id = ${userId}
    GROUP BY t.batch_date
    ORDER BY t.batch_date DESC
    LIMIT 60`);
  return rows;
}
