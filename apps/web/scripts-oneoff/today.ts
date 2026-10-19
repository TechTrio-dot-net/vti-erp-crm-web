import { pool } from '../src/server/db/index';
const t = async (label: string, sql: string) => { const { rows } = await pool.query(sql); console.log('\n' + label); if (rows.length) console.table(rows); else console.log('  (none)'); };
const today = (c: string) => `(${c} at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date`;
(async () => {
  await t('Now (IST)', `select to_char(now() at time zone 'Asia/Kolkata','Dy DD Mon YYYY HH24:MI') as now`);
  await t("Leads created today, by source and BDM", `select coalesce(l.source,'—') source, coalesce(l.campaign,'—') campaign, coalesce(u.name,'Unassigned') bdm, count(*)::int leads,
      count(*) filter (where l.first_contact_at is null)::int not_called
    from leads l left join users u on u.id=l.assigned_to where ${today('l.created_at')} group by 1,2,3 order by 4 desc`);
  await t("Leads assigned today (any creation date), by BDM and reason", `select coalesce(u.name,'Unassigned') bdm, a.reason, count(*)::int n, to_char(min(a.created_at) at time zone 'Asia/Kolkata','HH24:MI') first_at, to_char(max(a.created_at) at time zone 'Asia/Kolkata','HH24:MI') last_at
    from lead_assignments a left join users u on u.id=a.to_user_id where ${today('a.created_at')} and a.note not like 'Old CRM %' group by 1,2 order by 3 desc`);
  await t("Today's leads whose phone is ALSO another lead (double-ups)", `select l.phone_normalized phone, l.company_name today_lead, coalesce(u.name,'Unassigned') today_bdm, l.source today_source,
      o.company_name other_lead, coalesce(ou.name,'Unassigned') other_bdm, o.stage other_stage, coalesce(o.status_label,'') other_status, to_char(o.created_at at time zone 'Asia/Kolkata','DD Mon YYYY') other_created,
      case when o.external_id like 'legacy-crm:%' then 'old CRM' else 'new CRM' end other_from
    from leads l join leads o on o.phone_normalized=l.phone_normalized and o.id<>l.id left join users u on u.id=l.assigned_to left join users ou on ou.id=o.assigned_to
    where ${today('l.created_at')} and l.phone_normalized is not null order by l.created_at limit 60`);
  await t("Summary of today's double-ups", `with d as (select l.id, l.assigned_to a, o.assigned_to b, o.stage from leads l join leads o on o.phone_normalized=l.phone_normalized and o.id<>l.id where ${today('l.created_at')} and l.phone_normalized is not null)
    select count(distinct id)::int todays_leads_that_are_duplicates, count(distinct id) filter (where a is distinct from b)::int given_to_a_different_bdm, count(distinct id) filter (where stage not in ('WON','LOST'))::int where_other_lead_is_still_open from d`);
  await t("All open leads sharing a phone with another OPEN lead under a DIFFERENT BDM (whole CRM)", `select count(*)::int phones, sum(n)::int leads from (
      select phone_normalized, count(*) n from leads where phone_normalized is not null and stage not in ('WON','LOST') group by 1 having count(distinct assigned_to) > 1) x`);
  await t("Lead sources connected", `select name, type, active, to_char(last_synced_at at time zone 'Asia/Kolkata','DD Mon HH24:MI') last_sync, left(coalesce(last_error,''),60) last_error from lead_sources`);
  await pool.end();
})();
