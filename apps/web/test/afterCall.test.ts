import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { callLogs, leadFollowups, leads } from '../src/server/db/schema';
import { actingAsRole, api, db, resetDb, seedTestCatalog, type Actor } from './harness';

/**
 * The form the Android app opens when a call ends (AfterCallActivity.kt): look the number up, then save
 * the outcome, note and next follow-up in one request that merges everything into the CRM.
 */
describe('After-call form (phone app)', () => {
  let bdm: Actor;

  beforeEach(async () => {
    await resetDb();
    await seedTestCatalog();
    bdm = await actingAsRole('SALES', { username: 'bdm1', inRotation: true });
  });

  const phone = (path: string, actor: Actor = bdm) =>
    api().post(`/api${path}`).set('X-Client', 'mobile').set('Authorization', `Bearer ${actor.token}`);

  const call = (overrides: Record<string, unknown> = {}) => ({
    phone: '+91 98765 43210',
    direction: 'outgoing',
    startedAt: Date.now() - 120_000,
    durationSec: 84,
    contactName: null,
    ...overrides,
  });

  it('shows who was called, with their last follow-ups and the form choices', async () => {
    const [lead] = await db
      .insert(leads)
      .values({ companyName: 'Asha Traders', phone: '9876543210', phoneNormalized: '9876543210', assignedTo: bdm.userId, stage: 'CONTACTED', city: 'Pune' })
      .returning();
    await db.insert(leadFollowups).values({ leadId: lead.id, userId: bdm.userId, outcome: 'CALL_BACK', note: 'Call after lunch' });

    const { body } = await phone('/calls/after-call/lookup').send({ phone: '098765 43210' }).expect(200);
    expect(body.lead).toMatchObject({ id: lead.id, name: 'Asha Traders', stage: 'CONTACTED', stageLabel: 'Contacted', city: 'Pune' });
    expect(body.history[0]).toMatchObject({ outcome: 'CALL_BACK', outcomeLabel: 'Call back', note: 'Call after lunch' });
    expect(body.options.outcomes.map((o: { key: string }) => o.key)).toContain('INTERESTED');
    expect(body.options.lostReasons).toContain('Price too high');
    expect(body.otherOwner).toBe(false);
  });

  describe('question form (app 1.6+)', () => {
    const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
    let leadId: string;
    beforeEach(async () => {
      const [lead] = await db.insert(leads).values({ companyName: 'Asha Traders', phone: '9876543210', phoneNormalized: '9876543210', assignedTo: bdm.userId }).returning();
      leadId = lead.id;
    });
    const form = (ref: string, answers: Record<string, unknown>) =>
      phone('/calls/after-call').send({ clientRef: ref, deviceId: 'd1', call: call(), leadId, form: 2, businessType: 'B2B', ...answers });

    it('logs interested with the sample and business type, and a follow-up within 72 hours', async () => {
      await form('q-1', { connected: true, interested: true, sampleShared: true, nextFollowupAt: inHours(48), note: 'Wants a 30s jingle' }).expect(201);
      const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
      expect(lead).toMatchObject({ stage: 'PROPOSAL', businessType: 'B2B' });
      expect(lead.sampleSharedAt).toBeInstanceOf(Date);
      const [f] = await db.select().from(leadFollowups).where(eq(leadFollowups.leadId, leadId));
      expect(f).toMatchObject({ outcome: 'INTERESTED', connected: true, interested: true, sampleShared: true });
    });

    it('logs a call that did not connect as not reachable, still with a follow-up', async () => {
      await form('q-2', { connected: false, nextFollowupAt: inHours(3) }).expect(201);
      const [f] = await db.select().from(leadFollowups).where(eq(leadFollowups.leadId, leadId));
      expect(f).toMatchObject({ outcome: 'NOT_REACHABLE', connected: false, interested: null });
    });

    it('closes a not-interested lead with its reason', async () => {
      await form('q-3', { connected: true, interested: false, lostReason: 'Price too high', businessType: 'B2C' }).expect(201);
      const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
      expect(lead).toMatchObject({ stage: 'LOST', lostReason: 'Price too high', businessType: 'B2C', nextFollowupAt: null });
    });

    it('requires every answer, and a follow-up no later than 72 hours after the call', async () => {
      const refused = async (answers: Record<string, unknown>, message: RegExp) => {
        const { body } = await form(`bad-${Math.random()}`, answers).expect(400);
        expect(body.message).toMatch(message);
      };
      await refused({ interested: true, sampleShared: true, nextFollowupAt: inHours(5) }, /connected/);
      await refused({ connected: true, sampleShared: true, nextFollowupAt: inHours(5) }, /interested/);
      await refused({ connected: true, interested: true, nextFollowupAt: inHours(5) }, /sample/);
      await refused({ connected: true, interested: true, sampleShared: false, nextFollowupAt: inHours(5), businessType: undefined }, /B2B or B2C/);
      await refused({ connected: true, interested: true, sampleShared: false }, /follow-up/);
      await refused({ connected: true, interested: true, sampleShared: false, nextFollowupAt: inHours(80) }, /72 hours/);
      await refused({ connected: true, interested: false }, /not interested/);
      // Nothing was logged
      expect(await db.select().from(leadFollowups).where(eq(leadFollowups.leadId, leadId))).toHaveLength(0);
    });
  });

  it('keeps another BDM\'s lead private', async () => {
    const other = await actingAsRole('SALES', { username: 'bdm2', inRotation: true });
    await db.insert(leads).values({ companyName: 'Not Yours', phone: '9876543210', phoneNormalized: '9876543210', assignedTo: other.userId });

    const { body } = await phone('/calls/after-call/lookup').send({ phone: '9876543210' }).expect(200);
    expect(body.lead).toBeNull();
    expect(body.otherOwner).toBe(true);

    await phone('/calls/after-call').send({ clientRef: 'r-private', deviceId: 'd1', call: call(), outcome: 'CONNECTED' }).expect(403);
  });

  it('logs the call and the follow-up on the lead, and moves it along like the website does', async () => {
    const [lead] = await db.insert(leads).values({ companyName: 'Asha Traders', phone: '9876543210', phoneNormalized: '9876543210', assignedTo: bdm.userId }).returning();
    const next = new Date(Date.now() + 24 * 3600_000).toISOString();

    const { body } = await phone('/calls/after-call')
      .send({
        clientRef: 'r-1',
        deviceId: 'd1',
        call: call(),
        leadId: lead.id,
        outcome: 'INTERESTED',
        note: 'Wants a 60s explainer, send rates',
        nextFollowupAt: next,
        details: { city: 'Nagpur', estimatedValue: '25000' },
      })
      .expect(201);
    expect(body).toMatchObject({ status: 'updated', saved: true });
    expect(body.lead).toMatchObject({ id: lead.id, stage: 'PROPOSAL', city: 'Nagpur', estimatedValue: 25000 });
    expect(new Date(body.lead.nextFollowupAt).toISOString()).toBe(next);

    const [followup] = await db.select().from(leadFollowups).where(eq(leadFollowups.leadId, lead.id));
    expect(followup).toMatchObject({ outcome: 'INTERESTED', source: 'phone', note: 'Wants a 60s explainer, send rates' });
    const [logged] = await db.select().from(callLogs).where(eq(callLogs.leadId, lead.id));
    expect(logged).toMatchObject({ durationSec: 84, direction: 'outgoing' });
    expect(followup.callLogId).toBe(logged.id);
  });

  it('saves a retried form once, and never stores the call twice alongside the background sync', async () => {
    const [lead] = await db.insert(leads).values({ companyName: 'Asha Traders', phone: '9876543210', phoneNormalized: '9876543210', assignedTo: bdm.userId }).returning();
    const theCall = call();
    // The background sync got there first
    await phone('/calls/device-sync').send({ deviceId: 'd1', calls: [theCall] }).expect(200);

    const form = { clientRef: 'r-retry', deviceId: 'd1', call: theCall, leadId: lead.id, outcome: 'CALL_BACK', nextFollowupAt: new Date(Date.now() + 3600_000).toISOString() };
    await phone('/calls/after-call').send(form).expect(201);
    const again = await phone('/calls/after-call').send(form).expect(200);
    expect(again.body.saved).toBe(false);

    expect(await db.select().from(leadFollowups).where(eq(leadFollowups.leadId, lead.id))).toHaveLength(1);
    expect(await db.select().from(callLogs).where(eq(callLogs.leadId, lead.id))).toHaveLength(1);
  });

  it('turns a call from a new number into the BDM\'s own lead', async () => {
    const services = await api().get('/api/masters/services').set('Authorization', `Bearer ${bdm.token}`);
    const serviceId = Array.isArray(services.body) && services.body[0]?.id;

    const { body } = await phone('/calls/after-call')
      .send({
        clientRef: 'r-new',
        deviceId: 'd1',
        call: call({ phone: '9000011111', direction: 'incoming', durationSec: 40 }),
        newLead: { name: 'Ravi Studio', city: 'Indore', ...(serviceId && { serviceId }) },
        outcome: 'CONNECTED',
        note: 'Saw our Instagram ad',
      })
      .expect(201);
    expect(body.status).toBe('lead-created');
    expect(body.lead).toMatchObject({ name: 'Ravi Studio', city: 'Indore', phone: '9000011111', assignedTo: bdm.userId, stage: 'CONTACTED', source: 'phone call' });

    const [logged] = await db.select().from(callLogs).where(eq(callLogs.leadId, body.lead.id));
    expect(logged).toMatchObject({ direction: 'incoming', durationSec: 40 });
  });

  it('asks for a name before creating a lead, and can just store the call instead', async () => {
    const unknown = call({ phone: '9111122222' });
    const refused = await phone('/calls/after-call').send({ clientRef: 'r-x', deviceId: 'd1', call: unknown, outcome: 'CONNECTED' }).expect(400);
    expect(refused.body.message).toMatch(/isn't a lead yet/);

    const { body } = await phone('/calls/after-call').send({ clientRef: 'r-skip', deviceId: 'd1', call: unknown, skip: true }).expect(201);
    expect(body.status).toBe('call-only');
    expect(await db.select().from(callLogs).where(eq(callLogs.phoneNormalized, '9111122222'))).toHaveLength(1);
    expect(await db.select().from(leads).where(eq(leads.phoneNormalized, '9111122222'))).toHaveLength(0);
  });

  it('closes a lead as lost with the reason given on the phone', async () => {
    const [lead] = await db.insert(leads).values({ companyName: 'Asha Traders', phone: '9876543210', phoneNormalized: '9876543210', assignedTo: bdm.userId, nextFollowupAt: new Date() }).returning();
    const { body } = await phone('/calls/after-call')
      .send({ clientRef: 'r-lost', deviceId: 'd1', call: call(), leadId: lead.id, outcome: 'NOT_INTERESTED', lostReason: 'Price too high' })
      .expect(201);
    expect(body.lead).toMatchObject({ stage: 'LOST', lostReason: 'Price too high', nextFollowupAt: null });
    expect(body.lead.closedAt).toEqual(expect.any(String));
  });
});

describe('Live updates', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('delivers new notifications and change counters to the website', async () => {
    const admin = await actingAsRole('SUPER_ADMIN', { username: 'admin1' });
    const first = await api().get('/api/realtime').set('Authorization', `Bearer ${admin.token}`).expect(200);
    expect(first.body).toMatchObject({ notifications: [] });
    expect(first.body.now).toEqual(expect.any(String));

    const { notifyUsers } = await import('../src/server/services/activityService');
    const { bumpSignal } = await import('../src/server/lib/realtime');
    await notifyUsers([admin.userId], { title: 'New lead assigned', type: 'lead-assigned' });
    await bumpSignal('crm');

    const next = await api().get(`/api/realtime?since=${encodeURIComponent(first.body.now)}`).set('Authorization', `Bearer ${admin.token}`).expect(200);
    expect(next.body.notifications).toEqual([expect.objectContaining({ title: 'New lead assigned', type: 'lead-assigned' })]);
    expect(next.body.signals.crm).toBeGreaterThan(first.body.signals.crm ?? 0);
  });

  it('runs scheduled jobs only with the cron secret', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    await api().get('/api/cron/tick').expect(401);
    await api().get('/api/cron/tick').set('Authorization', 'Bearer wrong').expect(401);
    const { body } = await api().get('/api/cron/tick').set('Authorization', 'Bearer test-cron-secret').expect(200);
    expect(body.results.map((r: { key: string }) => r.key)).toEqual(['google-sheets', 'meta-forms', 'exotel-calls', 'call-transcripts', 'deadline-reminders']);
    // Nothing is due again straight away
    const again = await api().get('/api/cron/tick').set('Authorization', 'Bearer test-cron-secret').expect(200);
    expect(again.body.results.every((r: { ran: boolean }) => !r.ran)).toBe(true);
    delete process.env.CRON_SECRET;
  });
});
