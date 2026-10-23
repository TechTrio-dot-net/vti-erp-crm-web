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

  it('only ever shows a BDM their own closed clients', async () => {
    const krishna = await actingAsRole('SALES', { username: 'krishna', name: 'Krishna' });
    const other = await actingAsRole('SALES', { username: 'other', name: 'Other' });
    await db.insert(leads).values([
      { companyName: 'Krishna won', assignedTo: krishna.userId, stage: 'WON' },
      { companyName: 'Other won', assignedTo: other.userId, stage: 'WON' },
    ]);
    await db.execute(sql`UPDATE leads SET assigned_at = now(), closed_at = now()`);

    // Asking for someone else's still answers with the caller's own
    const { body } = await as(krishna).get(`/api/crm/reports/leaderboard/won?user=${other.userId}`).expect(200);
    expect(body.rows.map((r: { name: string }) => r.name)).toEqual(['Krishna won']);
  });
});
