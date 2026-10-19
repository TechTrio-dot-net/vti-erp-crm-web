// Read-only: calls the new overview API in-process, as Manan, against the given database
process.env.DISABLE_BACKGROUND_JOBS = 'true';
import request from 'supertest';
import { pool } from '../src/server/db/index';
import { createApp } from '../src/server/app';
import { signAccessToken } from '../src/server/lib/auth';
(async () => {
  const { rows: [u] } = await pool.query(`select id, role from users where name = 'Manan'`);
  const token = signAccessToken({ userId: u.id, role: u.role });
  const app = createApp();
  const r = await request(app).get('/api/crm/reports/status-overview').set('Authorization', `Bearer ${token}`);
  console.log(r.status, JSON.stringify(r.body.cards), JSON.stringify(r.body.calls));
  console.table(r.body.breakdown);
  const l = await request(app).get('/api/crm/reports/status-overview/leads?status=Hot&when=late').set('Authorization', `Bearer ${token}`);
  console.log('Hot late leads:', l.status, l.body.rows?.length);
  await pool.end(); process.exit(0);
})();
