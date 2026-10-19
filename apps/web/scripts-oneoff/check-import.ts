import { pool } from '../src/server/db/index';
const one = async (sql: string) => (await pool.query(sql)).rows[0];
const clean = (col: string) => `nullif(btrim(replace(${col}, E'\\r', '')), '')`;
(async () => {
  console.log('FOLLOW-UPS, each compared with its old row:');
  console.log(await one(`
    select count(*)::int as compared,
      count(*) filter (where ${clean("a.data->>'remarks'")} is not null and (f.note is null or f.note not like ${clean("a.data->>'remarks'")} || '%'))::int as remark_differs,
      count(*) filter (where ${clean("a.data->>'call_activity'")} is distinct from f.call_activity)::int as activity_differs,
      count(*) filter (where ${clean("a.data->>'status'")} is distinct from f.status_label)::int as status_differs,
      count(*) filter (where ${clean("a.data->>'reasons'")} is distinct from f.reason)::int as reason_differs,
      count(*) filter (where (a.data->>'fup_date')::timestamp at time zone 'Asia/Kolkata' <> f.created_at)::int as date_differs,
      count(*) filter (where (case when a.data->>'next_fup_date' like '0000%' then null else (a.data->>'next_fup_date')::timestamp at time zone 'Asia/Kolkata' end) is distinct from f.next_followup_at)::int as next_date_differs,
      count(*) filter (where f.user_id is null and (a.data->>'bdm_id')::int > 0)::int as bdm_missing
    from legacy_archive a join lead_followups f on f.client_ref = 'legacy-crm-fup:' || a.row_key
    where a.table_name = 're_leads_fups' and a.row_key <> '__columns'`));
  console.log('\nLEADS, each compared with its old row:');
  console.log(await one(`
    select count(*)::int as compared,
      count(*) filter (where ${clean("a.data->>'status'")} is distinct from l.status_label)::int as status_differs,
      count(*) filter (where ${clean("a.data->>'contact_no'")} is distinct from l.phone)::int as phone_differs,
      count(*) filter (where ${clean("a.data->>'client_name'")} is distinct from l.contact_name)::int as client_name_differs,
      count(*) filter (where ${clean("a.data->>'email'")} is distinct from l.email)::int as email_differs,
      count(*) filter (where ${clean("a.data->>'city_name'")} is distinct from l.city)::int as city_differs,
      count(*) filter (where ${clean("a.data->>'remarks'")} is not null and (l.notes is null or l.notes not like ${clean("a.data->>'remarks'")} || '%'))::int as remark_differs,
      count(*) filter (where (a.data->>'entry_date')::timestamp at time zone 'Asia/Kolkata' <> l.created_at)::int as date_differs,
      count(*) filter (where l.assigned_to is null and (a.data->>'bdm_id')::int > 0)::int as bdm_missing
    from legacy_archive a join leads l on l.external_id = 'legacy-crm:' || a.row_key
    where a.table_name = 're_leads' and a.row_key <> '__columns'`));
  console.log('\nFOLLOW-UPS PER LEAD (old count vs new count):');
  console.log(await one(`
    with old as (select data->>'lead_id' as lead, count(*) n from legacy_archive where table_name='re_leads_fups' and row_key <> '__columns' group by 1),
         new as (select substr(l.external_id, 12) as lead, count(f.id) n from leads l left join lead_followups f on f.lead_id = l.id where l.external_id like 'legacy-crm:%' group by 1)
    select count(*)::int as leads_checked, count(*) filter (where coalesce(old.n,0) <> new.n)::int as leads_with_different_followup_count,
      count(*) filter (where new.n = 0)::int as leads_with_no_followups, sum(new.n)::int as followups_total
    from new left join old on old.lead = new.lead`));
  await pool.end();
})();
