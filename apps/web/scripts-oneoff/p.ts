import { pool } from '../src/server/db/index';
(async () => {
  const cols = (await pool.query(`select column_name from information_schema.columns where table_name='activity_logs'`)).rows.map((r) => r.column_name);
  console.log(cols.join(','));
  console.table((await pool.query(`select * from activity_logs where created_at > now() - interval '30 hours' order by created_at desc limit 25`)).rows.map((r) => ({ ...r, details: JSON.stringify(r.details ?? r.metadata ?? '').slice(0, 80) })));
  console.table((await pool.query(`select max(received_at) last_row, min(received_at) first_row from lead_imports`)).rows);
  console.table((await pool.query(`select key, last_started_at from job_runs order by 2 desc`)).rows);
  await pool.end();
})();
