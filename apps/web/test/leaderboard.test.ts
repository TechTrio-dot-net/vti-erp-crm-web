import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { leads } from '../src/server/db/schema';
import { actingAsRole, as, db, resetDb } from './harness';

/** Leader Dashboard: the clients behind a BDM's "Won" number, opened from their name */
describe('Leader Dashboard — clients closed', () => {
  beforeEach(resetDb);

  it('lists exactly the clients counted in the Won column', async () => {
    const admin = await actingAsRole('SUPER_ADMIN');
    const krishna = await actingAsRole('SALES', { username: 'krishna', name: 'Krishna' });
    const other = await actingAsRole('SALES', { username: 'other', name: 'Other' });
    await db.insert(leads).values([
      { companyName: 'Closed one', assignedTo: krishna.userId, stage: 'WON', estimatedValue: 50000 },
      { companyName: 'Closed two', assignedTo: krishna.userId, stage: 'WON', estimatedValue: 25000 },
      { companyName: 'Still talking', assignedTo: krishna.userId, stage: 'NEGOTIATION' },
      { companyName: 'Lost one', assignedTo: krishna.userId, stage: 'LOST' },
      { companyName: 'Someone else won', assignedTo: other.userId, stage: 'WON', estimatedValue: 90000 },
    ]);
    await db.execute(sql`UPDATE leads SET assigned_at = now(), closed_at = now()`);

    const board = await as(admin).get('/api/crm/reports/leaderboard').expect(200);
    const row = board.body.rows.find((r: { name: string }) => r.name === 'Krishna');
    expect(row.won).toBe(2);

    const won = await as(admin).get(`/api/crm/reports/leaderboard/won?user=${krishna.userId}`).expect(200);
    expect(won.body.rows).toHaveLength(row.won);
    expect(won.body.rows.map((r: { name: string }) => r.name).sort()).toEqual(['Closed one', 'Closed two']);
    expect(won.body.total).toBe(75000);
  });

  it('ranks on the revenue closed, not the number of deals', async () => {
    const admin = await actingAsRole('SUPER_ADMIN');
    const big = await actingAsRole('SALES', { username: 'big', name: 'Big Deal' });
    const many = await actingAsRole('SALES', { username: 'many', name: 'Many Deals' });
    await db.insert(leads).values([
      { companyName: 'One big one', assignedTo: big.userId, stage: 'WON', estimatedValue: 77000 },
      ...[1, 2, 3, 4, 5].map((n) => ({ companyName: `Small ${n}`, assignedTo: many.userId, stage: 'WON' as const, estimatedValue: 3000 })),
    ]);
    await db.execute(sql`UPDATE leads SET assigned_at = now(), closed_at = now()`);

    const { body } = await as(admin).get('/api/crm/reports/leaderboard').expect(200);
    const [first, second] = body.rows as Array<{ name: string; won: number; wonValue: number }>;
    expect(first.name).toBe('Big Deal');
    expect(first.wonValue).toBe(77000);
    expect(second.name).toBe('Many Deals');
    expect(second.won).toBe(5);
  });

  it('counts every deal closed in the period, however old the lead is', async () => {
    const admin = await actingAsRole('SUPER_ADMIN');
    const krishna = await actingAsRole('SALES', { username: 'krishna', name: 'Krishna' });
    await db.insert(leads).values([
      { companyName: 'Won today, assigned in May', assignedTo: krishna.userId, stage: 'WON', estimatedValue: 10000 },
      { companyName: 'Won today, assigned today', assignedTo: krishna.userId, stage: 'WON', estimatedValue: 5000 },
      { companyName: 'Won before the period', assignedTo: krishna.userId, stage: 'WON', estimatedValue: 99000 },
    ]);
    // An old lead the BDM has only just closed, and one they closed long before this period began
    await db.execute(sql`UPDATE leads SET assigned_at = now() - interval '150 days', closed_at = now() WHERE company_name = 'Won today, assigned in May'`);
    await db.execute(sql`UPDATE leads SET assigned_at = now(), closed_at = now() WHERE company_name = 'Won today, assigned today'`);
    await db.execute(sql`UPDATE leads SET assigned_at = now() - interval '150 days', closed_at = now() - interval '120 days' WHERE company_name = 'Won before the period'`);

    const board = await as(admin).get('/api/crm/reports/leaderboard').expect(200);
    const row = board.body.rows.find((r: { name: string }) => r.name === 'Krishna');
    expect(row.won).toBe(2);
    expect(row.wonValue).toBe(15000);

    const won = await as(admin).get(`/api/crm/reports/leaderboard/won?user=${krishna.userId}`).expect(200);
    expect(won.body.rows).toHaveLength(row.won);
    expect(won.body.rows.map((r: { name: string }) => r.name).sort()).toEqual(['Won today, assigned in May', 'Won today, assigned today']);
    expect(won.body.total).toBe(15000);
  });

  it('only ever shows a BDM their own closed clients', async () => {
    const krishna = await actingAsRole('SALES', { username: 'krishna', name: 'Krishna' });
    const other = await actingAsRole('SALES', { username: 'other', name: 'Other' });
    await db.insert(leads).values([
      { companyName: 'Krishna won', assignedTo: krishna.userId, stage: 'WON' },
      { companyName: 'Other won', assignedTo: other.userId, stage: 'WON' },
    ]);
    await db.execute(sql`UPDATE leads SET assigned_at = now(), closed_at = now()`);

    // Asking for someone else's still answers with the caller's own — and says so, so the screen can't
    // put a colleague's name over this BDM's own clients
    const { body } = await as(krishna).get(`/api/crm/reports/leaderboard/won?user=${other.userId}`).expect(200);
    expect(body.rows.map((r: { name: string }) => r.name)).toEqual(['Krishna won']);
    expect(body.user).toMatchObject({ id: krishna.userId, name: 'Krishna' });
  });
});
