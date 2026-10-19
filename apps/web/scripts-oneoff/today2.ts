import { pool } from '../src/server/db/index';
const t = async (label: string, sql: string) => { const { rows } = await pool.query(sql); console.log('\n' + label); if (rows.length) console.table(rows); else console.log('  (none)'); };
(async () => {
  await t("The 5 auto-assignments to Kavita today", `select to_char(a.created_at at time zone 'Asia/Kolkata','HH24:MI:SS') at, l.company_name lead, l.phone, l.stage, coalesce(l.status_label,'') old_status, l.external_id, coalesce(cu.name,'Unassigned') now_with, a.note,
      (select count(*)::int from lead_assignments x where x.lead_id=l.id) assignment_rows
    from lead_assignments a join leads l on l.id=a.lead_id left join users cu on cu.id=l.assigned_to
    where a.reason='auto' and a.note='Waiting lead' and (a.created_at at time zone 'Asia/Kolkata')::date=(now() at time zone 'Asia/Kolkata')::date order by a.created_at`);
  await t("New sheet source", `select s.name, s.config, s.created_at at time zone 'Asia/Kolkata' created, (select count(*)::int from lead_imports i where i.source_id=s.id) import_rows,
      (select string_agg(status || '=' || n, ', ') from (select status, count(*) n from lead_imports i where i.source_id=s.id group by 1) z) by_status,
      (select count(*)::int from leads l where l.source_id=s.id) leads_created,
      (select string_agg(u.name, ', ') from lead_source_bdms b join users u on u.id=b.user_id where b.source_id=s.id) team
    from lead_sources s where s.type='google_sheet'`);
  await t("BDMs now", `select name, in_rotation online, to_char(last_assigned_at at time zone 'Asia/Kolkata','DD Mon HH24:MI') last_assigned from users where role='SALES' and is_active order by name`);
  await t("Old-CRM double-ups: same phone, open, under different BDMs — examples", `select phone_normalized phone, count(*)::int leads, string_agg(distinct coalesce(u.name,'Unassigned'), ' / ') bdms, string_agg(distinct coalesce(l.status_label, l.stage), ' / ') statuses
    from leads l left join users u on u.id=l.assigned_to where phone_normalized is not null and stage not in ('WON','LOST') group by 1 having count(distinct assigned_to) > 1 order by 2 desc limit 6`);
  await t("How those double-ups arose", `select case when bool_and(l.external_id like 'legacy-crm:%') then 'both from the old CRM' else 'involves a lead created in the new CRM' end origin, count(*)::int phones from (
      select phone_normalized from leads where phone_normalized is not null and stage not in ('WON','LOST') group by 1 having count(distinct assigned_to) > 1) p join leads l on l.phone_normalized=p.phone_normalized and l.stage not in ('WON','LOST') group by l.phone_normalized`).catch(async () => {});
  const { rows } = await pool.query(`select origin, count(*)::int phones from (select p.phone_normalized, case when bool_and(l.external_id like 'legacy-crm:%') then 'both from the old CRM' else 'involves a new-CRM lead' end origin
      from (select phone_normalized from leads where phone_normalized is not null and stage not in ('WON','LOST') group by 1 having count(distinct assigned_to) > 1) p
      join leads l on l.phone_normalized=p.phone_normalized and l.stage not in ('WON','LOST') group by 1) z group by 1`);
  console.log('\nOrigin of the double-ups'); console.table(rows);
  await pool.end();
})();
