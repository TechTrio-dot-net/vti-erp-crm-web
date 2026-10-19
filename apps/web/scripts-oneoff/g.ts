import { pool } from '../src/server/db/index';
(async () => {
  const q = async (t: string, s: string) => { console.log(t); console.table((await pool.query(s)).rows); };
  await q('Leads and follow-ups per BDM: old CRM vs live CRM', `
    with old as (select case (a.data->>'bdm_id')::int when 4 then 12 when 11 then 10 else (a.data->>'bdm_id')::int end bdm, count(*)::int n
      from legacy_archive a where a.table_name='re_leads' and a.row_key<>'__columns' group by 1),
    names as (select row_key::int id, data->>'bdm_name' name from legacy_archive where table_name='bdm_master' and row_key<>'__columns'),
    new as (select u.name, count(*)::int n, count(*) filter (where l.first_contact_at is null)::int nofup,
       (select count(*)::int from lead_followups f join leads x on x.id=f.lead_id where x.assigned_to=u.id and x.external_id like 'legacy-crm:%') fups
      from leads l left join users u on u.id=l.assigned_to where l.external_id like 'legacy-crm:%' group by u.id, u.name)
    select * from (select coalesce(n.name,'(no BDM)') bdm, 'old CRM' side, o.n leads, null::int followups from old o left join names n on n.id=o.bdm
      union all select coalesce(w.name,'(no BDM)'), 'live CRM', w.n, w.fups from new w) x order by lower(split_part(bdm,' ',1)), side desc`);
  await q('Everything in live leads table', `select case when external_id like 'legacy-crm:%' then 'Old CRM' else coalesce(source,'other') end kind, count(*)::int leads,
     count(*) filter (where assigned_to is null)::int unassigned, min(created_at)::date first, max(created_at)::date last from leads group by 1`);
  await q('Same phone, different BDM (open leads)', `select count(*)::int numbers from (select phone_normalized from leads where phone_normalized is not null and assigned_to is not null and stage not in ('WON','LOST') group by 1 having count(distinct assigned_to)>1) x`);
  await pool.end();
})();
