// Read-only: compares Lead Summary cells with the new lead lists, in-process, against the given database
process.env.DISABLE_BACKGROUND_JOBS = 'true';
import request from 'supertest';
import { pool } from '../src/server/db/index';
import { createApp } from '../src/server/app';
import { signAccessToken } from '../src/server/lib/auth';
(async () => {
  const { rows: [u] } = await pool.query(`select id, role from users where role = 'SUPER_ADMIN' and is_active limit 1`);
  const t = `Bearer ${signAccessToken({ userId: u.id, role: u.role })}`;
  const app = createApp();
  const s = (await request(app).get('/api/crm/reports/lead-summary?to=2026-10-14').set('Authorization', t)).body;
  let bad = 0, checked = 0;
  for (const r of s.rows) for (const d of s.dates) {
    const c = r.cells[d]; if (!c) continue;
    const all = (await request(app).get(`/api/crm/reports/lead-summary/leads?from=${d}&to=${d}&user=${r.userId}`).set('Authorization', t)).body.rows.length;
    const pend = (await request(app).get(`/api/crm/reports/lead-summary/leads?from=${d}&to=${d}&user=${r.userId}&pending=1`).set('Authorization', t)).body.rows.length;
    checked++; if (all !== c.assigned || pend !== c.pending) { bad++; console.log('MISMATCH', r.name, d, c, all, pend); }
    if (r.name === 'Hasti' && d === '2026-10-13') console.log('Hasti 13 Oct:', c, '→ list', all, '/', pend);
  }
  const wk = (await request(app).get(`/api/crm/reports/lead-summary/leads?from=${s.range.from}&to=${s.range.to}`).set('Authorization', t)).body.rows.length;
  const total = Object.values(s.totals as Record<string, { assigned: number }>).reduce((a, c) => a + c.assigned, 0);
  console.log({ cellsChecked: checked, mismatches: bad, weekTotal: total, weekList: wk });
  await pool.end(); process.exit(0);
})();
