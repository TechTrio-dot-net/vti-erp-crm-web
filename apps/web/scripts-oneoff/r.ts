// Read-only: times every overview list as Manan, in-process, against the given database
process.env.DISABLE_BACKGROUND_JOBS = 'true';
import request from 'supertest';
import { pool } from '../src/server/db/index';
import { createApp } from '../src/server/app';
import { signAccessToken } from '../src/server/lib/auth';
(async () => {
  const { rows: [u] } = await pool.query(`select id, role from users where name = 'Manan'`);
  const t = `Bearer ${signAccessToken({ userId: u.id, role: u.role })}`;
  const app = createApp();
  for (const q of ['', '/leads?kind=new-today', '/leads?kind=new-today&pending=1', '/leads?kind=new-yesterday&pending=1', '/leads?kind=lost', '/leads?when=total', '/leads?when=late', '/leads?status=Hot&when=late']) {
    const t0 = Date.now();
    const r = await request(app).get(`/api/crm/reports/status-overview${q}`).set('Authorization', t);
    console.log(String(Date.now() - t0).padStart(5), 'ms', r.status, q || '(overview)', r.body.rows ? `${r.body.rows.length} leads` : r.body.message ?? '');
  }
  await pool.end(); process.exit(0);
})();
