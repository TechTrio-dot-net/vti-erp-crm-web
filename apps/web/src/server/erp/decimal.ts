import Decimal from 'decimal.js';

/**
 * Money and duration arithmetic with HALF_UP rounding. Postgres numeric columns arrive as strings,
 * so values never pass through a binary float on their way to a total.
 */
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Anything the database or a request can hand us, as a Decimal. Null-ish and unparseable values are 0. */
export function dec(value: unknown): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  if (value instanceof Decimal) return value;
  try {
    const parsed = new Decimal(String(value));
    return parsed.isNaN() ? new Decimal(0) : parsed;
  } catch {
    return new Decimal(0);
  }
}

/** Fixed-2 string, e.g. "5250.00" — the shape every money field has in the API */
export function money(value: unknown): string {
  return dec(value).toFixed(2, Decimal.ROUND_HALF_UP);
}

/** Fixed-2 string, or null when the value was never set (keeps "no value" distinct from zero) */
export function moneyOrNull(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : money(value);
}

/** "3.00" → "3", "1.50" → "1.5" */
export function trimZeros(value: unknown): string {
  return dec(value).toFixed(2).replace(/\.?0+$/, '') || '0';
}

export { Decimal };
