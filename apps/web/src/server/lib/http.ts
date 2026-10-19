import type { Request, Response, NextFunction } from 'express';
import { getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** `router.param(name, uuidParam)` — malformed ids are a 404, not a database error */
export function uuidParam(_req: Request, res: Response, next: NextFunction, value: string): void {
  if (!isUuid(value)) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  next();
}

/** Validates an optional id coming from a query string or body */
export function optionalId(value: unknown, field = 'id'): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!isUuid(value)) throw new HttpError(400, `Invalid ${field}`);
  return value;
}

export function optionalDate(value: unknown, field = 'date'): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `Invalid ${field}`);
  return d;
}

/**
 * Copies whitelisted keys from a request body, coercing JSON values to what each column expects
 * (ISO strings → Date, "" → null for non-text columns, numeric strings → number, id validation).
 * Keys that are absent or undefined are skipped, matching Mongo `$set` semantics.
 */
export function pickColumns<T extends PgTable, K extends keyof T['$inferInsert'] & string>(
  table: T,
  body: unknown,
  allowed: readonly K[]
): Partial<Pick<T['$inferInsert'], K>> {
  const out: Record<string, unknown> = {};
  if (!body || typeof body !== 'object') return out as Partial<Pick<T['$inferInsert'], K>>;
  const columns = getTableColumns(table) as Record<string, { dataType: string; columnType: string }>;
  const input = body as Record<string, unknown>;

  for (const key of allowed) {
    let value = input[key];
    const column = columns[key];
    if (value === undefined || !column) continue;

    if (value === '' && column.columnType !== 'PgText') value = null;
    if (value !== null) {
      if (column.dataType === 'date') {
        value = optionalDate(value, key);
      } else if (column.dataType === 'number' && typeof value === 'string') {
        const n = Number(value);
        if (Number.isNaN(n)) throw new HttpError(400, `Invalid ${key}`);
        value = n;
      } else if (column.columnType === 'PgUUID') {
        value = optionalId(value, key);
      } else if (column.dataType === 'array' && !Array.isArray(value)) {
        throw new HttpError(400, `Invalid ${key}`);
      }
    }
    out[key] = value;
  }
  return out as Partial<Pick<T['$inferInsert'], K>>;
}

/** Postgres error → HTTP response. Unknown errors are logged and reported with the route's message. */
export function sendError(res: Response, err: unknown, fallbackMessage: string): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message });
    return;
  }
  // Drizzle wraps driver errors in DrizzleQueryError with the pg error as `cause`
  const pgErr = ((err as { cause?: unknown })?.cause ?? err) as { code?: string; detail?: string; message?: string };
  switch (pgErr?.code) {
    case '23505':
      res.status(409).json({ message: 'A record with these details already exists' });
      return;
    case '23503':
      if (pgErr.detail?.includes('still referenced')) {
        res.status(409).json({ message: 'This record is still in use by other records' });
      } else {
        res.status(400).json({ message: 'A referenced record does not exist' });
      }
      return;
    case '23502':
      res.status(400).json({ message: 'A required field is missing' });
      return;
    case '22P02':
    case '22007':
    case '22008':
      res.status(400).json({ message: 'Invalid value in request' });
      return;
  }
  console.error(`[API] ${fallbackMessage}:`, pgErr?.message ?? err);
  res.status(500).json({ message: fallbackMessage });
}
