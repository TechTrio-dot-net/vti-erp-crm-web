import { pool } from '../src/server/db/index';
(async () => {
  const q = async (t: string, s: string) => { console.log(t); console.table((await pool.query(s)).rows); };
  const base = `from legacy_archive a where a.table_name='re_leads' and a.row_key<>'__columns' and (a.data->>'bdm_id')='5'`;
  await q('Manan by status (old data, export 13 Oct)', `select a.data->>'status' status, count(*)::int n,
    count(*) filter (where substr(a.data->>'next_fup_date',1,10)='2026-10-13')::int today,
    count(*) filter (where substr(a.data->>'next_fup_date',1,10)='2026-10-12')::int yday,
    count(*) filter (where substr(a.data->>'next_fup_date',1,10)<'2026-10-13')::int late,
    count(*) filter (where substr(a.data->>'next_fup_date',1,10)>'2026-10-13')::int upcoming
    ${base} group by 1 order by 2 desc`);
  await q('sample of keys', `select a.data ${base} limit 1`);
  await pool.end();
})();
