import { pool } from '../src/server/db/index';
(async () => {
  const q = async (s: string) => console.table((await pool.query(s)).rows);
  await q(`select (external_id like 'legacy-crm:%') legacy, source, (created_at at time zone 'Asia/Kolkata')::date created, (assigned_at at time zone 'Asia/Kolkata')::date assigned, count(*)::int n,
     count(*) filter (where first_contact_at is null)::int no_contact
     from leads where external_id is null or external_id not like 'legacy-crm:%' group by 1,2,3,4 order by 3,4`);
  await q(`select count(*)::int legacy_week, count(*) filter (where (created_at at time zone 'Asia/Kolkata')::date <> (assigned_at at time zone 'Asia/Kolkata')::date)::int differ,
     count(*) filter (where assigned_at is null)::int unassigned
     from leads where external_id like 'legacy-crm:%' and created_at >= '2026-10-06T18:30Z'`);
  await pool.end();
})();
