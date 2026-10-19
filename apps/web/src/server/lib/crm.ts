import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Request, Response, NextFunction } from 'express';
import type { AuthRequest } from './auth';
import { HttpError } from './http';

/** Business day boundaries (reports bucket by local date, not UTC) */
export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

export const BDM_ROLE = 'SALES';
export const CRM_ADMIN_ROLES = ['SUPER_ADMIN', 'MANAGEMENT'];
export const HR_ROLES = ['SUPER_ADMIN', 'MANAGEMENT', 'HR'];
/** Roles that may open the sales CRM at all */
const CRM_ROLES = ['SUPER_ADMIN', 'MANAGEMENT', 'PROJECT_MANAGER', 'SALES'];
/** Coordination (the imported VTI role, or a custom COORDINATION role): hands won clients over to production */
export const COORDINATION_ROLES = ['VTI_COORDINATION', 'COORDINATION'];
export const isCoordination = (role?: string) => !!role && COORDINATION_ROLES.includes(role);
/** The only CRM reads open to coordination: its reports, the lead drawer and the BDM filter */
const COORDINATION_CRM_READS = [/^\/reports\/(closed|bdm-time|lost|weekly-targets)$/, /^\/leads\/[^/]+$/, /^\/bdms$/];

export const OPEN_STAGES = ['AWARENESS', 'CONTACTED', 'PROPOSAL', 'NEGOTIATION'] as const;
export const CLOSED_STAGES = ['WON', 'LOST'] as const;

export const isCrmAdmin = (role?: string) => !!role && CRM_ADMIN_ROLES.includes(role);

function requireRoles(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = (req as AuthRequest).user?.role;
    if (!role || !roles.includes(role)) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }
    next();
  };
}

export const requireCrmAdmin = requireRoles(CRM_ADMIN_ROLES);

/** CRM roles pass; coordination may only make the read-only requests in COORDINATION_CRM_READS */
export function requireCrm(req: Request, res: Response, next: NextFunction): void {
  const role = (req as AuthRequest).user?.role;
  const path = (req.baseUrl + req.path).replace(/^\/api\/crm/, '');
  if (isCoordination(role) && req.method === 'GET' && COORDINATION_CRM_READS.some((re) => re.test(path))) return next();
  requireRoles(CRM_ROLES)(req, res, next);
}

/** CRM admin reports that coordination may also read (lost leads, weekly targets) */
export function requireCrmAdminOrCoordination(req: Request, res: Response, next: NextFunction): void {
  if (isCoordination((req as AuthRequest).user?.role)) return next();
  requireCrmAdmin(req, res, next);
}
export const requireHr = requireRoles(HR_ROLES);

/**
 * BDMs only ever see their own leads; admins may narrow to one BDM with ?bdm=.
 * Returns the user id to filter on, or undefined for "everyone".
 */
export function bdmScope(req: AuthRequest, requestedBdm?: unknown): string | undefined {
  if (req.user!.role === BDM_ROLE) return req.user!.id;
  return typeof requestedBdm === 'string' && requestedBdm ? requestedBdm : undefined;
}

/** Keeps the last 10 digits, so +91 98765 43210 and 09876543210 match */
export function normalizePhone(phone: unknown): string | null {
  if (typeof phone !== 'string' && typeof phone !== 'number') return null;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 6 ? digits.slice(-10) : null;
}

/** `column` converted to the business-local calendar date */
export const localDate = (column: PgColumn | SQL) => sql`(${column} AT TIME ZONE ${APP_TIMEZONE})::date`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date (YYYY-MM-DD) in the business timezone */
export function todayLocal(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE }).format(new Date());
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Validated ?from=&to= (YYYY-MM-DD), defaulting to the last `defaultDays` days */
export function dateRange(query: Request['query'], defaultDays = 7): { from: string; to: string } {
  const to = typeof query.to === 'string' && DATE_RE.test(query.to) ? query.to : todayLocal();
  const from = typeof query.from === 'string' && DATE_RE.test(query.from) ? query.from : addDays(to, -(defaultDays - 1));
  if (from > to) throw new HttpError(400, '"from" must be on or before "to"');
  return { from, to };
}

export function isDateString(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value);
}
