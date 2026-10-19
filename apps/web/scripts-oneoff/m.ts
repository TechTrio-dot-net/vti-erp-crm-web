import { pool } from '../src/server/db/index';
(async () => {
  const q = async (t: string, s: string) => { console.log(t); console.table((await pool.query(s)).rows); };
  await q('References to leads', `select conrelid::regclass tbl, confdeltype on_delete from pg_constraint where confrelid='leads'::regclass and contype='f'`);
  await q('Leads not from the old CRM, after the sync', `select source, (created_at at time zone 'Asia/Kolkata')::date >= '2026-10-13' recent, count(*)::int n,
    count(*) filter (where exists (select 1 from lead_followups f where f.lead_id=l.id and coalesce(f.client_ref,'') not like 'legacy-crm-fup:%'))::int worked,
    count(*) filter (where exists (select 1 from call_logs c where c.lead_id=l.id))::int with_calls,
    count(*) filter (where exists (select 1 from leads o where o.external_id like 'legacy-crm:%' and o.phone_normalized=l.phone_normalized))::int phone_in_old,
    count(*) filter (where exists (select 1 from leads o where o.external_id like 'legacy-crm:%' and o.phone_normalized=l.phone_normalized and o.assigned_to is distinct from l.assigned_to))::int other_bdm_in_old
    from leads l where external_id is null or external_id not like 'legacy-crm:%' group by 1,2`);
  await q('Same number twice among new-CRM leads', `select count(*)::int from (select phone_normalized from leads where (external_id is null or external_id not like 'legacy-crm:%') and phone_normalized is not null group by 1 having count(*)>1) x`);
  await pool.end();
})();
