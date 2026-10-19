/**
 * One-off: shares out today's waiting backlog, which all went to the first BDM online (Kavita), among the
 * "vti sheet" team's online BDMs so everyone holds the same number. Only leads nobody has called yet are
 * moved; each move is recorded in the lead's history. Also switches the old-CRM archive source off.
 *
 *   cd apps/web && DATABASE_URL="$(cat ~/.config/vti-crm/live-database-url)" npx tsx scripts-oneoff/rebalance-todays-backlog.ts [--dry-run]
 */
import { sql } from 'drizzle-orm';
import { db, pool } from '../src/server/db/index';
import { assignLead, notifyAssignees } from '../src/server/services/leadAssignment';

const DRY_RUN = process.argv.includes('--dry-run');
const NOTE = 'Rebalanced: the waiting backlog had all gone to the first BDM online';

(async () => {
  const byUser: Record<string, number> = {};
  const names: Record<string, string> = {};
  await db.transaction(async (tx) => {
    const team = (await tx.execute<{ id: string; name: string; username: string }>(sql`
      SELECT u.id, u.name, u.username FROM users u
      JOIN lead_source_bdms t ON t.user_id = u.id JOIN lead_sources s ON s.id = t.source_id AND s.name = 'vti sheet'
      WHERE u.role = 'SALES' AND u.is_active AND u.in_rotation ORDER BY u.name`)).rows;
    team.forEach((u) => (names[u.id] = u.name));
    const kavita = team.find((u) => u.username === 'kavita');
    if (!kavita || team.length < 2) throw new Error('Team not as expected: ' + team.map((u) => u.name).join(', '));

    const fromBacklog = sql`EXISTS (SELECT 1 FROM lead_assignments a WHERE a.lead_id = l.id AND a.reason = 'auto' AND a.note = 'Waiting lead'
      AND (a.created_at AT TIME ZONE 'Asia/Kolkata')::date = DATE '2026-10-12')`;
    // The backlog still with Kavita and not called yet
    const movable = (await tx.execute<{ id: string }>(sql`
      SELECT l.id FROM leads l
      WHERE l.assigned_to = ${kavita.id} AND l.first_contact_at IS NULL AND l.stage NOT IN ('WON', 'LOST') AND ${fromBacklog}
      ORDER BY l.created_at DESC FOR UPDATE OF l`)).rows;
    // What each BDM already holds from that backlog, so everyone ends up level
    const held = (await tx.execute<{ id: string; n: number }>(sql`SELECT l.assigned_to AS id, count(*)::int AS n FROM leads l WHERE ${fromBacklog} GROUP BY 1`)).rows;
    const count: Record<string, number> = Object.fromEntries(team.map((u) => [u.id, 0]));
    for (const h of held) if (h.id in count) count[h.id] = h.n;
    console.log('Before:', Object.fromEntries(team.map((u) => [u.name, count[u.id]])), '· not yet called, with Kavita:', movable.length);

    // One at a time to whoever holds the fewest, until Kavita is level with the rest
    for (const lead of movable) {
      const lowest = team.filter((u) => u.id !== kavita.id).sort((a, b) => count[a.id] - count[b.id])[0];
      if (count[kavita.id] - count[lowest.id] <= 1) break;
      if (!DRY_RUN) await assignLead(tx, { leadId: lead.id, fromUserId: kavita.id, toUserId: lowest.id, reason: 'transfer', note: NOTE });
      count[kavita.id]--;
      count[lowest.id]++;
      byUser[lowest.id] = (byUser[lowest.id] ?? 0) + 1;
    }
    console.log('After: ', Object.fromEntries(team.map((u) => [u.name, count[u.id]])));
    if (DRY_RUN) return;
    for (const id of Object.keys(byUser)) await tx.execute(sql`UPDATE users SET last_assigned_at = clock_timestamp() WHERE id = ${id}`);
    const off = await tx.execute(sql`UPDATE lead_sources SET active = false WHERE name = 'Old CRM — Meta lead forms (archive)' AND active RETURNING id`);
    console.log('Old-CRM archive source switched off:', off.rows.length === 1 ? 'yes' : 'was already off');
  });
  if (!DRY_RUN) await notifyAssignees(Object.entries(byUser).map(([userId, count]) => ({ userId, count, sample: 'Shared from the morning backlog' })));
  console.log(DRY_RUN ? 'Dry run — nothing changed. Would move:' : 'Moved:', Object.fromEntries(Object.entries(byUser).map(([id, n]) => [names[id], n])));
  await pool.end();
})().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
