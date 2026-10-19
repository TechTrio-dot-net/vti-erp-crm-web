import { pool } from '../src/server/db/index';
// Compare the way the importer cleans text: remove \r and trim every kind of whitespace (not only spaces)
const norm = (v: string | null) => { const s = (v ?? '').replace(/\r/g, '').trim(); return s || null; };
(async () => {
  const f = (await pool.query(`select a.row_key, a.data->>'remarks' old, f.note from legacy_archive a join lead_followups f on f.client_ref='legacy-crm-fup:'||a.row_key where a.table_name='re_leads_fups' and a.row_key<>'__columns'`)).rows;
  const badF = f.filter((r) => { const o = norm(r.old); return o !== null && !(r.note ?? '').startsWith(o); });
  console.log('follow-up remarks truly different:', badF.length, 'of', f.length);
  badF.slice(0, 3).forEach((r) => console.log('  ', JSON.stringify({ id: r.row_key, old: r.old.slice(0, 70), note: (r.note ?? '').slice(0, 70) })));
  const l = (await pool.query(`select a.row_key, a.data->>'remarks' old_remarks, a.data->>'client_name' old_name, a.data->>'contact_no' old_phone, l.notes, l.contact_name, l.phone from legacy_archive a join leads l on l.external_id='legacy-crm:'||a.row_key where a.table_name='re_leads' and a.row_key<>'__columns'`)).rows;
  const badR = l.filter((r) => { const o = norm(r.old_remarks); return o !== null && !(r.notes ?? '').startsWith(o); });
  const badN = l.filter((r) => norm(r.old_name) !== (r.contact_name ?? null));
  const badP = l.filter((r) => norm(r.old_phone) !== (r.phone ?? null));
  console.log('lead remarks truly different:', badR.length, '| client names:', badN.length, '| phones:', badP.length, 'of', l.length);
  badR.slice(0, 2).forEach((r) => console.log('  remark', JSON.stringify({ id: r.row_key, old: r.old_remarks.slice(0, 60), notes: (r.notes ?? '').slice(0, 60) })));
  badN.slice(0, 2).forEach((r) => console.log('  name', JSON.stringify({ id: r.row_key, old: r.old_name, got: r.contact_name })));
  badP.slice(0, 5).forEach((r) => console.log('  phone', JSON.stringify({ id: r.row_key, old: r.old_phone, got: r.phone })));
  await pool.end();
})();
