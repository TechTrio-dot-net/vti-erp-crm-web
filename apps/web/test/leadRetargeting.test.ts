import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { leadFollowups, leads } from '../src/server/db/schema';
import { DAILY_RETARGET_LIMIT } from '../src/server/services/leadRetargeting';
import { actingAsRole, as, db, resetDb } from './harness';

/** The daily batch of old leads a BDM asks for themselves, handed back to whoever already owns them */
describe('Lead retargeting', () => {
  beforeEach(resetDb);

  /** An old lead: created on 1 January 2020 + `n` days, so the oldest-first order is the numbering */
  const old = (n: number, over: Partial<typeof leads.$inferInsert> = {}) => ({
    companyName: `Old ${String(n).padStart(3, '0')}`,
    createdAt: new Date(Date.UTC(2020, 0, 1 + n)),
    ...over,
  });

  const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name);
  /** The next day, as the batches see it — the limit counts per business-local day */
  const pretendYesterday = () => db.execute(sql`UPDATE lead_retargets SET batch_date = batch_date - 1`);

  it('hands out the oldest leads, a hundred a day, and never the same lead twice', async () => {
    const bdm = await actingAsRole('SALES');
    await db.insert(leads).values(Array.from({ length: DAILY_RETARGET_LIMIT + 5 }, (_, i) => old(i + 1, { assignedTo: bdm.userId })));

    const first = await as(bdm).post('/api/crm/retargeting/allot').send({}).expect(200);
    expect(first.body).toMatchObject({ allotted: DAILY_RETARGET_LIMIT, remainingPool: 5 });

    const today = await as(bdm).get('/api/crm/retargeting/leads').expect(200);
    expect(today.body.rows).toHaveLength(DAILY_RETARGET_LIMIT);
    // Oldest first, and the five newest of the pool are the ones left over
    expect(names(today.body.rows).slice(0, 3)).toEqual(['Old 001', 'Old 002', 'Old 003']);
    expect(names(today.body.rows).at(-1)).toBe(`Old ${DAILY_RETARGET_LIMIT.toString().padStart(3, '0')}`);

    // Pressing the button again the same day tops the list up to the limit, it does not hand out another 100
    expect((await as(bdm).post('/api/crm/retargeting/allot').send({}).expect(200)).body).toMatchObject({
      allotted: 0,
      allottedToday: DAILY_RETARGET_LIMIT,
    });

    // Tomorrow the rest come through, and nothing from the first batch comes back
    await pretendYesterday();
    expect((await as(bdm).post('/api/crm/retargeting/allot').send({}).expect(200)).body).toMatchObject({ allotted: 5, remainingPool: 0 });
    const next = await as(bdm).get('/api/crm/retargeting/leads').expect(200);
    expect(names(next.body.rows)).toEqual(['Old 101', 'Old 102', 'Old 103', 'Old 104', 'Old 105']);

    // Nothing is left to retarget, so the button has nothing to give
    expect((await as(bdm).post('/api/crm/retargeting/allot').send({}).expect(200)).body).toMatchObject({ allotted: 0, remainingPool: 0 });
  });

  it('retargets a BDM their own quiet leads, not won deals, fresh enquiries or a colleague’s', async () => {
    const bdm = await actingAsRole('SALES');
    const colleague = await actingAsRole('SALES');
    await db.insert(leads).values([
      old(1, { assignedTo: bdm.userId, stage: 'LOST' }),
      old(2, { assignedTo: bdm.userId, stage: 'NEGOTIATION' }),
      old(3, { assignedTo: bdm.userId, stage: 'WON' }),
      old(4, { assignedTo: colleague.userId, stage: 'LOST' }),
      old(5, { assignedTo: bdm.userId, stage: 'LOST', lastContactAt: new Date() }),
      { companyName: 'Fresh enquiry', assignedTo: bdm.userId },
      old(6, { assignedTo: null, stage: 'LOST' }),
    ]);

    expect((await as(bdm).post('/api/crm/retargeting/allot').send({}).expect(200)).body.allotted).toBe(2);
    const { body } = await as(bdm).get('/api/crm/retargeting/leads').expect(200);
    expect(names(body.rows)).toEqual(['Old 001', 'Old 002']);
    // Their colleague's lost lead is still waiting for them, nobody's lead changed hands
    const board = await as(colleague).get('/api/crm/retargeting').expect(200);
    expect(board.body.rows).toHaveLength(1);
    expect(board.body.rows[0]).toMatchObject({ userId: colleague.userId, pool: 1, lostInPool: 1, allottedToday: 0 });
  });

  it('counts the follow-ups a BDM has made on today’s list', async () => {
    const admin = await actingAsRole('SUPER_ADMIN');
    const bdm = await actingAsRole('SALES');
    const inserted = await db.insert(leads).values([old(1, { assignedTo: bdm.userId }), old(2, { assignedTo: bdm.userId })]).returning({ id: leads.id });
    await as(bdm).post('/api/crm/retargeting/allot').send({}).expect(200);
    await db.insert(leadFollowups).values({ leadId: inserted[0].id, userId: bdm.userId, outcome: 'NOT_REACHABLE' });

    const [row] = (await as(admin).get(`/api/crm/retargeting?user=${bdm.userId}`).expect(200)).body.rows;
    expect(row).toMatchObject({ allottedToday: 2, doneToday: 1, pool: 0 });
    const { body } = await as(admin).get(`/api/crm/retargeting/leads?user=${bdm.userId}`).expect(200);
    expect(body.rows.map((r: { name: string; done: boolean }) => [r.name, r.done])).toEqual([['Old 001', true], ['Old 002', false]]);
    expect(body.days).toEqual([{ date: body.date, count: 2, done: 1 }]);
  });

  it('lets an admin press any BDM’s button, and a BDM only their own', async () => {
    const admin = await actingAsRole('SUPER_ADMIN');
    const bdm = await actingAsRole('SALES');
    const colleague = await actingAsRole('SALES');
    await db.insert(leads).values([old(1, { assignedTo: colleague.userId })]);

    await as(bdm).post('/api/crm/retargeting/allot').send({ userId: colleague.userId }).expect(403);
    await as(bdm).get(`/api/crm/retargeting/leads?user=${colleague.userId}`).expect(403);
    expect((await as(admin).post('/api/crm/retargeting/allot').send({ userId: colleague.userId }).expect(200)).body.allotted).toBe(1);
  });
});
