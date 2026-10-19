import type { ErrorRequestHandler } from 'express';
import { HttpError } from '../lib/http';

/**
 * Errors for the /api/v1 routes. Every failure leaves the API as
 *
 *   { "message": "...", "errors": { "field": ["..."] } }
 *
 * with `errors` only on 422s, keyed by dotted paths such as "items.0.artist_id" so forms can
 * point at the offending input.
 */
export class ValidationError extends HttpError {
  readonly errors: Record<string, string[]>;

  constructor(errors: Record<string, string[]>, message?: string) {
    super(422, message ?? Object.values(errors)[0]?.[0] ?? 'The given data was invalid.');
    this.errors = errors;
  }

  /** From `field => message` pairs */
  static of(messages: Record<string, string>, message?: string): ValidationError {
    return new ValidationError(Object.fromEntries(Object.entries(messages).map(([field, text]) => [field, [text]])), message);
  }
}

export const forbidden = () => new HttpError(403, 'This action is unauthorized.');
export const notFound = (label = 'Record') => new HttpError(404, `${label} not found.`);
export const conflict = (message: string) => new HttpError(409, message);

/** Asserts an authorization decision */
export function authorize(allowed: boolean): void {
  if (!allowed) throw forbidden();
}

type PgError = { code?: string; constraint?: string; table?: string; detail?: string; message?: string };

/** Postgres error behind a Drizzle wrapper, if any */
export function pgError(err: unknown): PgError | null {
  const candidate = ((err as { cause?: unknown })?.cause ?? err) as PgError;
  return candidate && typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code) ? candidate : null;
}

/** True when a delete failed because other rows still reference the record */
export function isInUse(err: unknown): boolean {
  const pg = pgError(err);
  return pg?.code === '23503' && !!pg.detail?.includes('still referenced');
}

/** Field a unique constraint guards, e.g. artists_code_unique → code, quotations_quotationNumber_unique → quotation_number */
function uniqueField(pg: PgError): string {
  const name = pg.constraint ?? '';
  const withoutTable = pg.table && name.startsWith(`${pg.table}_`) ? name.slice(pg.table.length + 1) : name;
  const column = withoutTable.replace(/_(unique|key|pkey)$/, '').replace(/_index$/, '');
  return column.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase() || 'value';
}

export const erpErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ValidationError) {
    res.status(422).json({ message: err.message, errors: err.errors });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message });
    return;
  }
  // Malformed JSON body
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    res.status(400).json({ message: 'The request body is not valid JSON.' });
    return;
  }

  const pg = pgError(err);
  switch (pg?.code) {
    case '23505': {
      const field = uniqueField(pg);
      const label = field.replace(/_id$/, '').replace(/_/g, ' ');
      res.status(422).json({ message: `This ${label} is already taken.`, errors: { [field]: [`This ${label} is already taken.`] } });
      return;
    }
    case '23503':
      if (pg.detail?.includes('still referenced')) {
        res.status(409).json({ message: 'This record is in use and cannot be deleted. Deactivate it instead.' });
      } else {
        res.status(422).json({ message: 'A selected record does not exist.' });
      }
      return;
    case '22P02':
      res.status(404).json({ message: 'Record not found.' });
      return;
  }

  console.error(`[API] ${req.method} ${req.originalUrl}:`, (err as Error)?.stack ?? err);
  res.status(500).json({ message: 'Something went wrong. Please try again.' });
};
