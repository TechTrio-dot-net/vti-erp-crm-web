import { pool } from '../src/server/db/index';
const t = async (label: string, sql: string) => { const { rows } = await pool.query(sql); console.log('\n' + label); if (rows.length) console.table(rows); else console.log('  (none)'); };
(async () => {
  await t('Now', `select to_char(now() at time zone 'Asia/Kolkata','Dy DD Mon HH24:MI') ist`);
  await t('Leads by origin', `select case when external_id like 'legacy-crm:%' then 'old CRM import' when source_id is not null then 'sheet source (new CRM)' else 'created in new CRM ('||coalesce(source,'?')||')' end origin, count(*)::int leads,
      count(*) filter (where assigned_to is null)::int unassigned from leads group by 1 order by 2 desc`);
  await t('Follow-ups logged IN THE NEW CRM (not imported)', `select coalesce(u.name,'—') bdm, f.source, count(*)::int n, count(*) filter (where l.external_id like 'legacy-crm:%')::int on_old_crm_leads,
      to_char(min(f.created_at) at time zone 'Asia/Kolkata','DD Mon HH24:MI') first, to_char(max(f.created_at) at time zone 'Asia/Kolkata','DD Mon HH24:MI') last
    from lead_followups f join leads l on l.id=f.lead_id left join users u on u.id=f.user_id where f.client_ref is null or f.client_ref not like 'legacy-crm-fup:%' group by 1,2 order by 3 desc`);
  await t('Assignments made IN THE NEW CRM', `select a.reason, coalesce(a.note,'') note, count(*)::int n, count(*) filter (where l.external_id like 'legacy-crm:%')::int on_old_crm_leads
    from lead_assignments a join leads l on l.id=a.lead_id where a.note is null or a.note not like 'Old CRM %' group by 1,2 order by 3 desc`);
  await t('Old-CRM leads whose BDM in the new CRM differs from the old CRM', `select count(*)::int n from legacy_archive a join leads l on l.external_id='legacy-crm:'||a.row_key
    left join lateral (select l2.assigned_to uid from legacy_archive a2 join leads l2 on l2.external_id='legacy-crm:'||a2.row_key where a2.table_name='re_leads' and a2.row_key<>'__columns'
        and (case (a2.data->>'bdm_id')::int when 4 then 12 when 11 then 10 else (a2.data->>'bdm_id')::int end) = (case (a.data->>'bdm_id')::int when 4 then 12 when 11 then 10 else (a.data->>'bdm_id')::int end) and l2.id<>l.id limit 1) peer on true
    where a.table_name='re_leads' and a.row_key<>'__columns' and (a.data->>'bdm_id')::int>0 and peer.uid is distinct from l.assigned_to and peer.uid is not null`);
  await t('Other new-CRM records', `select (select count(*)::int from call_logs) call_logs, (select count(*)::int from call_recordings) recordings, (select count(*)::int from quotations) quotations,
      (select count(*)::int from clients) clients, (select count(*)::int from mobile_devices) phones_registered, (select count(*)::int from lead_imports i join lead_sources s on s.id=i.source_id where s.type='google_sheet') sheet_rows`);
  await t('Sheet source', `select name, active, config->>'sheetName' tab, config->>'importExisting' import_existing, to_char(last_synced_at at time zone 'Asia/Kolkata','DD Mon HH24:MI') last_sync, (select count(*)::int from leads l where l.source_id=s.id) leads from lead_sources s`);
  await pool.end();
})();
