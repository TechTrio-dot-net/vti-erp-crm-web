import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { leadFollowups, leadSources, leads } from '../src/server/db/schema';
import { syncSource } from '../src/server/services/leadSources';
import { mergeIntoOldCrmLeads } from '../src/server/services/legacyMerge';
import { actingAsRole, as, db, resetDb } from './harness';

const SHEET = 'https://docs.google.com/spreadsheets/d/1fiV5duOEZ_bVEZhijWrBTk8kxTneFKmC3lrqmTlUXlg/edit';
const DAY = 86_400_000;

/** Connecting the sheet with every tab ticked while the old CRM still runs: no client twice, no two BDMs */
describe('Google Sheet with the old CRM alongside', () => {
  let tabs: Record<string, string[]>;
  beforeEach(async () => {
    await resetDb();
    tabs = { '0': ['Old row,9800000001'], '5': ['Old other tab,9800000002'] };
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/htmlview')) {
        return new Response(Object.keys(tabs).map((gid) => `items.push({name: "Tab ${gid}", pageUrl: "x", gid: "${gid}",initialSheet: false})`).join(';'));
      }
      return new Response(['full_name,phone_number', ...tabs[url.match(/gid=(\d+)/)![1]]].join('\n'));
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const all = async () =>
    (await db.execute<{ name: string; owner: string | null; legacy: boolean }>(sql`
      SELECT l.company_name AS name, u.username AS owner, coalesce(l.external_id LIKE 'legacy-crm:%', false) AS legacy
      FROM leads l LEFT JOIN users u ON u.id = l.assigned_to ORDER BY l.company_name`)).rows;

  it('imports only new rows, adds repeats to the open lead, and folds the same enquiry into the old CRM lead', async () => {
    const admin = await actingAsRole('SUPER_ADMIN');
    const hasti = await actingAsRole('SALES', { username: 'hasti' });
    const krishna = await actingAsRole('SALES', { username: 'krishna' });
    await as(krishna).post(`/api/crm/bdms/${krishna.userId}/start`).send({}).expect(200);
    // Hasti has this customer open in the old CRM
    await db.insert(leads).values({ companyName: 'Old CRM customer', phone: '9800000077', phoneNormalized: '9800000077', externalId: 'legacy-crm:1', assignedTo: hasti.userId, stage: 'PROPOSAL', createdAt: new Date(Date.now() - 30 * DAY) });

    const created = await as(admin).post('/api/integrations/sources').send({ name: 'Sheet', sheetUrl: SHEET, sheetTabGids: ['0', '5'] }).expect(201);
    const source = async () => (await db.select().from(leadSources).where(sql`${leadSources.id} = ${created.body.id}`))[0];
    await syncSource(await source());
    expect((await all()).map((l) => l.name)).toEqual(['Old CRM customer']); // nothing old imported

    // A repeat enquiry from Hasti's customer, in another tab, and a genuinely new one
    tabs['5'].push('Same customer again,+91 98000 00077');
    tabs['0'].push('New customer,9800000099');
    tabs['5'].push('New customer,9800000099'); // the same person filled the form in two tabs
    await syncSource(await source());
    expect(await all()).toEqual([
      { name: 'New customer', owner: 'krishna', legacy: false },
      { name: 'Old CRM customer', owner: 'hasti', legacy: true },
    ]);

    // Krishna already called the new customer; then the old CRM logs the same enquiry for Diya
    const diya = await actingAsRole('SALES', { username: 'diya' });
    const [fresh] = await db.select().from(leads).where(sql`${leads.companyName} = 'New customer'`);
    await db.insert(leadFollowups).values({ leadId: fresh.id, userId: krishna.userId, outcome: 'CALL_BACK', note: 'Call tomorrow' });
    await db.insert(leads).values({ companyName: 'New customer (old CRM)', phone: '9800000099', phoneNormalized: '9800000099', externalId: 'legacy-crm:2', assignedTo: diya.userId, stage: 'AWARENESS' });
    expect(await mergeIntoOldCrmLeads()).toBe(1);
    expect(await all()).toEqual([
      { name: 'New customer (old CRM)', owner: 'diya', legacy: true },
      { name: 'Old CRM customer', owner: 'hasti', legacy: true },
    ]);
    const moved = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM lead_followups WHERE note = 'Call tomorrow' AND lead_id = (SELECT id FROM leads WHERE external_id = 'legacy-crm:2')`);
    expect(moved.rows[0].n).toBe(1); // Krishna's call is kept on the merged lead
  });

  it('keeps a new enquiry from a number whose old CRM lead was an earlier, finished one', async () => {
    const hasti = await actingAsRole('SALES', { username: 'hasti' });
    await db.insert(leads).values({ companyName: 'Lost in March', phone: '9800000055', phoneNormalized: '9800000055', externalId: 'legacy-crm:3', assignedTo: hasti.userId, stage: 'LOST', createdAt: new Date(Date.now() - 200 * DAY) });
    await db.insert(leads).values({ companyName: 'Back in October', phone: '9800000055', phoneNormalized: '9800000055', assignedTo: hasti.userId, stage: 'AWARENESS' });
    expect(await mergeIntoOldCrmLeads()).toBe(0);
    expect((await all()).map((l) => l.name)).toEqual(['Back in October', 'Lost in March']);
  });
});
