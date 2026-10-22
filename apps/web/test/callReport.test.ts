import { beforeEach, describe, expect, it } from 'vitest';
import { callLogs, leadFollowups, leads } from '../src/server/db/schema';
import { actingAsRole, as, db, resetDb, type Actor } from './harness';

/** The Call Log screen: the per-salesperson table and the day one salesperson gets when you click their row. */
describe('Call report', () => {
  let admin: Actor;
  let kavita: Actor;
  let krishna: Actor;

  const IST_OFFSET_MIN = 330;
  const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  /** An instant that falls on today's IST date at the given IST clock time */
  const istAt = (hour: number, minute = 0) =>
    new Date(Date.parse(`${istToday()}T00:00:00Z`) + (hour * 60 + minute - IST_OFFSET_MIN) * 60_000);

  const call = (userId: string, at: Date, over: Partial<typeof callLogs.$inferInsert> = {}) =>
    db
      .insert(callLogs)
      .values({
        source: 'device',
        externalId: `call-${at.getTime()}-${Math.random()}`,
        userId,
        phone: '+91 98765 43210',
        phoneNormalized: '9876543210',
        direction: 'outgoing',
        startedAt: at,
        durationSec: 60,
        ...over,
      })
      .returning();

  beforeEach(async () => {
    await resetDb();
    admin = await actingAsRole('SUPER_ADMIN');
    kavita = await actingAsRole('SALES', { name: 'Kavita', isActive: true });
    krishna = await actingAsRole('SALES', { name: 'Krishna', isActive: true });
  });

  it('shows every working salesperson, busiest first, and keeps lead calls apart from cold calls', async () => {
    const [lead] = await db.insert(leads).values({ companyName: 'Lead Co', phone: '+91 98765 43210', phoneNormalized: '9876543210', assignedTo: kavita.userId }).returning();
    await call(kavita.userId, istAt(11), { leadId: lead.id });
    await call(kavita.userId, istAt(11, 20), { durationSec: 0 });
    await call(kavita.userId, istAt(15), { phone: '+91 90000 11111', phoneNormalized: '9000011111' });
    // A missed call from a number nobody knows is not a cold call - she never made it
    await call(kavita.userId, istAt(16), { phone: '+91 91111 22222', phoneNormalized: '9111122222', direction: 'missed', durationSec: 0 });

    const { body } = await as(admin).get('/api/crm/reports/calls').expect(200);
    expect(body.today).toBe(istToday());
    expect(body.workHours).toMatchObject({ startHour: 10, startMinute: 30, endHour: 19, idleMinutes: 20 });

    // Busiest first — that order is the daily ranking — and Krishna is listed although he hasn't called at all
    expect(body.rows.map((r: { name: string; outgoing: number }) => [r.name, r.outgoing])).toEqual([
      ['Kavita', 3],
      ['Krishna', 0],
    ]);
    expect(body.rows[0]).toMatchObject({ leadCalls: 1, coldCalls: 2, connected: 2, notAnswered: 1, missed: 1, talkSec: 120 });
    expect(body.rows[1]).toMatchObject({ date: istToday(), total: 0, lastCall: null });
  });

  it('gives one salesperson their day hour by hour, with how each call went', async () => {
    const [interested] = await db.insert(leads).values({ companyName: 'Keen Co', phone: '+91 98765 43210', phoneNormalized: '9876543210', assignedTo: kavita.userId, stage: 'PROPOSAL' }).returning();
    const [lost] = await db.insert(leads).values({ companyName: 'Gone Co', phone: '+91 97777 00000', phoneNormalized: '9777700000', assignedTo: kavita.userId, stage: 'LOST' }).returning();

    const [leadCall] = await call(kavita.userId, istAt(11), { leadId: interested.id });
    await call(kavita.userId, istAt(11, 40), { leadId: lost.id, phone: '+91 97777 00000', phoneNormalized: '9777700000', durationSec: 0 });
    await call(kavita.userId, istAt(16), { phone: '+91 90000 11111', phoneNormalized: '9000011111', durationSec: 30 });
    // Someone else's call must not leak into this report
    await call(krishna.userId, istAt(11));
    await db.insert(leadFollowups).values({ leadId: interested.id, userId: kavita.userId, callLogId: leadCall.id, outcome: 'NOT_INTERESTED', note: 'Budget too small' });

    const { body } = await as(admin).get(`/api/crm/reports/calls/bdm?user=${kavita.userId}`).expect(200);
    expect(body.person).toMatchObject({ name: 'Kavita' });
    expect(body.hourly).toEqual([
      { hour: 11, made: 2, connected: 1, notAnswered: 1, incoming: 0, missed: 0, leadCalls: 2, coldCalls: 0, talkSec: 60 },
      { hour: 16, made: 1, connected: 1, notAnswered: 0, incoming: 0, missed: 0, leadCalls: 0, coldCalls: 1, talkSec: 30 },
    ]);
    expect(body.calls).toHaveLength(3);
    // Newest first: the cold call, then the lost lead, then the call whose after-call form said "not interested"
    expect(body.calls.map((c: { kind: string; result: string | null }) => [c.kind, c.result])).toEqual([
      ['cold', null],
      ['lead', 'LOST'],
      ['lead', 'NOT_INTERESTED'],
    ]);
    expect(body.calls[2]).toMatchObject({ leadName: 'Keen Co', leadStage: 'PROPOSAL', note: 'Budget too small' });
  });

  it('lets a salesperson say why they stopped calling, until they call again', async () => {
    await call(kavita.userId, istAt(11));

    const { body: mine } = await as(kavita).get('/api/calls/idle-reason').expect(200);
    expect(mine.reason).toBeNull();
    expect(mine.options).toContain('On a shoot');

    await as(kavita).post('/api/calls/idle-reason').send({ reason: 'On a shoot', note: 'Client shoot in Andheri' }).expect(201);
    const { body: after } = await as(kavita).get('/api/calls/idle-reason').expect(200);
    expect(after.reason).toMatchObject({ reason: 'On a shoot', note: 'Client shoot in Andheri' });

    const { body: report } = await as(admin).get('/api/crm/reports/calls').expect(200);
    expect(report.rows.find((r: { name: string }) => r.name === 'Kavita').idleReason).toMatchObject({ reason: 'On a shoot' });
    // Nobody else's row picks it up
    expect(report.rows.find((r: { name: string }) => r.name === 'Krishna').idleReason).toBeNull();

    // Back on the phone: the reason has been answered by the call itself
    await call(kavita.userId, new Date(Date.now() + 1000));
    const { body: later } = await as(admin).get('/api/crm/reports/calls').expect(200);
    expect(later.rows.find((r: { name: string }) => r.name === 'Kavita').idleReason).toBeNull();
    expect((await as(kavita).get('/api/calls/idle-reason').expect(200)).body.reason).toBeNull();
  });

  it('refuses an empty reason', async () => {
    await as(kavita).post('/api/calls/idle-reason').send({ reason: '  ' }).expect(400);
  });

  it('only ever shows a BDM their own calls', async () => {
    await call(kavita.userId, istAt(12));
    await call(krishna.userId, istAt(12));

    const { body } = await as(krishna).get(`/api/crm/reports/calls/bdm?user=${kavita.userId}`).expect(200);
    expect(body.person).toMatchObject({ name: 'Krishna' });
    expect(body.calls).toHaveLength(1);
  });
});
