import { Router } from 'express';
import { and, eq, gt, or, sql } from 'drizzle-orm';
import { db } from '../../db/index';
import { employees, users } from '../../db/schema';
import { hashPassword, comparePassword, generateResetToken } from '../../utils/password';
import { sendEmail, passwordResetTemplate } from '../../services/emailService';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  authMiddleware,
  invalidateAuthUser,
  isIssuedBeforeCutoff,
  AuthRequest,
} from '../../lib/auth';
import { isUuid, sendError } from '../../lib/http';
import { authRateLimiter } from '../../lib/rateLimit';
import { background } from '../../lib/background';
import { siteUrl } from '../../lib/publicUrl';
import { validate, loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema } from '../../lib/validation';
import { logActivity } from '../../erp/activity';
import { ValidationError, erpErrorHandler } from '../../erp/errors';

const router = Router();
const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

type UserRow = typeof users.$inferSelect;

function toUserResponse(user: Pick<UserRow, 'id' | 'name' | 'username' | 'email' | 'role' | 'initials' | 'clientId'>) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    initials: user.initials ?? undefined,
    clientId: user.clientId ?? undefined,
  };
}

const isMobileClient = (req: import('express').Request) => req.header('x-client') === 'mobile';

function tokenPayload(user: Pick<UserRow, 'id' | 'role' | 'clientId'>) {
  return { userId: user.id, role: user.role, clientId: user.clientId ?? undefined };
}

/** A username, an email address or an employee ID (e.g. VTI-0003 or KR_01) */
async function findLoginUser(identifier: string): Promise<{ user: UserRow; employeeStatus: string | null } | null> {
  const value = identifier.trim().toLowerCase();
  const [row] = await db
    .select({ user: users, employeeStatus: employees.status })
    .from(users)
    .leftJoin(employees, eq(employees.userId, users.id))
    .where(or(eq(users.username, value), sql`lower(${users.email}) = ${value}`))
    .limit(1);
  if (row) return row;
  const [byCode] = await db
    .select({ user: users, employeeStatus: employees.status })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(sql`lower(${employees.employeeCode}) = ${value}`)
    .limit(1);
  return byCode ?? null;
}

router.post('/register', authRateLimiter, validate(registerSchema), async (req, res) => {
  try {
    const { email, username, password, name, role } = req.body;
    const allowedRole = role === 'CLIENT' || role === 'TEAM_MEMBER' ? role : 'TEAM_MEMBER';
    const normalizedUsername = username.toLowerCase();
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.email, email), eq(users.username, normalizedUsername)))
      .limit(1);
    if (existing) {
      return res.status(400).json({ message: 'Email or username already exists' });
    }

    const [user] = await db
      .insert(users)
      .values({
        email,
        username: normalizedUsername,
        passwordHash: await hashPassword(password),
        name,
        role: allowedRole,
        initials: name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase(),
      })
      .returning();

    const payload = tokenPayload(user);
    res.cookie('refreshToken', signRefreshToken(payload), REFRESH_COOKIE_OPTS);
    res.status(201).json({
      user: toUserResponse(user),
      token: signAccessToken(payload),
      message: 'Registered successfully',
    });
  } catch (err) {
    sendError(res, err, 'Registration failed');
  }
});

router.post('/login', authRateLimiter, validate(loginSchema), async (req, res) => {
  try {
    const { username, password } = req.body;
    const found = await findLoginUser(username);
    const user = found?.user;
    if (!user || !(await comparePassword(password, user.passwordHash))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.isActive || found.employeeStatus === 'terminated') {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    // Bookkeeping only — don't make the login response wait for it
    void background(db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id)).then(() => undefined), 'Auth: record last login');
    void background(logActivity(req, 'login', `${user.name} signed in`, { id: user.id, type: 'User' }, {}, user.id), 'Auth: log sign-in');

    const payload = tokenPayload(user);
    const refresh = signRefreshToken(payload);
    res.cookie('refreshToken', refresh, REFRESH_COOKIE_OPTS);
    res.json({
      user: toUserResponse(user),
      token: signAccessToken(payload),
      // Native apps (the call-sync app) have no cookie jar, so they receive the refresh token directly
      ...(isMobileClient(req) && { refreshToken: refresh }),
    });
  } catch (err) {
    sendError(res, err, 'Login failed');
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const mobile = isMobileClient(req);
    const refreshToken = req.cookies?.refreshToken ?? (mobile && typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined);
    if (!refreshToken) {
      return res.status(401).json({ message: 'No refresh token' });
    }

    const payload = verifyRefreshToken(refreshToken);
    if (!payload || !isUuid(payload.userId)) {
      res.clearCookie('refreshToken', { path: '/' });
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    const [user] = await db
      .select({ id: users.id, role: users.role, clientId: users.clientId, isActive: users.isActive, tokensValidFrom: users.tokensValidFrom })
      .from(users)
      .where(eq(users.id, payload.userId))
      .limit(1);
    if (!user || !user.isActive) {
      res.clearCookie('refreshToken', { path: '/' });
      return res.status(401).json({ message: 'User not found' });
    }
    // A password change, role change or deactivation ended this session
    if (isIssuedBeforeCutoff(payload, user.tokensValidFrom)) {
      res.clearCookie('refreshToken', { path: '/' });
      return res.status(401).json({ message: 'Your session has ended. Please sign in again.' });
    }

    const newPayload = tokenPayload(user);
    const newRefresh = signRefreshToken(newPayload);
    res.cookie('refreshToken', newRefresh, REFRESH_COOKIE_OPTS);
    res.json({ token: signAccessToken(newPayload), ...(mobile && { refreshToken: newRefresh }) });
  } catch (err) {
    sendError(res, err, 'Refresh failed');
  }
});

