import { pool } from '../src/server/db/index';
const NAMES: Record<string, string> = { '1': 'Ankit', '3': 'Diya', '6': 'Hasti', '8': 'Kavita', '12': 'Khushbu', '10': 'Krishna', '5': 'Manan' };
const DAYS = ['2026-10-13', '2026-10-12', '2026-10-11', '2026-10-10', '2026-10-09', '2026-10-08', '2026-10-07'];
const show = (title: string, cells: Record<string, Record<string, string>>) => {
  console.log('\n' + title);
  console.log('BDM'.padEnd(9) + DAYS.map((d) => d.slice(5).padStart(9)).join(''));
  for (const b of Object.keys(NAMES)) console.log(NAMES[b].padEnd(9) + DAYS.map((d) => (cells[b]?.[d] ?? '').padStart(9)).join(''));
};
(async () => {
  const m = `case (data->>'bdm_id')::int when 4 then 12 when 11 then 10 else (data->>'bdm_id')::int end`;
  // A. old CRM data: leads by ENTRY date and current BDM; second number = leads with no follow-up at all
  const a = (await pool.query(`
    select ${m}::text b, substr(data->>'entry_date',1,10) d, count(*)::int n,
      count(*) filter (where not exists (select 1 from legacy_archive f where f.table_name='re_leads_fups' and f.data->>'lead_id' = legacy_archive.row_key))::int nofup,
      count(*) filter (where data->>'status' in ('Fresh','New','Proposal Call(Fresh)'))::int fresh
    from legacy_archive where table_name='re_leads' and row_key<>'__columns' and substr(data->>'entry_date',1,10) between '2026-10-07' and '2026-10-13' group by 1,2`)).rows;
  const A: any = {}; const A2: any = {};
  for (const r of a) { (A[r.b] ??= {})[r.d] = r.nofup ? `${r.n}-${r.nofup}` : `${r.n}`; (A2[r.b] ??= {})[r.d] = r.fresh ? `${r.n}-${r.fresh}` : `${r.n}`; }
  show('A. From old-CRM data: leads by ENTRY date · second number = no follow-up yet', A);
  show('A2. Same, second number = status still Fresh/New', A2);
  // B. what the new CRM report shows: by assigned_at and current owner, pending = open and never contacted
  const b = (await pool.query(`
    select u.username, to_char((l.assigned_at at time zone 'Asia/Kolkata')::date,'YYYY-MM-DD') d, count(*)::int n,
      count(*) filter (where l.stage not in ('WON','LOST') and l.first_contact_at is null)::int pending,
      count(*) filter (where l.external_id like 'legacy-crm:%')::int from_old, count(*) filter (where l.source_id is not null)::int from_sheet
    from leads l join users u on u.id=l.assigned_to where (l.assigned_at at time zone 'Asia/Kolkata')::date between '2026-10-07' and '2026-10-13' group by 1,2`)).rows;
  const U: Record<string, string> = { ankitvoice: '1', diyavti: '3', hastivti: '6', kavita: '8', khushbu_vti: '12', krishnavti: '10', mananvti: '5' };
  const B: any = {}; const B2: any = {};
  for (const r of b) { const k = U[r.username]; if (!k) continue; (B[k] ??= {})[r.d] = r.pending ? `${r.n}-${r.pending}` : `${r.n}`; (B2[k] ??= {})[r.d] = `${r.from_old}+${r.from_sheet}`; }
  show('B. What the NEW CRM report shows now (by ASSIGNED date)', B);
  show('B2. …split as old-CRM leads + sheet leads', B2);
  // C. old-CRM leads whose assigned date in the new CRM is not their entry date
  console.table((await pool.query(`
    select count(*)::int leads_in_week, count(*) filter (where (l.assigned_at at time zone 'Asia/Kolkata')::date <> (l.created_at at time zone 'Asia/Kolkata')::date)::int assigned_day_differs_from_entry_day
    from leads l where l.external_id like 'legacy-crm:%' and (l.created_at at time zone 'Asia/Kolkata')::date between '2026-10-07' and '2026-10-13'`)).rows);
  await pool.end();
})();
