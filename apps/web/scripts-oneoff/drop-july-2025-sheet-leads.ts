/** Live, one-off (approved 14 Oct 2026): removes the July 2025 Google Sheet leads nobody worked on; their sheet rows stay remembered. */
import { pool } from '../src/server/db/index';
(async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const ids = (await c.query(`select id from leads l where source = 'Google Sheet' and (external_id is null or external_id not like 'legacy-crm:%')
      and created_at < '2025-08-01' and not exists (select 1 from lead_followups f where f.lead_id = l.id)
      and not exists (select 1 from call_logs x where x.lead_id = l.id) and not exists (select 1 from quotations q where q.lead_id = l.id)`)).rows.map((r) => r.id);
    const imp = await c.query(`update lead_imports set lead_id = null, status = 'ignored', error = 'Already in the sheet when it was connected' where lead_id = any($1::uuid[])`, [ids]);
    const del = await c.query(`delete from leads where id = any($1::uuid[])`, [ids]);
    if (del.rowCount !== 132) throw new Error(`expected 132, would delete ${del.rowCount} — rolled back`);
    await c.query('COMMIT');
    console.log({ deleted: del.rowCount, sheetRowsRemembered: imp.rowCount });
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); await pool.end(); }
})();