router.post('/logout', (_, res) => {
  res.clearCookie('refreshToken', { path: '/' });
  res.json({ message: 'Logged out' });
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        email: users.email,
        role: users.role,
        initials: users.initials,
        clientId: users.clientId,
      })
      .from(users)
      .where(eq(users.id, authReq.user!.id))
      .limit(1);
    if (!user) return res.status(401).json({ message: 'User not found' });
    res.json(toUserResponse(user));
  } catch (err) {
    sendError(res, err, 'Failed to fetch user');
  }
});

/**
 * Changing the password ends every other session. The device making the request gets replacement
 * tokens so it stays signed in.
 */
router.post('/change-password', authMiddleware, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { current_password: current, password } = validateChangePassword(req.body);
    const [user] = await db.select().from(users).where(eq(users.id, authReq.user!.id)).limit(1);
    if (!user || !(await comparePassword(current, user.passwordHash))) {
      throw ValidationError.of({ current_password: 'Your current password is incorrect.' });
    }

    // Everything issued before now stops working, including this request's own tokens
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password), tokensValidFrom: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));
    invalidateAuthUser(user.id);
    await logActivity(req, 'password_changed', `${user.name} changed their password`, { id: user.id, type: 'User' });

    // Signed a millisecond later, so the replacements postdate the cutoff
    await new Promise((resolve) => setTimeout(resolve, 2));
    const payload = tokenPayload(user);
    res.cookie('refreshToken', signRefreshToken(payload), REFRESH_COOKIE_OPTS);
    res.json({ message: 'Password changed. Other devices have been signed out.', token: signAccessToken(payload) });
  } catch (err) {
    if (err instanceof ValidationError) return erpErrorHandler(err, req, res, next);
    sendError(res, err, 'Password change failed');
  }
});

function validateChangePassword(body: unknown): { current_password: string; password: string } {
  const result = changePasswordSchema.safeParse(body);
  if (!result.success) {
    const errors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const field = String(issue.path[0] ?? 'password');
      errors[field] ??= [issue.message];
    }
    throw new ValidationError(errors);
  }
  return result.data;
}

router.post('/forgot-password', authRateLimiter, validate(forgotPasswordSchema), async (req, res) => {
  try {
    const { email } = req.body;
    // An email address, username or employee ID; only accounts with an email address can be sent a link
    const found = await findLoginUser(email);
    const user = found?.user.isActive && found.user.email ? { id: found.user.id, email: found.user.email } : null;
    if (!user) {
      return res.json({ message: 'If an account exists, a reset link will be sent' });
    }

    const resetToken = generateResetToken();
    await db
      .update(users)
      .set({ resetToken, resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000) })
      .where(eq(users.id, user.id));

    const resetUrl = `${siteUrl()}/reset-password?token=${resetToken}`;
    void sendEmail(user.email, 'Reset Your Password', passwordResetTemplate({ resetUrl, expiresIn: '1 hour' }), 'password-reset');

    res.json({ message: 'If an account exists, a reset link will be sent' });
  } catch (err) {
    sendError(res, err, 'Password reset request failed');
  }
});

router.post('/reset-password', authRateLimiter, validate(resetPasswordSchema), async (req, res) => {
  try {
    const { token, password } = req.body;
    const [updated] = await db
      .update(users)
      // Every existing session ends
      .set({ passwordHash: await hashPassword(password), resetToken: null, resetTokenExpiry: null, tokensValidFrom: new Date() })
      .where(and(eq(users.resetToken, token), gt(users.resetTokenExpiry, new Date())))
      .returning({ id: users.id });

    if (!updated) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }
    invalidateAuthUser(updated.id);

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    sendError(res, err, 'Password reset failed');
  }
});

export default router;
