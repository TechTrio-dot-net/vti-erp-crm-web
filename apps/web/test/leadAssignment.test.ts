import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { leads } from '../src/server/db/schema';
import { assignWaitingLeads } from '../src/server/services/leadAssignment';
import { intakeLead } from '../src/server/services/leadIntake';
import { actingAsRole, as, db, resetDb } from './harness';

/** Leads that arrived while nobody was online, handed out when the team presses Start */
describe('Waiting leads', () => {
  beforeEach(resetDb);

  const perBdm = async () => {
    const { rows } = await db.execute<{ username: string; n: number }>(sql`
      SELECT u.username, count(l.id)::int AS n FROM users u LEFT JOIN leads l ON l.assigned_to = u.id WHERE u.role = 'SALES' GROUP BY 1 ORDER BY 1`);
    return Object.fromEntries(rows.map((r) => [r.username, r.n]));
  };

  it('holds the backlog while the team comes online, then shares it in turn', async () => {
    const admin = await actingAsRole('SUPER_ADMIN');
    const first = await actingAsRole('SALES', { username: 'first' });
    const second = await actingAsRole('SALES', { username: 'second' });
    await db.insert(leads).values(Array.from({ length: 10 }, (_, i) => ({ companyName: `Waiting ${i}` })));

    // The first BDM online does not take the whole backlog…
    const started = await as(admin).post(`/api/crm/bdms/${first.userId}/start`).send({}).expect(200);
    expect(started.body.assignedWaiting).toBe(0);
    expect(await perBdm()).toEqual({ first: 0, second: 0 });

    // …a colleague starts a minute later; once the team has had its ten minutes the leads are shared
    await as(admin).post(`/api/crm/bdms/${second.userId}/start`).send({}).expect(200);
    await db.execute(sql`UPDATE bdm_sessions SET started_at = now() - interval '11 minutes'`);
    expect(await assignWaitingLeads()).toBe(10);
    expect(await perBdm()).toEqual({ first: 5, second: 5 });
  });

  it('gives a returning number to the BDM who had it before, not to whoever is next', async () => {
    const admin = await actingAsRole('SUPER_ADMIN');
    const earlier = await actingAsRole('SALES', { username: 'earlier' });
    const next = await actingAsRole('SALES', { username: 'next' });
    await as(admin).post(`/api/crm/bdms/${earlier.userId}/start`).send({}).expect(200);
    await as(admin).post(`/api/crm/bdms/${next.userId}/start`).send({}).expect(200);
    // The customer was this BDM's lead and was lost; "earlier" has also just been given a lead, so "next" is due
    await db.insert(leads).values({ companyName: 'Old enquiry', phone: '9876500000', phoneNormalized: '9876500000', stage: 'LOST', assignedTo: earlier.userId });
    await db.execute(sql`UPDATE users SET last_assigned_at = now() WHERE id = ${earlier.userId}`);

    const again = await intakeLead({ name: 'Back again', phone: '+91 98765 00000', source: 'Google Sheet' });
    expect(again).toMatchObject({ status: 'created', assignedTo: earlier.userId });
    // A number nobody has had goes through the normal rotation
    const fresh = await intakeLead({ name: 'Brand new', phone: '9876511111', source: 'Google Sheet' });
    expect(fresh).toMatchObject({ status: 'created', assignedTo: next.userId });
  });

  it('hands the backlog out at once when forced', async () => {
    const admin = await actingAsRole('SUPER_ADMIN');
    const only = await actingAsRole('SALES', { username: 'only' });
    await db.insert(leads).values([{ companyName: 'A' }, { companyName: 'B' }]);
    await as(admin).post(`/api/crm/bdms/${only.userId}/start`).send({}).expect(200);
    expect(await assignWaitingLeads({ force: true })).toBe(2);
  });
});
