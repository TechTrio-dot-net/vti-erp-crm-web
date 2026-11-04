import { beforeEach, describe, expect, it } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import { leadFollowups, leads } from '../src/server/db/schema';
import { logFollowup } from '../src/server/services/followups';
import { actingAsRole, db, resetDb, type Actor } from './harness';

/**
 * A lead nobody answers is tried again on a widening gap — tomorrow, two days, four days — and
 * closed on the fourth day of silence. Getting through at any point puts it back to normal.
 */
describe('Unanswered calls: the follow-up backoff', () => {
  const DAY = 86_400_000;
  let bdm: Actor;
  let leadId: string;
  /** Well in the past, so every simulated day is older than the rows the database stamps with now() */
  const base = new Date(Date.now() - 40 * DAY);
  const day = (offset: number) => new Date(base.getTime() + offset * DAY);

  beforeEach(async () => {
    await resetDb();
    bdm = await actingAsRole('SALES', { username: 'bdm1', inRotation: true });
    const [lead] = await db
      .insert(leads)
      .values({ companyName: 'Asha Traders', phone: '9876543210', phoneNormalized: '9876543210', assignedTo: bdm.userId })
      .returning();
    leadId = lead.id;
  });

  const leadNow = async () => (await db.select().from(leads).where(eq(leads.id, leadId)))[0];

  /**
   * Logs one call at `at`. The follow-up row is stamped with the database clock, so it is moved back
   * to the day we are pretending the call happened — that date is what the streak counts.
   */
  const callAt = async (at: Date, outcome: 'NOT_REACHABLE' | 'CONNECTED' = 'NOT_REACHABLE') => {
    await logFollowup(await leadNow(), bdm.userId, { outcome }, { at, clientRef: `${outcome}-${at.getTime()}` });
    const [newest] = await db
      .select({ id: leadFollowups.id })
      .from(leadFollowups)
      .where(eq(leadFollowups.leadId, leadId))
      .orderBy(desc(leadFollowups.createdAt))
      .limit(1);
    await db.update(leadFollowups).set({ createdAt: at }).where(eq(leadFollowups.id, newest.id));
    return leadNow();
  };

  it('books the next try a day, then two days, then four days out', async () => {
    expect((await callAt(day(0))).nextFollowupAt).toEqual(day(1));
    expect((await callAt(day(1))).nextFollowupAt).toEqual(day(3));
    expect((await callAt(day(3))).nextFollowupAt).toEqual(day(7));
  });

  it('gives up on the fourth day of silence', async () => {
    await callAt(day(0));
    await callAt(day(1));
    await callAt(day(3));
    const lead = await callAt(day(7));
    expect(lead).toMatchObject({ stage: 'LOST', lostReason: 'Not reachable', nextFollowupAt: null });
    expect(lead.closedAt).toBeInstanceOf(Date);
  });

  it('starts over once somebody picks up', async () => {
    await callAt(day(0));
    await callAt(day(1));
    await callAt(day(3), 'CONNECTED');
    // The run is broken, so the next miss is a first miss again — a day out, not four
    expect((await callAt(day(4))).nextFollowupAt).toEqual(day(5));
  });

  it('counts a day of redials once, so an afternoon of trying cannot close a lead', async () => {
    const morning = day(0);
    const afternoon = new Date(day(0).getTime() + 5 * 3600_000);
    await callAt(morning);
    const lead = await callAt(afternoon);
    // Still the first silent day: tomorrow from the later call, and nowhere near lost
    expect(lead).toMatchObject({ stage: 'AWARENESS', closedAt: null });
    expect(lead.nextFollowupAt).toEqual(new Date(afternoon.getTime() + DAY));
  });
});
