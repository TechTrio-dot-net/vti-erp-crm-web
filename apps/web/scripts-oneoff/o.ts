import { pool } from '../src/server/db/index';
(async () => {
  console.table((await pool.query(`select id, name, type, active, created_at, last_synced_at, last_error, jsonb_array_length(coalesce(config->'sheetTabs','[]')) tabs, jsonb_array_length(coalesce(config->'baselinedTabs','[]')) baselined, (select count(*)::int from lead_imports i where i.source_id=s.id) imports from lead_sources s`)).rows);
  console.table((await pool.query(`select count(*)::int total, count(distinct source_id)::int sources from lead_imports`)).rows);
  await pool.end();
})();
