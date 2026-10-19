import { pool } from '../src/server/db/index';
(async () => {
  const q = async (t: string, s: string) => { console.log(t); console.table((await pool.query(s)).rows); };
  await q('Leads per BDM: old CRM (export 4) vs live', `
    with old as (select case (a.data->>'bdm_id')::int when 4 then 12 when 11 then 10 else nullif((a.data->>'bdm_id')::int,0) end bdm, count(*)::int n
      from legacy_archive a where a.table_name='re_leads' and a.row_key<>'__columns' group by 1),
    names as (select row_key::int id, data->>'bdm_name' name from legacy_archive where table_name='bdm_master' and row_key<>'__columns'),
    live as (select u.name, count(*)::int n from leads l left join users u on u.id=l.assigned_to where l.external_id like 'legacy-crm:%' group by 1)
    select coalesce(n.name,'(no BDM)') old_name, o.n old_leads, (select string_agg(name||' '||n, ', ') from live where lower(left(live.name,4))=lower(left(coalesce(n.name,'(no'),4)) or (live.name is null and n.name is null)) live_leads
    from old o left join names n on n.id=o.bdm order by 2 desc`);
  await q('Open leads: one number with two different BDMs', `select
     count(*) filter (where every_legacy)::int only_old_crm_leads, count(*) filter (where not every_legacy)::int involving_new_crm_leads from (
     select phone_normalized, bool_and(external_id like 'legacy-crm:%') every_legacy from leads where phone_normalized is not null and assigned_to is not null and stage not in ('WON','LOST')
     group by 1 having count(distinct assigned_to)>1) x`);
  await pool.end();
})();
