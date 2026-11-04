import { beforeEach, describe, expect, it } from 'vitest';
import { clients, leads, quotationPayments, quotations } from '../src/server/db/schema';
import { addMonths, dueReminders, firstSaturday, monthOf } from '../src/server/services/reorderReminders';
import { todayLocal } from '../src/server/lib/crm';
import { actingAsRole, as, db, resetDb } from './harness';

/** The monthly pop-up: who orders every month, and who stopped */
describe('Re-order reminders', () => {
  beforeEach(resetDb);

  const month = monthOf(todayLocal());
  const last = addMonths(month, -1);
  const before = addMonths(month, -2);
  const earlier = addMonths(month, -3);

  /** A customer who ordered in each of `months` — a won lead for the first, a paid quotation for the rest */
  async function customer(name: string, phone: string, bdm: string, months: string[]) {
    const [lead] = await db
      .insert(leads)
      .values({ companyName: name, phone, phoneNormalized: phone.slice(-10), stage: 'WON', assignedTo: bdm, closedAt: new Date(`${months[0]}-10T06:00:00Z`) })
      .returning();
    for (const m of months.slice(1)) {
      const [quotation] = await db.insert(quotations).values({ clientName: name, clientPhone: phone, leadId: lead.id, status: 'accepted' }).returning();
      await db.insert(quotationPayments).values({ quotationId: quotation.id, amount: '5000', receivedBy: 'cash', method: 'gpay', paidOn: `${m}-12` });
    }
    return lead;
  }

  it('asks for a call on the regulars, and on whoever skipped last month', async () => {
    const bdm = await actingAsRole('SALES');
    await customer('Monthly Media', '+91 90000 00001', bdm.userId, [before, last]);
    await customer('Gone Quiet Films', '+91 90000 00002', bdm.userId, [earlier, before]);
    await customer('Already Ordered', '+91 90000 00003', bdm.userId, [last, month]);
    await customer('One Off Studio', '+91 90000 00004', bdm.userId, [earlier]);

    const rows = await dueReminders({ month });
    expect(rows.map((r) => [r.name, r.kind])).toEqual([
      ['Monthly Media', 'reorder'],
      ['Gone Quiet Films', 'winback'],
    ]);
    // The regular's history is there for the BDM to see on the pop-up
    expect(rows[0].recentMonths).toEqual([last, before]);
  });

  it('shows a BDM only their own customers, and clears one for the month once answered', async () => {
    const admin = await actingAsRole('SUPER_ADMIN');
    const bdm = await actingAsRole('SALES');
    const colleague = await actingAsRole('SALES');
    await customer('Mine Ltd', '+91 90000 00005', bdm.userId, [before, last]);
    await customer('Theirs Ltd', '+91 90000 00006', colleague.userId, [before, last]);

    const board = await as(bdm).get('/api/crm/reminders').expect(200);
    expect(board.body.rows.map((r: { name: string }) => r.name)).toEqual(['Mine Ltd']);
    expect((await as(admin).get('/api/crm/reminders').expect(200)).body.rows).toHaveLength(2);

    const [mine] = board.body.rows;
    await as(bdm).post('/api/crm/reminders/action').send({ customerKey: mine.customerKey, leadId: mine.leadId, kind: 'reorder', action: 'called' }).expect(200);
    expect((await as(bdm).get('/api/crm/reminders').expect(200)).body.rows).toHaveLength(0);
    // Their colleague's customer is untouched by that answer
    expect((await as(admin).get('/api/crm/reminders').expect(200)).body.rows.map((r: { name: string }) => r.name)).toEqual(['Theirs Ltd']);
  });

  it('counts a repeat order against the client record, not just the phone number', async () => {
    const bdm = await actingAsRole('SALES');
    const [client] = await db
      .insert(clients)
      .values({ companyName: 'Repeat Co', contactName: 'Repeat', contactEmail: 'repeat@example.test', portalLogin: 'repeat' })
      .returning();
    // Two won leads for the same client, from different enquiries, are one customer ordering twice
    await db.insert(leads).values([
      { companyName: 'Repeat Co', phone: '+91 90000 00007', phoneNormalized: '9000000007', stage: 'WON', assignedTo: bdm.userId, clientId: client.id, closedAt: new Date(`${before}-05T06:00:00Z`) },
      { companyName: 'Repeat Co', phone: '+91 90000 00008', phoneNormalized: '9000000008', stage: 'WON', assignedTo: bdm.userId, clientId: client.id, closedAt: new Date(`${last}-05T06:00:00Z`) },
    ]);

    const rows = await dueReminders({ month });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Repeat Co', kind: 'reorder', customerKey: client.id });
  });

  it('opens on the first Saturday of the month', () => {
    // 1 November 2026 is a Sunday, so the team sees it on the 7th
    expect(firstSaturday('2026-11')).toBe('2026-11-07');
    // 1 August 2026 is itself a Saturday
    expect(firstSaturday('2026-08')).toBe('2026-08-01');
    expect(firstSaturday('2026-12')).toBe('2026-12-05');
  });
});
