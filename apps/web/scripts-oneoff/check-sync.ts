import { pool } from '../src/server/db/index';
const norm = (v: string | null) => { const s = (v ?? '').replace(/\r/g, '').trim(); return s || null; };
const ist = (v: string | null) => (!v || v.startsWith('0000') ? null : new Date(v.trim().replace(' ', 'T') + '+05:30').getTime());
const MERGE: Record<string, string> = { '4': '12', '11': '10' };
const CLOSED = new Set(['Lost', 'Not Interested', 'Invalid', 'Disqualified', 'Just Curious', 'Event Planner', 'Travel Agent', 'Voucher Inquiry', 'Investor (Real Estate)', 'Closed', 'Booked', 'Token Amount Received']);
(async () => {
  const l = (await pool.query(`select a.row_key, a.data, l.id, l.company_name, l.contact_name, l.phone, l.email, l.city, l.status_label, l.stage, l.notes, l.next_followup_at, l.created_at, l.assigned_to, l.is_manual, l.source, l.campaign, l.last_contact_at,
      (select count(*)::int from lead_followups f where f.lead_id=l.id and f.client_ref like 'legacy-crm-fup:%') fups,
      (select max(f.created_at) from lead_followups f where f.lead_id=l.id) last_fup
    from legacy_archive a left join leads l on l.external_id='legacy-crm:'||a.row_key where a.table_name='re_leads' and a.row_key<>'__columns'`)).rows;
  const f = (await pool.query(`select data from legacy_archive where table_name='re_leads_fups' and row_key<>'__columns'`)).rows.map((r) => r.data);
  const oldCount: Record<string, number> = {}; const oldLast: Record<string, number> = {};
  for (const x of f) { oldCount[x.lead_id] = (oldCount[x.lead_id] ?? 0) + 1; oldLast[x.lead_id] = Math.max(oldLast[x.lead_id] ?? 0, ist(x.fup_date) ?? 0); }
  // one new-CRM user per old BDM (after the two merges)
  const userOf: Record<string, Set<string>> = {};
  for (const r of l) { const b = MERGE[r.data.bdm_id] ?? r.data.bdm_id; if (r.assigned_to) (userOf[b] ??= new Set()).add(r.assigned_to); }
  const bad: Record<string, number> = {};
  const hit = (k: string, cond: boolean) => { if (cond) bad[k] = (bad[k] ?? 0) + 1; };
  for (const r of l) {
    const d = r.data; const closed = CLOSED.has((d.status ?? '').trim());
    hit('lead missing in the CRM', !r.id); if (!r.id) continue;
    hit('status', norm(d.status) !== r.status_label);
    hit('closed/open stage', closed !== ['WON', 'LOST'].includes(r.stage));
    hit('client name', norm(d.client_name) !== r.contact_name);
    hit('phone', norm(d.contact_no) !== r.phone);
    hit('email', norm(d.email) !== r.email);
    hit('city', norm(d.city_name) !== r.city);
    hit('remarks', norm(d.remarks) !== null && !(r.notes ?? '').startsWith(norm(d.remarks)!));
    hit('entry date', ist(d.entry_date) !== new Date(r.created_at).getTime());
    hit('next follow-up date', !closed && ist(d.next_fup_date) !== (r.next_followup_at ? new Date(r.next_followup_at).getTime() : null));
    hit('manual flag', ((d.source ?? '').trim().toLowerCase() === 'manual entry') !== r.is_manual);
    hit('campaign of sheet leads', !r.is_manual && norm(d.source) !== r.campaign);
    hit('BDM missing', Number(d.bdm_id) > 0 && !r.assigned_to);
    hit('BDM set though none in old CRM', Number(d.bdm_id) === 0 && !!r.assigned_to);
    hit('follow-up count', (oldCount[d.id] ?? 0) !== r.fups);
    hit('last contact date', (oldLast[d.id] ?? null) !== (r.last_contact_at ? new Date(r.last_contact_at).getTime() : null) && (oldCount[d.id] ?? 0) > 0);
  }
  const split = Object.entries(userOf).filter(([b, s]) => b !== '0' && s.size > 1);
  console.log('leads compared with the old CRM:', l.length);
  console.log('differences:', Object.keys(bad).length ? bad : 'NONE');
  console.log('old BDMs whose leads sit with more than one CRM user:', split.length ? split.map(([b, s]) => `${b}: ${s.size}`) : 'NONE');
  const man = l.filter((r) => r.is_manual).length;
  console.log('manual leads:', man, '| sheet/Meta leads:', l.length - man);
  await pool.end();
})();
