import { pool } from '../src/server/db/index';
const t = async (label: string, sql: string) => { const { rows } = await pool.query(sql); console.log('\n' + label); if (rows.length) console.table(rows); else console.log('  (none)'); };
(async () => {
  const src = `(select id from lead_sources where type='google_sheet' limit 1)`;
  await t('Sheet source settings', `select config->>'sheetName' tab, config->>'importExisting' import_existing, config->>'baselineDone' baseline_done, left(config->>'sheetUrl', 70) url from lead_sources where type='google_sheet'`);
  await t('The 144 sheet leads: by BDM', `select coalesce(u.name,'Unassigned') bdm, count(*)::int leads, count(*) filter (where l.first_contact_at is null)::int not_called,
      to_char(min(l.created_at) at time zone 'Asia/Kolkata','DD Mon YYYY') oldest, to_char(max(l.created_at) at time zone 'Asia/Kolkata','DD Mon YYYY HH24:MI') newest
    from leads l left join users u on u.id=l.assigned_to where l.source_id=${src} group by 1 order by 2 desc`);
  await t('…by campaign', `select coalesce(campaign,'—') campaign, count(*)::int leads from leads where source_id=${src} group by 1 order by 2 desc`);
  await t('…by day received (IST)', `select to_char(created_at at time zone 'Asia/Kolkata','DD Mon') as day, count(*)::int leads from leads where source_id=${src} group by 1, (created_at at time zone 'Asia/Kolkata')::date order by (created_at at time zone 'Asia/Kolkata')::date`);
  await t('DOUBLE-UPS: sheet leads whose phone is already another lead', `select count(distinct l.id)::int sheet_leads_duplicated,
      count(distinct l.id) filter (where o.external_id like 'legacy-crm:%')::int also_in_old_crm_data,
      count(distinct l.id) filter (where o.source_id=${src})::int duplicated_within_the_sheet,
      count(distinct l.id) filter (where o.assigned_to is distinct from l.assigned_to)::int under_a_different_bdm,
      count(distinct l.id) filter (where o.stage not in ('WON','LOST'))::int other_lead_still_open
    from leads l join leads o on o.phone_normalized=l.phone_normalized and o.id<>l.id where l.source_id=${src} and l.phone_normalized is not null`);
  await t('Examples', `select l.company_name sheet_lead, l.phone, coalesce(u.name,'Unassigned') sheet_bdm, to_char(l.created_at at time zone 'Asia/Kolkata','DD Mon') sheet_date,
      coalesce(ou.name,'Unassigned') old_bdm, coalesce(o.status_label,o.stage) old_status, to_char(o.created_at at time zone 'Asia/Kolkata','DD Mon YYYY') old_date,
      (select count(*)::int from lead_followups f where f.lead_id=o.id) old_followups
    from leads l join leads o on o.phone_normalized=l.phone_normalized and o.id<>l.id left join users u on u.id=l.assigned_to left join users ou on ou.id=o.assigned_to
    where l.source_id=${src} order by l.created_at desc limit 12`);
  await t('The 17 rows the CRM itself flagged as duplicates', `select count(*)::int n, min(error) note from lead_imports where source_id=${src} and status='duplicate'`);
  await pool.end();
})();
