import { pool } from '../src/server/db/index';
(async () => {
  const q = async (t: string, s: string) => { console.log(t); console.table((await pool.query(s)).rows); };
  await q('Leads not from the old CRM', `select source, (created_at at time zone 'Asia/Kolkata')::date >= '2026-10-13' recent, count(*)::int n,
    count(*) filter (where exists (select 1 from lead_followups f where f.lead_id=l.id and coalesce(f.client_ref,'') not like 'legacy-crm-fup:%'))::int worked,
    count(*) filter (where exists (select 1 from leads o where o.external_id like 'legacy-crm:%' and o.phone_normalized=l.phone_normalized))::int phone_in_old,
    count(*) filter (where exists (select 1 from leads o where o.external_id like 'legacy-crm:%' and o.phone_normalized=l.phone_normalized and o.assigned_to is distinct from l.assigned_to))::int other_bdm_in_old
    from leads l where external_id is null or external_id not like 'legacy-crm:%' group by 1,2`);
  await q('Old CRM: one number, several leads', `select count(*)::int numbers, sum(n)::int leads, count(*) filter (where bdms>1)::int with_different_bdms,
    count(*) filter (where bdms>1 and open_bdms>1)::int open_with_different_bdms from (
    select phone_normalized, count(*) n, count(distinct assigned_to) bdms,
      count(distinct assigned_to) filter (where stage not in ('WON','LOST')) open_bdms
    from leads where external_id like 'legacy-crm:%' and phone_normalized is not null group by 1 having count(*)>1) x`);
  await pool.end();
})();
