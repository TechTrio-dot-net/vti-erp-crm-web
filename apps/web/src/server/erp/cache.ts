/**
 * In-process cache for dropdown data, settings and dashboard figures. Every write that affects a
 * cached value clears it, so a single API process always serves fresh data; with several processes a
 * value can be at most `ttl` old on the others.
 */
const store = new Map<string, { value: unknown; expires: number }>();

export async function remember<T>(key: string, ttlMs: number, build: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await build();
  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

export function forget(prefix: string): void {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}

export function forgetAll(): void {
  store.clear();
}

export const LOOKUPS_KEY = 'lookups:quotation-form';
export const SETTINGS_KEY = 'settings:all';
export const DASHBOARD_PREFIX = 'dashboard:';

/** Dropdown data changed (catalog, settings) */
export const flushLookups = () => forget(LOOKUPS_KEY);

/** Quotation figures changed */
export const flushDashboard = () => forget(DASHBOARD_PREFIX);
