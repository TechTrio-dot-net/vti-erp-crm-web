import { pool } from '../src/server/db/index';
(async () => {
  const m = `case (a.data->>'bdm_id')::int when 4 then 12 when 11 then 10 else (a.data->>'bdm_id')::int end`;
  const { rows } = await pool.query(`
    select ${m} bdm, substr(a.data->>'entry_date',1,10) d, count(*)::int n,
      count(*) filter (where exists (select 1 from legacy_archive t where t.table_name='lead_transferhistory' and t.data->>'lead_id'=a.row_key))::int transferred,
      count(*) filter (where a.data->>'status'='Lost')::int lost,
      count(*) filter (where a.data->>'status' in ('Not Interested','Invalid','Disqualified'))::int notint,
      count(*) filter (where lower(btrim(a.data->>'source'))='manual entry')::int manual,
      count(*) filter (where exists (select 1 from legacy_archive o where o.table_name='re_leads' and o.row_key<>a.row_key and o.data->>'contact_no'=a.data->>'contact_no'))::int dup_phone,
      count(*) filter (where a.data->>'next_fup_date' like '0000%')::int no_next,
      count(*) filter (where a.data->>'status' in ('Hot','Hot Closing','Closed','Booked','Interested'))::int hot
    from legacy_archive a where a.table_name='re_leads' and a.row_key<>'__columns'
      and ((${m}=1 and substr(a.data->>'entry_date',1,10) in ('2026-10-09','2026-10-08','2026-10-07','2026-10-10')) or (${m}=5 and substr(a.data->>'entry_date',1,10) in ('2026-10-08','2026-10-09')) or (${m}=6 and substr(a.data->>'entry_date',1,10)='2026-10-08'))
    group by 1,2 order by 1,2`);
  console.log('Old CRM black numbers to explain: Ankit 9 Oct=1, 8 Oct=2, 7 Oct=1, 10 Oct=0 · Manan 8 Oct=1, 9 Oct=0 · Hasti 8 Oct=0');
  console.table(rows);
  await pool.end();
})();
