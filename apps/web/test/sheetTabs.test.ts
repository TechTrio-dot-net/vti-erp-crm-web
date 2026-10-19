import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { leadSources } from '../src/server/db/schema';
import { syncSource } from '../src/server/services/leadSources';
import { actingAsRole, as, db, resetDb } from './harness';

const SHEET = 'https://docs.google.com/spreadsheets/d/1fiV5duOEZ_bVEZhijWrBTk8kxTneFKmC3lrqmTlUXlg/edit';

/** A sheet shared by link: its web view lists the tabs, each tab downloads as CSV */
describe('Google Sheet tabs', () => {
  let tabs: Record<string, { title: string; rows: string[] }>;

  beforeEach(async () => {
    await resetDb();
    tabs = {
      '0': { title: 'Gujarat', rows: ['Old Gujarat,9800000001'] },
      '77': { title: 'MH | "May"', rows: ['Old MH,9800000002'] },
      '99': { title: 'UP', rows: ['Old UP,9800000003'] },
    };
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/htmlview')) {
        const items = Object.entries(tabs).map(([gid, t]) => `items.push({name: ${JSON.stringify(t.title).replace(/\//g, '\\/')}, pageUrl: "https:\\/\\/x\\/sheet?headers\\x3dtrue&gid=${gid}", gid: "${gid}",initialSheet: ("${gid}" == gid)})`);
        return new Response(`<html><script>${items.join(';')}</script></html>`);
      }
      const gid = url.match(/gid=(\d+)/)?.[1] ?? '0';
      return new Response(['full_name,phone_number', ...tabs[gid].rows].join('\n'));
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const leadNames = async () =>
    (await db.execute<{ name: string }>(sql`SELECT company_name AS name FROM leads ORDER BY 1`)).rows.map((r) => r.name);
  const source = async (id: string) => (await db.select().from(leadSources).where(sql`${leadSources.id} = ${id}`))[0];

  it('lists the tabs of a sheet and reads only the ticked ones, new rows only', async () => {
    const admin = await actingAsRole('SUPER_ADMIN');
    const listed = await as(admin).post('/api/integrations/sources/tabs').send({ sheetUrl: SHEET }).expect(200);
    expect(listed.body.tabs).toEqual([{ gid: '0', title: 'Gujarat' }, { gid: '77', title: 'MH | "May"' }, { gid: '99', title: 'UP' }]);

    const created = await as(admin).post('/api/integrations/sources').send({ name: 'Sheet', sheetUrl: SHEET, sheetTabGids: ['0', '77'] }).expect(201);
    expect(created.body.config.sheetTabs.map((t: { title: string }) => t.title)).toEqual(['Gujarat', 'MH | "May"']);

    // Rows already in the ticked tabs are remembered, not imported
    expect((await syncSource(await source(created.body.id))).baseline).toBe(2);
    expect(await leadNames()).toEqual([]);

    tabs['0'].rows.push('New Gujarat,9800000011');
    tabs['77'].rows.push('New MH,9800000012');
    tabs['99'].rows.push('New UP,9800000013');
    expect((await syncSource(await source(created.body.id))).imported).toBe(2);
    expect(await leadNames()).toEqual(['New Gujarat', 'New MH']);

    // A tab ticked later starts from its next new row
    await as(admin).patch(`/api/integrations/sources/${created.body.id}`).send({ sheetTabGids: ['0', '77', '99'] }).expect(200);
    await syncSource(await source(created.body.id));
    tabs['99'].rows.push('Newer UP,9800000023');
    await syncSource(await source(created.body.id));
    expect(await leadNames()).toEqual(['New Gujarat', 'New MH', 'Newer UP']);
  });

  it('keeps a source that read its first tab going when tabs are ticked', async () => {
    const admin = await actingAsRole('SUPER_ADMIN');
    const created = await as(admin).post('/api/integrations/sources').send({ name: 'Sheet', sheetUrl: SHEET }).expect(201);
    await syncSource(await source(created.body.id));
    tabs['0'].rows.push('New Gujarat,9800000011');

    await as(admin).patch(`/api/integrations/sources/${created.body.id}`).send({ sheetTabGids: ['0', '99'] }).expect(200);
    await syncSource(await source(created.body.id));
    expect(await leadNames()).toEqual(['New Gujarat']);
  });
});
