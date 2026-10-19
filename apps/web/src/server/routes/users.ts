import { Router } from 'express';
import { and, asc, eq, isNotNull, ne, or } from 'drizzle-orm';
import { db } from '../db/index';
import { employees, tasks, users, type Role } from '../db/schema';
import { hashPassword } from '../utils/password';
import { authMiddleware, invalidateAuthUser, requirePermission, AuthRequest } from '../lib/auth';
import { HttpError, pickColumns, sendError, uuidParam } from '../lib/http';
import { isSuperRole } from '../lib/erpPermissions';
import { pick } from '../lib/scopes';
import { toApi } from '../lib/serialize';
import { sendEmail, welcomeUserTemplate } from '../services/emailService';
import { siteUrl } from '../lib/publicUrl';
import { loadErpUser, roleBySlug } from '../erp/context';

const router = Router();
router.use(authMiddleware);
router.param('id', uuidParam);

const PUBLIC_COLUMNS = { id: true, name: true, username: true, email: true, role: true, initials: true, clientId: true } as const;
const EDITABLE_FIELDS = ['name', 'username', 'email', 'role', 'initials', 'avatarUrl', 'clientId', 'isActive'] as const;

router.get('/', requirePermission('employees', 'read'), async (req, res) => {
  try {
    const { role } = req.query;
    const [rows, codes] = await Promise.all([
      db.query.users.findMany({
        columns: { ...PUBLIC_COLUMNS, isActive: true, lastLoginAt: true },
        where: typeof role === 'string' && role ? eq(users.role, role as Role) : undefined,
        with: { client: { columns: { id: true, companyName: true } } },
      }),
      db.select({ userId: employees.userId, code: employees.employeeCode }).from(employees).where(isNotNull(employees.userId)),
    ]);
    const codeByUser = new Map(codes.map((c) => [c.userId, c.code]));
    res.json(
      rows.map((u) => ({
        id: u.id,
        name: u.name,
        username: u.username,
        email: u.email,
        role: u.role,
        initials: u.initials,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt,
        employeeCode: codeByUser.get(u.id) ?? null,
        client: toApi(u.client),
      }))
    );
  } catch (err) {
    sendError(res, err, 'Failed to fetch users');
  }
});

/** Minimal staff list (for assignee pickers) — any internal user, no contact details */
router.get('/directory', async (req: AuthRequest, res) => {
  try {
    if (req.user!.role === 'CLIENT') return res.status(403).json({ message: 'Forbidden' });
    const rows = await db
      .select({ id: users.id, name: users.name, initials: users.initials, role: users.role })
      .from(users)
      .where(and(ne(users.role, 'CLIENT'), eq(users.isActive, true)))
      .orderBy(asc(users.name));
    res.json(rows);
  } catch (err) {
    sendError(res, err, 'Failed to fetch team directory');
  }
});

router.get('/:id', requirePermission('employees', 'read'), async (req, res) => {
  try {
    const user = await db.query.users.findFirst({
      columns: PUBLIC_COLUMNS,
      where: eq(users.id, req.params.id as string),
      with: { client: { columns: { id: true, companyName: true } } },
    });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(toApi(user));
  } catch (err) {
    sendError(res, err, 'Failed to fetch user');
  }
});

