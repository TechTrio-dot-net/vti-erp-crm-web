import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { dialRequests, mobileDevices, type DialRequestStatus } from '../db/schema';

/**
 * Website Call button → the user's phone.
 * The Android app keeps one long-poll request open (POLL_MS). Serverless instances share nothing in
 * memory, so both sides watch the dial_requests table: the poll checks for a new click every
 * CHECK_MS, the click waits for the phone's answer the same way. A click reaches the phone in ~1 second.
 */
/** How long one poll is held open (the phone asks again straight away) — well under the function limit */
export const POLL_MS = 25_000;
/** How often a waiting request looks at the table */
const CHECK_MS = 1_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** A phone that hasn't checked in for this long is treated as offline */
const ONLINE_SEC = 75;
/** A click the phone hasn't picked up within this window is never dialled later */
const CLAIM_WINDOW_SEC = 15;

export type DialRequestRow = typeof dialRequests.$inferSelect;

export async function touchDevice(userId: string, deviceId: string, info: { deviceName: string | null; appVersion: string | null; canDial: boolean }) {
  await db
    .insert(mobileDevices)
    .values({ userId, deviceId, ...info, lastSeenAt: new Date() })
    .onConflictDoUpdate({
      target: [mobileDevices.userId, mobileDevices.deviceId],
      set: {
        deviceName: sql`coalesce(excluded.device_name, ${mobileDevices.deviceName})`,
        appVersion: sql`coalesce(excluded.app_version, ${mobileDevices.appVersion})`,
        canDial: info.canDial,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

/** The user's most recently connected phone that can dial, if any */
export async function onlineDialer(userId: string) {
  const [device] = await db
    .select({ deviceId: mobileDevices.deviceId, deviceName: mobileDevices.deviceName })
    .from(mobileDevices)
    .where(and(eq(mobileDevices.userId, userId), eq(mobileDevices.canDial, true), gt(mobileDevices.lastSeenAt, sql`now() - make_interval(secs => ${ONLINE_SEC})`)))
    .orderBy(desc(mobileDevices.lastSeenAt))
    .limit(1);
  return device ?? null;
}

export async function createDialRequest(values: { userId: string; leadId: string; phone: string; contactName: string | null }) {
  const [row] = await db.insert(dialRequests).values(values).returning();
  return row;
}

/** Hands the oldest fresh request to one phone (a second phone of the same user can't take it too) */
export async function claimDialRequest(userId: string, deviceId: string): Promise<DialRequestRow | null> {
  const { rows } = await db.execute<{ id: string }>(sql`
    UPDATE dial_requests SET status = 'sent', device_id = ${deviceId}, delivered_at = now(), updated_at = now()
    WHERE id = (
      SELECT id FROM dial_requests
      WHERE user_id = ${userId} AND status = 'pending' AND created_at > now() - make_interval(secs => ${CLAIM_WINDOW_SEC})
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id`);
  if (!rows[0]) return null;
  const [row] = await db.select().from(dialRequests).where(eq(dialRequests.id, rows[0].id)).limit(1);
  return row ?? null;
}

/** Cheap check used while a poll waits: is there a fresh click for this user? */
async function hasPendingRequest(userId: string): Promise<boolean> {
  const { rows } = await db.execute<{ one: number }>(sql`
    SELECT 1 AS one FROM dial_requests
    WHERE user_id = ${userId} AND status = 'pending' AND created_at > now() - make_interval(secs => ${CLAIM_WINDOW_SEC})
    LIMIT 1`);
  return rows.length > 0;
}

/**
 * Holds the poll until a request for the user can be claimed, the time is up or the phone hangs up.
 * Returns the claimed request, if any.
 */
export async function waitAndClaim(userId: string, deviceId: string, ms: number, isClosed: () => boolean): Promise<DialRequestRow | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !isClosed()) {
    await sleep(Math.min(CHECK_MS, Math.max(0, deadline - Date.now())));
    if (isClosed()) return null;
    if (await hasPendingRequest(userId)) {
      const claimed = await claimDialRequest(userId, deviceId);
      if (claimed) return claimed;
    }
  }
  return null;
}

export async function reportDialResult(userId: string, id: string, status: 'dialing' | 'failed', error: string | null) {
  const [row] = await db
    .update(dialRequests)
    .set({ status, error: error?.slice(0, 300) ?? null })
    .where(and(eq(dialRequests.id, id), eq(dialRequests.userId, userId), eq(dialRequests.status, 'sent')))
    .returning({ id: dialRequests.id });
  return !!row;
}

/**
 * Waits for the phone to report whether it started dialling. A request no phone picked up in time is
 * marked expired, so it can't unexpectedly ring later.
 */
export async function awaitDialOutcome(id: string, ms: number): Promise<{ status: DialRequestStatus; error: string | null }> {
  const read = async () => {
    const [row] = await db.select({ status: dialRequests.status, error: dialRequests.error }).from(dialRequests).where(eq(dialRequests.id, id)).limit(1);
    return row ?? { status: 'expired' as const, error: null };
  };
  const deadline = Date.now() + ms;
  let current = await read();
  while ((current.status === 'pending' || current.status === 'sent') && Date.now() < deadline) {
    await sleep(Math.min(700, Math.max(0, deadline - Date.now())));
    current = await read();
  }
  if (current.status === 'pending') {
    const [expired] = await db
      .update(dialRequests)
      .set({ status: 'expired' })
      .where(and(eq(dialRequests.id, id), eq(dialRequests.status, 'pending')))
      .returning({ status: dialRequests.status, error: dialRequests.error });
    if (expired) return expired;
    return read();
  }
  return current;
}
