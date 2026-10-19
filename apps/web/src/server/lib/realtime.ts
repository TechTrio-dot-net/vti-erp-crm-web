import { sql } from 'drizzle-orm';
import { db } from '../db/index';
import { appSignals } from '../db/schema';
import { background } from './background';

/**
 * Live updates without sockets: serverless functions can't hold connections open, so the website polls
 * GET /api/realtime every few seconds. Notifications are read straight from their table; everything else
 * is a change counter per topic that the page compares with the value it saw last.
 */
export type SignalKey = 'kanban' | 'crm';

export async function bumpSignal(key: SignalKey): Promise<void> {
  await db
    .insert(appSignals)
    .values({ key, version: 1 })
    .onConflictDoUpdate({ target: appSignals.key, set: { version: sql`${appSignals.version} + 1`, updatedAt: new Date() } });
}

/** Records the change after the response, without making the request wait for it */
function signal(key: SignalKey) {
  void background(bumpSignal(key), `Realtime: ${key}`);
}

/** Tells open task/project boards to refetch */
export function emitKanbanUpdated(_payload: object = {}) {
  signal('kanban');
}

/** Tells open CRM pages to refetch (calls and follow-ups arriving from phones) */
export function emitCrmUpdated() {
  signal('crm');
}

export async function readSignals(): Promise<Record<string, number>> {
  const rows = await db.select({ key: appSignals.key, version: appSignals.version }).from(appSignals);
  return Object.fromEntries(rows.map((r) => [r.key, Number(r.version)]));
}
