import { inArray } from 'drizzle-orm';
import { db } from '../db/index';
import { companySettings } from '../db/schema';
import { SETTINGS_KEY, flushLookups, forget, remember } from './cache';

const TTL_MS = 60 * 60 * 1000;

/** key → value for every setting */
export function allSettings(): Promise<Record<string, unknown>> {
  return remember(SETTINGS_KEY, TTL_MS, async () => {
    const rows = await db.select({ key: companySettings.key, value: companySettings.value }).from(companySettings);
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  });
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const value = (await allSettings())[key];
  return value === undefined || value === null ? fallback : (value as T);
}

export async function getString(key: string, fallback = ''): Promise<string> {
  return String(await getSetting<unknown>(key, fallback));
}

export async function getBoolean(key: string, fallback = false): Promise<boolean> {
  const value = await getSetting<unknown>(key, fallback);
  return value === true || value === 'true' || value === 1 || value === '1';
}

export async function getNumber(key: string, fallback = 0): Promise<number> {
  const value = Number(await getSetting<unknown>(key, fallback));
  return Number.isFinite(value) ? value : fallback;
}

/** Writes the given key → value pairs; unknown keys are ignored */
export async function updateSettings(values: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(values);
  if (!keys.length) return;
  await db.transaction(async (tx) => {
    const known = await tx.select({ id: companySettings.id, key: companySettings.key }).from(companySettings).where(inArray(companySettings.key, keys));
    for (const setting of known) {
      await tx
        .update(companySettings)
        .set({ value: values[setting.key] as never, updatedAt: new Date() })
        .where(inArray(companySettings.id, [setting.id]));
    }
  });
  flushSettings();
}

/** Clears the settings cache and the dropdown data derived from it */
export function flushSettings(): void {
  forget(SETTINGS_KEY);
  flushLookups();
}
