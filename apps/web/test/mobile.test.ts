import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { callLogs, employees, leads } from '../src/server/db/schema';
import { PASSWORD, actingAsRole, api, db, resetDb, seedTestCatalog } from './harness';

/**
 * The Android call-sync app (apps/mobile), exercised with exactly the requests it sends
 * (ApiClient.kt, CallSync.kt, DialerService.kt).
 */
describe('Android app', () => {
  let userId: string;

  beforeEach(async () => {
    await resetDb();
    await seedTestCatalog();
    // A BDM who signs in on the phone with their employee ID
    const bdm = await actingAsRole('SALES', { username: 'bdm1', inRotation: true });
    userId = bdm.userId;
    await db.insert(employees).values({ userId, employeeCode: 'KR_01', name: 'Test BDM' });
  });

  const mobile = (path: string, token?: string) => {
    const req = api().post(`/api${path}`).set('X-Client', 'mobile').set('Accept', 'application/json');
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('signs in with an employee ID and keeps the session going with the refresh token in the body', async () => {
    const login = await mobile('/auth/login').send({ username: 'KR_01', password: PASSWORD }).expect(200);
    expect(login.body.token).toEqual(expect.any(String));
    expect(login.body.refreshToken).toEqual(expect.any(String));
    expect(login.body.user).toMatchObject({ role: 'SALES', name: 'Test SALES' });

    const refreshed = await mobile('/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(200);
    expect(refreshed.body.token).toEqual(expect.any(String));
    expect(refreshed.body.refreshToken).toEqual(expect.any(String));
  });

  it('syncs the call log and matches calls to leads by mobile number', async () => {
    const [lead] = await db.insert(leads).values({ companyName: 'Caller Co', phone: '+91 98765 43210', phoneNormalized: '9876543210', assignedTo: userId }).returning();
    const { body: login } = await mobile('/auth/login').send({ username: 'KR_01', password: PASSWORD }).expect(200);

    const startedAt = Date.now() - 60_000;
    const { body } = await mobile('/calls/device-sync', login.token)
      .send({
        deviceId: 'android-test-1',
        deviceName: 'Samsung Galaxy',
        appVersion: '1.1.0',
        permissionGranted: true,
        leadsOnly: false,
        calls: [
          { phone: '09876543210', direction: 'outgoing', startedAt, durationSec: 95, contactName: null },
          { phone: '+91 90000 11111', direction: 'missed', startedAt: startedAt + 1000, durationSec: 0, contactName: 'Unknown' },
        ],
      })
      .expect(200);
    expect(body).toMatchObject({ inserted: 2, matched: 1 });
    expect(body.today).toMatchObject({ calls: 2, connected: 1, talkSec: 95 });

    const [logged] = await db.select().from(callLogs).where(eq(callLogs.leadId, lead.id));
    expect(logged).toMatchObject({ userId, durationSec: 95, direction: 'outgoing' });

    // The same batch again (the app retries after a network error) is not duplicated
    const again = await mobile('/calls/device-sync', login.token)
      .send({ deviceId: 'android-test-1', calls: [{ phone: '09876543210', direction: 'outgoing', startedAt, durationSec: 95 }] })
      .expect(200);
    expect(again.body.inserted).toBe(0);
  });

  it('dials a lead when Call is clicked on the website', async () => {
    const [lead] = await db.insert(leads).values({ companyName: 'Dial Co', phone: '9876500000', phoneNormalized: '9876500000', assignedTo: userId }).returning();
    const { body: login } = await mobile('/auth/login').send({ username: 'KR_01', password: PASSWORD }).expect(200);

    // The phone's long poll is waiting…
    const poll = mobile('/calls/dialer/poll', login.token).send({ deviceId: 'android-test-1', deviceName: 'Pixel', appVersion: '1.1.0', canDial: true }).then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 800));

    // …when the BDM clicks Call on the lead in the CRM website
    const website = api().post('/api/calls/click-to-call').set('Authorization', `Bearer ${login.token}`).send({ leadId: lead.id, mode: 'phone' }).then((r) => r);

    const polled = await poll;
    expect(polled.status).toBe(200);
    expect(polled.body.request).toMatchObject({ phone: '9876500000', name: 'Dial Co' });

    // The phone reports that it started dialling, and the website hears about it
    await mobile(`/calls/dialer/${polled.body.request.id}/result`, login.token).send({ status: 'dialing' }).expect(200);
    const clicked = await website;
    expect(clicked.status).toBe(201);
    expect(clicked.body).toMatchObject({ mode: 'phone', status: 'dialing' });
  }, 60_000);

  it('shows the home dashboard and the lead lists the app reads', async () => {
    const other = await actingAsRole('SALES');
    const inAnHour = new Date(Date.now() + 3_600_000);
    await db.insert(leads).values([
      { companyName: 'Mine Due', phone: '9876500001', phoneNormalized: '9876500001', assignedTo: userId, assignedAt: new Date(), nextFollowupAt: inAnHour },
      { companyName: 'Mine New', phone: '9876500002', phoneNormalized: '9876500002', assignedTo: userId, assignedAt: new Date() },
      { companyName: 'Not Mine', phone: '9876500003', phoneNormalized: '9876500003', assignedTo: other.userId, assignedAt: new Date() },
    ]);
    const { body: login } = await mobile('/auth/login').send({ username: 'KR_01', password: PASSWORD }).expect(200);
    const get = (path: string) => api().get(`/api${path}`).set('X-Client', 'mobile').set('Authorization', `Bearer ${login.token}`).expect(200);

    // Home: only this BDM's leads
    const { body: home } = await get('/crm/reports/dashboard');
    expect(home.today).toMatchObject({ open: 2, pending: 2 });
    expect(home.due.map((l: { name: string }) => l.name)).toEqual(['Mine Due']);

    // Leads tab: the exact queries the app sends
    const { body: open } = await get('/crm/leads?status=open&sort=created&limit=30&page=1');
    expect(open.rows.map((l: { name: string }) => l.name).sort()).toEqual(['Mine Due', 'Mine New']);
    expect(open.total).toBe(2);
    const { body: search } = await get(`/crm/leads?status=all&sort=created&limit=30&page=1&q=${encodeURIComponent('Mine N')}`);
    expect(search.rows.map((l: { name: string }) => l.name)).toEqual(['Mine New']);
    const { body: lead } = await get(`/crm/leads/${open.rows[0].id}`);
    expect(lead.followups).toEqual([]);
  });

  it('refuses the app to roles outside the sales CRM', async () => {
    const other = await actingAsRole('TEAM_MEMBER', { username: 'designer1' });
    await mobile('/calls/device-sync', other.token).send({ deviceId: 'x', calls: [] }).expect(403);
  });
});
