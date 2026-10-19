import { pool } from '../src/server/db/index';
(async () => {
  const q = async (t: string, s: string) => { console.log(t); console.table((await pool.query(s)).rows); };
  await q('source', `select name, active, last_synced_at, now() as now, last_error, jsonb_array_length(coalesce(config->'sheetTabs','[]')) tabs, jsonb_array_length(coalesce(config->'baselinedTabs','[]')) baselined, config->>'importExisting' imp from lead_sources where type='google_sheet'`);
  await q('job runs', `select * from job_runs order by 2 desc limit 12`);
  await q('imports by status', `select status, count(*)::int n, max(created_at) last from lead_imports i join lead_sources s on s.id=i.source_id where s.type='google_sheet' group by 1`);
  await q('online BDMs', `select name, in_rotation from users where role='SALES' and is_active order by rotation_position`);
  await pool.end();
})();