router.get('/:id/workload', requirePermission('employees', 'read'), async (req: AuthRequest, res) => {
  try {
    const userId = req.params.id as string;
    const viewOwnOnly = ['DEVELOPER', 'DESIGNER', 'TEAM_MEMBER'];
    if (req.user && viewOwnOnly.includes(req.user.role || '') && req.user.id !== userId) {
      return res.status(403).json({ message: 'Can only view own workload' });
    }
    const rows = await db.query.tasks.findMany({
      where: eq(tasks.assignedTo, userId),
      with: { project: pick.projectName },
    });
    const byStatus = rows.reduce(
      (acc, t) => {
        acc[t.status] = (acc[t.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    res.json({ userId, totalTasks: rows.length, byStatus, tasks: toApi(rows) });
  } catch (err) {
    sendError(res, err, 'Failed to fetch workload');
  }
});

router.post('/', requirePermission('employees', 'create'), async (req, res) => {
  try {
    const { name, username, password, role, clientId } = req.body ?? {};
    const email = typeof req.body?.email === 'string' && req.body.email.trim() ? req.body.email.trim() : null;
    if (!name || (!email && !username)) return res.status(400).json({ message: 'Name and an email or username are required' });
    const finalUsername = String(username || email?.split('@')[0] || '').toLowerCase();
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(email ? or(eq(users.username, finalUsername), eq(users.email, email)) : eq(users.username, finalUsername))
      .limit(1);
    if (existing) return res.status(400).json({ message: 'Username or email already exists' });

    const finalRole = (role || 'TEAM_MEMBER') as Role;
    await assertAssignableRole((req as AuthRequest).user!.id, finalRole);

    const initials = String(name).split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
    const plainPassword = password || 'changeme123';
    const [user] = await db
      .insert(users)
      .values({
        name,
        username: finalUsername,
        email,
        passwordHash: await hashPassword(plainPassword),
        role: finalRole,
        ...(finalRole === 'CLIENT' && pickColumns(users, { clientId }, ['clientId'])),
        initials,
      })
      .returning();

    // Send welcome email with credentials (in the background)
    const loginUrl = `${siteUrl()}/login`;
    if (email) {
      void sendEmail(
        email,
        'Welcome to Voice Tunes India — Your Account Details',
        welcomeUserTemplate({ name, username: finalUsername, password: plainPassword, role: finalRole, loginUrl }),
        'welcome-user'
      );
    }

    res.status(201).json({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
      initials: user.initials,
    });
  } catch (err) {
    sendError(res, err, 'Failed to create user');
  }
});

router.patch('/:id', requirePermission('employees', 'update'), async (req, res) => {
  try {
    const id = req.params.id as string;
    const actorId = (req as AuthRequest).user!.id;
    const updates: Partial<typeof users.$inferInsert> = pickColumns(users, req.body, EDITABLE_FIELDS);
    if (req.body?.password) updates.passwordHash = await hashPassword(String(req.body.password));

    const [current] = await db.select({ role: users.role, isActive: users.isActive }).from(users).where(eq(users.id, id)).limit(1);
    if (!current) return res.status(404).json({ message: 'User not found' });
    const roleChanged = updates.role !== undefined && updates.role !== current.role;
    if (roleChanged) await assertAssignableRole(actorId, updates.role!);
    if (id === actorId && (roleChanged || updates.isActive === false)) {
      return res.status(400).json({ message: 'You cannot change your own role or deactivate yourself' });
    }
    // A new password, a new role or a deactivation ends every session of that user
    if (updates.passwordHash || roleChanged || (current.isActive && updates.isActive === false)) updates.tokensValidFrom = new Date();

    const [user] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        name: users.name,
        username: users.username,
        email: users.email,
        role: users.role,
        initials: users.initials,
        clientId: users.clientId,
      });
    if (!user) return res.status(404).json({ message: 'User not found' });
    invalidateAuthUser(id);
    res.json(toApi(user));
  } catch (err) {
    sendError(res, err, 'Failed to update user');
  }
});

/** A role must exist, and only holders of users.manage may grant Super Admin or Management */
async function assertAssignableRole(actorId: string, role: string) {
  if (!(await roleBySlug(role))) throw new HttpError(400, 'Choose a valid role');
  if (isSuperRole(role) && !(await loadErpUser(actorId))?.can('users.manage')) {
    throw new HttpError(403, 'You are not allowed to assign this role');
  }
}

router.delete('/:id', requirePermission('employees', 'delete'), async (req, res) => {
  try {
    const id = req.params.id as string;
    if (id === (req as AuthRequest).user!.id) {
      return res.status(400).json({ message: "You can't delete your own account" });
    }
    const [deleted] = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
    if (!deleted) return res.status(404).json({ message: 'User not found' });
    invalidateAuthUser(id);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to delete user');
  }
});

export default router;
