import type { Request } from 'express';
import { db } from '../db/index';
import { activityLogs } from '../db/schema';

/** Attribute names never written to the log */
const REDACTED = ['password', 'password_hash', 'passwordHash', 'remember_token', 'token'];

function limit(value: string, length: number, suffix = '...'): string {
  return value.length > length ? value.slice(0, length) + suffix : value;
}

function redact(properties: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (REDACTED.includes(key)) continue;
    result[key] =
      value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) ? redact(value as Record<string, unknown>) : value;
  }
  return result;
}

function clientIp(req?: Request): string | null {
  if (!req) return null;
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim();
  return first || req.ip || null;
}

/**
 * Writes one audit entry. The actor defaults to the request's signed-in user; the caller's IP and user
 * agent are recorded with it.
 */
export async function logActivity(
  req: Request | undefined,
  event: string,
  description: string,
  subject?: { id: string; type: string } | null,
  properties: Record<string, unknown> = {},
  userId?: string | null
): Promise<void> {
  const actor = userId !== undefined ? userId : ((req as { user?: { id: string } } | undefined)?.user?.id ?? null);
  await db.insert(activityLogs).values({
    userId: actor,
    event: limit(event, 50, ''),
    subjectType: subject?.type ?? null,
    subjectId: subject?.id ?? null,
    description: limit(description, 250),
    properties: Object.keys(properties).length ? redact(properties) : null,
    ipAddress: limit(clientIp(req) ?? '', 45, '') || null,
    userAgent: limit(String(req?.headers['user-agent'] ?? ''), 250, '') || null,
  });
}

/** Old and new values of the fields that changed, for a log entry's properties */
export function changes(before: Record<string, unknown>, after: Record<string, unknown>): { old: Record<string, unknown>; new: Record<string, unknown> } {
  const old: Record<string, unknown> = {};
  const now: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (key === 'updatedAt' || key === 'updated_at' || REDACTED.includes(key)) continue;
    const a = normalise(before[key]);
    const b = normalise(after[key]);
    if (JSON.stringify(a ?? '') !== JSON.stringify(b ?? '')) {
      old[key] = a;
      now[key] = b;
    }
  }
  return { old, new: now };
}

function normalise(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}
