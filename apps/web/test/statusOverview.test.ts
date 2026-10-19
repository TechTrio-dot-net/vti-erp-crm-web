import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { leads } from '../src/server/db/schema';
import { actingAsRole, as, db, resetDb } from './harness';

const DAY = 86_400_000;

/** The old CRM's BDM dashboard: live / due / overdue / lost and the live leads by status */
describe('Leads Status Overview', () => {
  beforeEach(resetDb);

  it('counts like the old CRM, only the BDM own leads', async () => {
    const bdm = await actingAsRole('SALES', { username: 'manan' });
    const other = await actingAsRole('SALES', { username: 'other' });
    const now = Date.now();
    await db.insert(leads).values([
      { companyName: 'Hot due today', assignedTo: bdm.userId, stage: 'PROPOSAL', statusLabel: 'Hot', nextFollowupAt: new Date(now) },
      { companyName: 'Hot late', assignedTo: bdm.userId, stage: 'PROPOSAL', statusLabel: 'Hot', nextFollowupAt: new Date(now - 3 * DAY) },
      { companyName: 'Not interested (live in old CRM)', assignedTo: bdm.userId, stage: 'LOST', statusLabel: 'Not Interested' },
      { companyName: 'Lost', assignedTo: bdm.userId, stage: 'LOST', statusLabel: 'Lost' },
      { companyName: 'Lost here', assignedTo: bdm.userId, stage: 'LOST' },
      { companyName: 'Won', assignedTo: bdm.userId, stage: 'WON' },
      { companyName: 'New today', assignedTo: bdm.userId, stage: 'AWARENESS', nextFollowupAt: new Date(now + 2 * DAY) },
      { companyName: 'Someone else', assignedTo: other.userId, stage: 'PROPOSAL', statusLabel: 'Hot' },
    ]);
    await db.execute(sql`UPDATE leads SET created_at = now() - interval '10 days' WHERE company_name <> 'New today'`);

    const { body } = await as(bdm).get('/api/crm/reports/status-overview').expect(200);
    expect(body.cards).toMatchObject({ newToday: 1, newTodayPending: 1, live: 4, today: 1, overdue: 2, upcoming: 1, lost: 2 });
    expect(body.breakdown).toEqual([
      { status: 'Hot', today: 1, yesterday: 0, late: 1, upcoming: 0, total: 2 },
      { status: 'New', today: 0, yesterday: 0, late: 0, upcoming: 1, total: 1 },
      { status: 'Not Interested', today: 0, yesterday: 0, late: 1, upcoming: 0, total: 1 },
    ]);

    const late = await as(bdm).get('/api/crm/reports/status-overview/leads?status=Hot&when=late').expect(200);
    expect(late.body.rows.map((r: { name: string }) => r.name)).toEqual(['Hot late']);
    const fresh = await as(bdm).get('/api/crm/reports/status-overview/leads?kind=new-today').expect(200);
    expect(fresh.body.rows.map((r: { name: string }) => r.name)).toEqual(['New today']);
    await as(bdm).get('/api/crm/reports/status-overview/leads?kind=new-today&pending=1').expect(200);
    const yesterday = await as(bdm).get('/api/crm/reports/status-overview/leads?kind=new-yesterday&pending=1').expect(200);
    expect(yesterday.body.rows).toHaveLength(0);
    const lost = await as(bdm).get('/api/crm/reports/status-overview/leads?kind=lost').expect(200);
    expect(lost.body.rows).toHaveLength(2);
  });

  it('moves a lead out of its old status when its stage changes here', async () => {
    const bdm = await actingAsRole('SALES', { username: 'manan' });
    const [lead] = await db.insert(leads).values({ companyName: 'Was hot', assignedTo: bdm.userId, stage: 'PROPOSAL', statusLabel: 'Hot' }).returning();
    await as(bdm).patch(`/api/crm/leads/${lead.id}`).send({ stage: 'LOST' }).expect(200);
    const { body } = await as(bdm).get('/api/crm/reports/status-overview').expect(200);
    expect(body.cards).toMatchObject({ live: 0, lost: 1 });
  });
});
