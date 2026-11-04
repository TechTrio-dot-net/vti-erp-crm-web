import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { callLogs, leadFollowups, leads, quotations } from '../src/server/db/schema';
import { actingAsRole, as, db, resetDb, type Actor } from './harness';

/**
 * Client Leisure: one row per lead carrying the whole relationship — the day it came in, every call with its
 * timestamp, and every order with its date. A lost lead keeps its reason and still reports 0 orders.
 */
describe('Client Leisure', () => {
  const DAY = 86_400_000;
  let admin: Actor;
  let bdm: Actor;
  /** Fixed points in the recent past, so the default 90-day window always contains them */
  const base = new Date(Date.now() - 30 * DAY);
  const at = (days: number, hour = 11) => new Date(base.getTime() + days * DAY + hour * 3600_000);

  beforeEach(async () => {
    await resetDb();
    admin = await actingAsRole('SUPER_ADMIN', { username: 'boss' });
    bdm = await actingAsRole('SALES', { username: 'bdm1', inRotation: true });
  });

  const addLead = async (companyName: string, phone: string, extra: Partial<typeof leads.$inferInsert> = {}) => {
    const [lead] = await db
      .insert(leads)
      .values({ companyName, phone, phoneNormalized: phone.slice(-10), assignedTo: bdm.userId, ...extra })
      .returning();
    // created_at defaults to now(); the report buckets on it, so put the enquiry where the test wants it
    if (extra.createdAt) await db.execute(sql`UPDATE leads SET created_at = ${extra.createdAt} WHERE id = ${lead.id}`);
    return lead;
  };

  const addCall = async (leadId: string, startedAt: Date, durationSec: number) => {
    const [call] = await db
      .insert(callLogs)
      .values({
        source: 'device', externalId: `${leadId}-${startedAt.getTime()}`, userId: bdm.userId, leadId,
        phone: '9876543210', direction: 'outgoing', startedAt, durationSec,
      })
      .returning();
    return call;
  };

  const addOrder = async (createdAt: Date, values: Partial<typeof quotations.$inferInsert>) => {
    const [order] = await db
      .insert(quotations)
      .values({ clientName: 'Asha', status: 'accepted', grandTotal: '10000', ...values })
      .returning();
    await db.execute(sql`UPDATE quotations SET created_at = ${createdAt} WHERE id = ${order.id}`);
    return order;
  };

  const list = async (query = '') => (await as(admin).get(`/api/crm/reports/client-leisure${query}`).expect(200)).body.rows;

  it('shows when the lead came, its first call and every order in order', async () => {
    const lead = await addLead('Asha Traders', '9876543210', { createdAt: at(0, 9) });
    await addCall(lead.id, at(0, 10), 0);
    await addCall(lead.id, at(1, 15), 240);
    await addOrder(at(3), { leadId: lead.id, grandTotal: '10000', amountPaid: '4000' });
    await addOrder(at(20), { leadId: lead.id, grandTotal: '25000' });

    const [row] = await list();
    expect(row).toMatchObject({ name: 'Asha Traders', calls: 2, callsConnected: 1, talkSec: 240, orders: 2, orderValue: 35000, orderPaid: 4000 });
    expect(new Date(row.cameAt)).toEqual(at(0, 9));
    expect(new Date(row.firstCallAt)).toEqual(at(0, 10));
    expect(new Date(row.lastCallAt)).toEqual(at(1, 15));
    expect(new Date(row.firstOrderAt)).toEqual(at(3));
    expect(new Date(row.lastOrderAt)).toEqual(at(20));

    // The timeline: both calls oldest first, and the orders numbered the way the team counts them
    const { body } = await as(admin).get(`/api/crm/reports/client-leisure/${lead.id}`).expect(200);
    expect(body.calls.map((c: { at: string; kind: string }) => [c.kind, c.at])).toEqual([
      ['call', at(0, 10).toISOString()],
      ['call', at(1, 15).toISOString()],
    ]);
    expect(body.orders.map((o: { at: string; total: number }) => [o.at, o.total])).toEqual([
      [at(3).toISOString(), 10000],
      [at(20).toISOString(), 25000],
    ]);
  });

  it('keeps the calls and the reason on a lost lead, with 0 orders', async () => {
    const lead = await addLead('Gone Cold', '9000000001', {
      createdAt: at(0), stage: 'LOST', lostReason: 'Price too high', closedAt: at(5),
    });
    await addCall(lead.id, at(0, 12), 0);
    await addCall(lead.id, at(2, 12), 95);

    const [row] = await list();
    expect(row).toMatchObject({ stage: 'LOST', lostReason: 'Price too high', calls: 2, orders: 0, orderValue: 0 });
    expect(row.firstOrderAt).toBeNull();

    const { body } = await as(admin).get(`/api/crm/reports/client-leisure/${lead.id}`).expect(200);
    expect(body.orders).toEqual([]);
    expect(body.calls).toHaveLength(2);
    expect(body.lead.lostReason).toBe('Price too high');
  });

  it('counts a call written up on the website, which has no phone record of its own', async () => {
    const lead = await addLead('Web Only', '9000000002', { createdAt: at(0) });
    const call = await addCall(lead.id, at(0, 12), 120);
    await db.insert(leadFollowups).values([
      // The after-call form for the phone call above: the same call, not a second one
      { leadId: lead.id, userId: bdm.userId, outcome: 'INTERESTED', callLogId: call.id, note: 'Wants a sample' },
      { leadId: lead.id, userId: bdm.userId, outcome: 'CALL_BACK', note: 'Rang from the office line' },
    ]);

    const [row] = await list();
    expect(row.calls).toBe(2);
    const { body } = await as(admin).get(`/api/crm/reports/client-leisure/${lead.id}`).expect(200);
    expect(body.calls.map((c: { kind: string; outcome: string | null }) => [c.kind, c.outcome])).toEqual([
      ['call', 'INTERESTED'],
      ['followup', 'CALL_BACK'],
    ]);
  });

  it('finds an order raised from the quotation screen, by the client phone number', async () => {
    const lead = await addLead('By Phone', '919000000003', { createdAt: at(0) });
    await addOrder(at(4), { clientPhone: '+91 90000 00003', grandTotal: '5000' });

    const [row] = await list();
    expect(row).toMatchObject({ orders: 1, orderValue: 5000 });
    const { body } = await as(admin).get(`/api/crm/reports/client-leisure/${lead.id}`).expect(200);
    expect(body.orders).toHaveLength(1);
  });

  it('counts only accepted or paid quotations as orders, unless asked for all of them', async () => {
    const lead = await addLead('Quoted', '9000000004', { createdAt: at(0) });
    await addOrder(at(1), { leadId: lead.id, status: 'draft', grandTotal: '1000' });
    await addOrder(at(2), { leadId: lead.id, status: 'sent', grandTotal: '2000' });
    await addOrder(at(3), { leadId: lead.id, status: 'rejected', grandTotal: '4000' });
    await addOrder(at(4), { leadId: lead.id, status: 'sent', grandTotal: '8000', amountPaid: '1000' });

    // Confirmed: the one that was paid against. Sent-but-unpaid, rejected and draft are not orders.
    expect(await list()).toMatchObject([{ orders: 1, orderValue: 8000, orderPaid: 1000 }]);
    // Every quotation that reached the client: the two sent ones. A draft still never counts.
    expect(await list('?orders=all')).toMatchObject([{ orders: 2, orderValue: 10000 }]);
  });

  it('counts the tiles over the whole period, whichever tile narrows the rows', async () => {
    const bought = await addLead('Bought twice', '9000000007', { createdAt: at(0) });
    const once = await addLead('Bought once', '9000000008', { createdAt: at(0) });
    await addLead('Lost one', '9000000009', { createdAt: at(0), stage: 'LOST', lostReason: 'Not reachable', closedAt: at(2) });
    await addCall(bought.id, at(0, 10), 60);
    await addOrder(at(1), { leadId: bought.id, grandTotal: '1000', amountPaid: '400' });
    await addOrder(at(2), { leadId: bought.id, grandTotal: '2000' });
    await addOrder(at(1), { leadId: once.id, grandTotal: '3000' });

    const totals = { leads: 3, ordered: 2, repeat: 1, lost: 1, calls: 1, value: 6000, paid: 400 };
    const all = await as(admin).get('/api/crm/reports/client-leisure').expect(200);
    expect(all.body.totals).toMatchObject(totals);
    expect(all.body.rows).toHaveLength(3);
    expect(all.body.capped).toBe(false);

    // Pressing a tile narrows the rows and leaves every tile's number where it was
    const ordered = await as(admin).get('/api/crm/reports/client-leisure?has=ordered').expect(200);
    expect(ordered.body.totals).toMatchObject(totals);
    expect(ordered.body.rows.map((r: { name: string }) => r.name).sort()).toEqual(['Bought once', 'Bought twice']);

    const repeat = await as(admin).get('/api/crm/reports/client-leisure?has=repeat').expect(200);
    expect(repeat.body.totals).toMatchObject(totals);
    expect(repeat.body.rows.map((r: { name: string }) => r.name)).toEqual(['Bought twice']);
  });

  it('is closed to the BDMs and filters by stage', async () => {
    await addLead('Won one', '9000000005', { createdAt: at(0), stage: 'WON', closedAt: at(1) });
    await addLead('Open one', '9000000006', { createdAt: at(0) });

    await as(bdm).get('/api/crm/reports/client-leisure').expect(403);
    expect(await list('?stage=won')).toMatchObject([{ name: 'Won one' }]);
    expect(await list('?stage=open')).toMatchObject([{ name: 'Open one' }]);
    expect(await list()).toHaveLength(2);
  });
});
