import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { roles, users } from '../db/schema';
import { authMiddleware, type AuthRequest } from '../lib/auth';
import { ALL_PERMISSIONS, isSuperRole } from '../lib/erpPermissions';
import { forbidden } from './errors';

/** The signed-in user as the /api/v1 routes see it: account, role and the permission slugs it grants */
export interface ErpUser {
  id: string;
  name: string;
  email: string | null;
  role: { id: string | null; name: string; slug: string };
  permissions: string[];
  isSuperAdmin: boolean;
  can(slug: string): boolean;
  canAny(...slugs: string[]): boolean;
}

export type ErpRequest = AuthRequest & { erp: ErpUser };

type RoleRow = { id: string; name: string; slug: string; permissions: string[] };
const ROLE_CACHE_TTL_MS = 30_000;
const roleCache = new Map<string, { role: RoleRow | null; expires: number }>();

/** Call after a role's permissions change */
export function invalidateRoleCache(): void {
  roleCache.clear();
}

export async function roleBySlug(slug: string): Promise<RoleRow | null> {
  const cached = roleCache.get(slug);
  if (cached && cached.expires > Date.now()) return cached.role;
  const [row] = await db
    .select({ id: roles.id, name: roles.name, slug: roles.slug, permissions: roles.permissions })
    .from(roles)
    .where(eq(roles.slug, slug))
    .limit(1);
  roleCache.set(slug, { role: row ?? null, expires: Date.now() + ROLE_CACHE_TTL_MS });
  return row ?? null;
}

export function humanizeRole(slug: string): string {
  return slug
    .toLowerCase()
    .split(/[_-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Permission slugs held by a role (all of them for Super Admin and Management) */
export async function permissionsForRole(slug: string): Promise<{ role: RoleRow | null; permissions: string[]; isSuperAdmin: boolean }> {
  const role = await roleBySlug(slug);
  const isSuperAdmin = isSuperRole(slug);
  return { role, isSuperAdmin, permissions: isSuperAdmin ? [...ALL_PERMISSIONS] : (role?.permissions ?? []) };
}

export async function loadErpUser(userId: string): Promise<ErpUser | null> {
  const [account] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!account) return null;

  const { role, permissions, isSuperAdmin } = await permissionsForRole(account.role);
  const held = new Set(permissions);
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    role: { id: role?.id ?? null, name: role?.name ?? humanizeRole(account.role), slug: account.role },
    permissions,
    isSuperAdmin,
    can: (slug) => isSuperAdmin || held.has(slug),
    canAny: (...slugs) => isSuperAdmin || slugs.some((slug) => held.has(slug)),
  };
}

/** Bearer-token authentication plus the user's permissions on `req.erp` */
export const erpAuth: RequestHandler = (req, res, next) => {
  authMiddleware(req as AuthRequest, res, async (err?: unknown) => {
    if (err) return next(err);
    try {
      const user = await loadErpUser((req as AuthRequest).user!.id);
      if (!user) {
        res.status(401).json({ message: 'Unauthenticated.' });
        return;
      }
      (req as ErpRequest).erp = user;
      next();
    } catch (error) {
      next(error);
    }
  });
};

export const erpUser = (req: Request): ErpUser => (req as ErpRequest).erp;

/** The user must hold every listed permission */
export function requirePermission(...slugs: string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = erpUser(req);
    if (!user || !slugs.every((slug) => user.can(slug))) return next(forbidden());
    next();
  };
}

/** The user must hold at least one of the listed permissions */
export function requireAnyPermission(...slugs: string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = erpUser(req);
    if (!user || !user.canAny(...slugs)) return next(forbidden());
    next();
  };
}
