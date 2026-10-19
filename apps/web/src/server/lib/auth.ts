import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { users } from '../db/schema';
import { isUuid } from './http';
import { hasPermission, Resource, Action, ReportPermission } from './permissions';

export type Role =
  | 'SUPER_ADMIN'
  | 'MANAGEMENT'
  | 'PROJECT_MANAGER'
  | 'DEVELOPER'
  | 'DESIGNER'
  | 'MARKETING'
  | 'ADS_TEAM'
  | 'SALES'
  | 'SUPPORT'
  | 'HR'
  | 'TEAM_MEMBER' // Legacy - treat as DEVELOPER for permissions
  | 'CLIENT';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;
const ACCESS_EXP = '15m';
const REFRESH_EXP = '7d';

export interface JwtPayload {
  userId: string;
  role: Role;
  clientId?: string;
}

/** A verified token: the payload plus its issue time */
export type VerifiedToken = JwtPayload & { iat: number; iatMs?: number };

// `iat` counts whole seconds, too coarse to tell a replacement token minted in the same second as a
// session cutoff from the tokens that cutoff ends, so tokens also carry a millisecond issue time.
const withIssueTime = (payload: JwtPayload) => ({ userId: payload.userId, role: payload.role, clientId: payload.clientId, iatMs: Date.now() });

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(withIssueTime(payload), ACCESS_SECRET, { expiresIn: ACCESS_EXP });
}

export function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(withIssueTime(payload), REFRESH_SECRET, { expiresIn: REFRESH_EXP });
}

export function verifyAccessToken(token: string): VerifiedToken | null {
  try {
    return jwt.verify(token, ACCESS_SECRET) as VerifiedToken;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): VerifiedToken | null {
  try {
    return jwt.verify(token, REFRESH_SECRET) as VerifiedToken;
  } catch {
    return null;
  }
}

/** Whether a token predates the user's session cutoff (set on password or role change and deactivation) */
export function isIssuedBeforeCutoff(token: Pick<VerifiedToken, 'iat' | 'iatMs'>, cutoff: Date | null | undefined): boolean {
  if (!cutoff) return false;
  return (token.iatMs ?? token.iat * 1000) < cutoff.getTime();
}

export interface AuthRequest extends Request {
  user?: { id: string; role: Role; clientId?: string };
}

// Every authenticated request needs the user's current role/active flag. Caching it briefly saves a
// database round-trip per request; writes to a user call invalidateAuthUser() so changes apply at once
// on this instance (other instances pick them up within the TTL).
type AuthUser = NonNullable<AuthRequest['user']> & { isActive: boolean; tokensValidFrom: Date | null };
const AUTH_CACHE_TTL_MS = 30_000;
const authCache = new Map<string, { user: AuthUser | null; expires: number }>();

export function invalidateAuthUser(userId?: string): void {
  if (userId) authCache.delete(userId);
  else authCache.clear();
}

async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const cached = authCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.user;

  const [row] = await db
    .select({ id: users.id, role: users.role, clientId: users.clientId, isActive: users.isActive, tokensValidFrom: users.tokensValidFrom })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = row
    ? { id: row.id, role: row.role, clientId: row.clientId ?? undefined, isActive: row.isActive, tokensValidFrom: row.tokensValidFrom }
    : null;

  if (authCache.size > 5_000) authCache.clear();
  authCache.set(userId, { user, expires: Date.now() + AUTH_CACHE_TTL_MS });
  return user;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ message: 'Not authenticated' });
    return;
  }

  const payload = verifyAccessToken(token);
  // Tokens issued before the Postgres migration carry Mongo ObjectIds — force a fresh login
  if (!payload || !isUuid(payload.userId)) {
    res.status(401).json({ message: 'Invalid or expired token' });
    return;
  }

  let user: AuthUser | null;
  try {
    user = await loadAuthUser(payload.userId);
  } catch (err) {
    console.error('[Auth] User lookup failed:', (err as Error).message);
    res.status(503).json({ message: 'Service temporarily unavailable' });
    return;
  }
  if (!user || !user.isActive) {
    res.status(401).json({ message: 'User not found or inactive' });
    return;
  }
  if (isIssuedBeforeCutoff(payload, user.tokensValidFrom)) {
    res.status(401).json({ message: 'Your session has ended. Please sign in again.' });
    return;
  }

  req.user = { id: user.id, role: user.role, clientId: user.clientId };
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }
    next();
  };
}

export function requireClientProfile(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ message: 'Not authenticated' });
    return;
  }
  if (req.user.role === 'CLIENT' && !req.user.clientId) {
    res.status(403).json({ message: 'Client profile required' });
    return;
  }
  next();
}

export function requirePermission(resource: Resource, action: Action, reportScope?: ReportPermission) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }
    if (!hasPermission(req.user.role, resource, action, reportScope)) {
      res.status(403).json({ message: 'Forbidden: insufficient permissions' });
      return;
    }
    next();
  };
}
