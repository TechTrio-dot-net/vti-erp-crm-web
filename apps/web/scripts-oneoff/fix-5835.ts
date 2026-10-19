import { pool } from '../src/server/db/index';
(async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(`select l.id, l.assigned_to from leads l where l.external_id='legacy-crm:5835' for update`);
    if (rows.length !== 1 || !rows[0].assigned_to) { console.log('Nothing to do:', rows); await c.query('ROLLBACK'); return; }
    await c.query(`update leads set assigned_to = null, assigned_at = null where id = $1`, [rows[0].id]);
    await c.query(`insert into lead_assignments (lead_id, from_user_id, to_user_id, reason, note) values ($1, $2, null, 'manual', 'Unassigned, as it was in the old CRM')`, [rows[0].id, rows[0].assigned_to]);
    await c.query('COMMIT');
    console.log('Lead 5835 is unassigned again.');
    console.log((await pool.query(`select count(*) filter (where assigned_to is null)::int unassigned, count(*)::int total from leads where external_id like 'legacy-crm:%'`)).rows[0]);
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); await pool.end(); }
})();
