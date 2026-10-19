import { Router } from 'express';
import { and, asc, eq, like, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { EMPLOYEE_STATUSES, departments, designations, divisions, employees, salaries, users, type EmployeeStatus, type Role } from '../db/schema';
import { authMiddleware, invalidateAuthUser, type AuthRequest } from '../lib/auth';
import { HR_ROLES, requireHr } from '../lib/crm';
import { isSuperRole } from '../lib/erpPermissions';
import { HttpError, pickColumns, sendError, uuidParam } from '../lib/http';
import { hashPassword } from '../utils/password';
import { roleOrPermission } from '../erp/access';
import { logActivity } from '../erp/activity';
import { loadErpUser, roleBySlug } from '../erp/context';

const router = Router();
router.use(authMiddleware);
router.param('id', uuidParam);

const canViewEmployees = roleOrPermission(HR_ROLES, 'employees.view');
const canManageEmployees = roleOrPermission(HR_ROLES, 'employees.manage');

const EMPLOYEE_FIELDS = [
  'userId', 'employeeCode', 'name', 'email', 'phone', 'divisionId', 'departmentId', 'designationId',
  'joiningDate', 'monthlySalary', 'bankAccount', 'ifsc', 'pan', 'address', 'status',
] as const;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const STRONG_PASSWORD = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const round2 = (n: number) => Math.round(n * 100) / 100;

function daysInMonth(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function netPay(s: { baseSalary: number; workingDays: number; paidDays: number; bonus: number; deductions: number }) {
  const prorated = s.workingDays > 0 ? (s.baseSalary * s.paidDays) / s.workingDays : 0;
  return round2(Math.max(0, prorated + s.bonus - s.deductions));
}

type EmployeeRow = typeof employees.$inferSelect;

/**
 * The employee's login account, managed from the employee form:
 * `loginEnabled` true creates or updates the account (role, password, username), false disables it,
 * and leaving it out leaves any linked account untouched.
 */
interface LoginInput {
  loginEnabled?: boolean;
  loginRole?: string;
  loginPassword?: string;
  loginUsername?: string;
}

function readLogin(body: Record<string, unknown>): LoginInput {
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  return {
    loginEnabled: typeof body.loginEnabled === 'boolean' ? body.loginEnabled : undefined,
    loginRole: text(body.loginRole),
    loginPassword: typeof body.loginPassword === 'string' && body.loginPassword ? body.loginPassword : undefined,
    loginUsername: text(body.loginUsername)?.toLowerCase(),
  };
}

/** Next sequential employee ID, e.g. VTI-0004 */
async function nextEmployeeCode(): Promise<string> {
  const rows = await db.select({ code: employees.employeeCode }).from(employees).where(like(employees.employeeCode, 'VTI-%'));
  const highest = rows.reduce((max, row) => {
    const n = Number.parseInt(row.code?.slice(4) ?? '', 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `VTI-${String(highest + 1).padStart(4, '0')}`;
}

async function assertAssignableRole(actorId: string, role: string) {
  if (!(await roleBySlug(role))) throw new HttpError(400, 'Choose a valid role for the login account');
  const actor = await loadErpUser(actorId);
  if (isSuperRole(role) && !actor?.can('users.manage')) throw new HttpError(403, 'You are not allowed to assign this role');
}

/** Creates, updates or disables the employee's login account; returns the linked user id */
async function syncLogin(employee: EmployeeRow, login: LoginInput, actorId: string): Promise<string | null> {
  if (login.loginEnabled === undefined) return employee.userId;

  const [account] = employee.userId ? await db.select().from(users).where(eq(users.id, employee.userId)).limit(1) : [];

  if (!login.loginEnabled) {
    if (account?.isActive) {
      // Login removed: keep the account for history but disable it and end its sessions
      await db.update(users).set({ isActive: false, tokensValidFrom: new Date(), updatedAt: new Date() }).where(eq(users.id, account.id));
      invalidateAuthUser(account.id);
    }
    return employee.userId;
  }

  if (login.loginPassword && !STRONG_PASSWORD.test(login.loginPassword)) {
    throw new HttpError(400, 'The password must be at least 8 characters and contain both letters and numbers.');
  }
  // Re-saving an employee keeps their role; only a change of role is checked
  if (login.loginRole && login.loginRole !== account?.role) await assertAssignableRole(actorId, login.loginRole);
  const isActive = employee.status === 'active';

  if (account) {
    const updates: Partial<typeof users.$inferInsert> = { name: employee.name, isActive, updatedAt: new Date() };
    if (employee.email) updates.email = employee.email;
    if (login.loginRole) updates.role = login.loginRole as Role;
    if (login.loginUsername) updates.username = login.loginUsername;
    if (login.loginPassword) updates.passwordHash = await hashPassword(login.loginPassword);
    // A new password, a new role or a deactivation ends every session
    if (login.loginPassword || (login.loginRole && login.loginRole !== account.role) || (account.isActive && !isActive)) {
      updates.tokensValidFrom = new Date();
    }
    await db.update(users).set(updates).where(eq(users.id, account.id));
    invalidateAuthUser(account.id);
    return account.id;
  }

  if (!login.loginRole) throw new HttpError(400, 'Choose the role this employee signs in with');
  if (!login.loginPassword) throw new HttpError(400, 'Set a password for this employee');
  const username = login.loginUsername ?? (employee.employeeCode ?? employee.email?.split('@')[0] ?? '').toLowerCase();
  if (!username) throw new HttpError(400, 'Give the employee an employee code, email or username so they can sign in');

  const [clash] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
  if (clash) throw new HttpError(409, `The username "${username}" is already taken`);

  const [created] = await db
    .insert(users)
    .values({
      name: employee.name,
      username,
      email: employee.email || null,
      passwordHash: await hashPassword(login.loginPassword),
      role: login.loginRole as Role,
      isActive,
      initials: employee.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase(),
    })
    .returning({ id: users.id });
  await db.update(employees).set({ userId: created.id }).where(eq(employees.id, employee.id));
  return created.id;
}

// ─── Employees ──────────────────────────────────────────────────────────────────────────────────────────────────

router.get('/employees', canViewEmployees, async (req, res) => {
  try {
    const status = req.query.status;
    const rows = await db
      .select({
        employee: employees,
        divisionName: divisions.name,
        departmentName: departments.name,
        designationName: designations.name,
        username: users.username,
        role: users.role,
        loginActive: users.isActive,
        lastLoginAt: users.lastLoginAt,
      })
      .from(employees)
      .leftJoin(divisions, eq(divisions.id, employees.divisionId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .leftJoin(users, eq(users.id, employees.userId))
      .where(
        status === 'all'
          ? undefined
          : eq(employees.status, EMPLOYEE_STATUSES.includes(status as EmployeeStatus) ? (status as EmployeeStatus) : 'active')
      )
      .orderBy(asc(employees.name));
    res.json(
      rows.map((r) => ({
        ...r.employee,
        // Kept for screens that read the designation as text
        designation: r.designationName,
        divisionName: r.divisionName,
        departmentName: r.departmentName,
        designationName: r.designationName,
        username: r.username,
        role: r.role,
        loginActive: r.loginActive,
        lastLoginAt: r.lastLoginAt,
      }))
    );
  } catch (err) {
    sendError(res, err, 'Failed to fetch employees');
  }
});

router.post('/employees', canManageEmployees, async (req: AuthRequest, res) => {
  try {
    const values = pickColumns(employees, req.body, EMPLOYEE_FIELDS);
    if (!values.name?.trim()) throw new HttpError(400, 'Employee name is required');
    const login = readLogin(req.body ?? {});
    // A blank employee code is generated (VTI-0004, …), so every employee can sign in by ID
    const [employee] = await db
      .insert(employees)
      .values({ ...values, name: values.name.trim(), employeeCode: values.employeeCode?.trim() || (await nextEmployeeCode()) })
      .returning();
    try {
      await syncLogin(employee, login, req.user!.id);
    } catch (err) {
      // The login could not be created: don't leave a half-created employee behind
      await db.delete(employees).where(eq(employees.id, employee.id));
      throw err;
    }
    await logActivity(req, 'created', `Employee ${employee.employeeCode} (${employee.name}) created`, { id: employee.id, type: 'Employee' });
    const [row] = await db.select().from(employees).where(eq(employees.id, employee.id));
    res.status(201).json(row);
  } catch (err) {
    sendError(res, err, 'Failed to add employee');
  }
});

router.patch('/employees/:id', canManageEmployees, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const [current] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
    if (!current) return res.status(404).json({ message: 'Employee not found' });

    const values = pickColumns(employees, req.body, EMPLOYEE_FIELDS);
    const login = readLogin(req.body ?? {});
    // Nobody may strip their own role, status or login access
    if (current.userId === req.user!.id) {
      const [me] = await db.select({ role: users.role }).from(users).where(eq(users.id, req.user!.id));
      if (
        login.loginEnabled === false ||
        (login.loginRole && login.loginRole !== me?.role) ||
        (values.status && values.status !== 'active') ||
        (values.userId !== undefined && values.userId !== current.userId)
      ) {
        throw new HttpError(400, 'You cannot change your own role, status or login access');
      }
    }

    const [row] = await db.update(employees).set({ ...values, updatedAt: new Date() }).where(eq(employees.id, id)).returning();
    const userId = await syncLogin(row, login, req.user!.id);
    // Status changes carry over to the login (only active employees can sign in)
    if (login.loginEnabled === undefined && userId && values.status && values.status !== current.status) {
      const active = values.status === 'active';
      await db
        .update(users)
        .set({ isActive: active, ...(active ? {} : { tokensValidFrom: new Date() }), updatedAt: new Date() })
        .where(eq(users.id, userId));
      invalidateAuthUser(userId);
    }
    await logActivity(req, 'updated', `Employee ${row.employeeCode ?? row.name} updated`, { id: row.id, type: 'Employee' });
    const [fresh] = await db.select().from(employees).where(eq(employees.id, id));
    res.json(fresh);
  } catch (err) {
    sendError(res, err, 'Failed to update employee');
  }
});

router.delete('/employees/:id', canManageEmployees, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const [current] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
    if (!current) return res.status(404).json({ message: 'Employee not found' });
    if (current.userId === req.user!.id) throw new HttpError(400, 'You cannot delete your own employee record');

    await db.delete(employees).where(eq(employees.id, id));
    if (current.userId) {
      // The login stays for history, but can no longer be used
      await db.update(users).set({ isActive: false, tokensValidFrom: new Date(), updatedAt: new Date() }).where(eq(users.id, current.userId));
      invalidateAuthUser(current.userId);
    }
    await logActivity(req, 'deleted', `Employee ${current.employeeCode ?? current.name} deleted`, { id, type: 'Employee' });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to delete employee');
  }
});

// ─── Monthly salary ─────────────────────────────────────────────────────────────────────────────────────────────

router.get('/salaries', requireHr, async (req, res) => {
  try {
    const month = typeof req.query.month === 'string' && MONTH_RE.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
    const rows = await db
      .select({
        salary: salaries,
        employeeName: employees.name,
        employeeCode: employees.employeeCode,
        designation: designations.name,
        departmentName: departments.name,
      })
      .from(salaries)
      .innerJoin(employees, eq(employees.id, salaries.employeeId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .where(eq(salaries.month, month))
      .orderBy(asc(employees.name));
    const list = rows.map((r) => ({ ...r.salary, employeeName: r.employeeName, employeeCode: r.employeeCode, designation: r.designation, departmentName: r.departmentName }));
    res.json({
      month,
      rows: list,
      totals: {
        net: round2(list.reduce((s, r) => s + r.netPay, 0)),
        paid: round2(list.filter((r) => r.status === 'paid').reduce((s, r) => s + r.netPay, 0)),
        count: list.length,
      },
    });
  } catch (err) {
    sendError(res, err, 'Failed to fetch salaries');
  }
});

/** Creates draft salary rows for every active employee who doesn't have one for the month yet */
router.post('/salaries/generate', requireHr, async (req, res) => {
  try {
    const month = String(req.body?.month ?? '');
    if (!MONTH_RE.test(month)) throw new HttpError(400, 'Month must look like 2026-09');
    const workingDays = daysInMonth(month);
    const active = await db
      .select({ id: employees.id, monthlySalary: employees.monthlySalary })
      .from(employees)
      .where(and(eq(employees.status, 'active'), sql`NOT EXISTS (SELECT 1 FROM salaries s WHERE s.employee_id = "employees"."id" AND s.month = ${month})`));
    if (active.length) {
      await db
        .insert(salaries)
        .values(active.map((e) => ({ employeeId: e.id, month, baseSalary: e.monthlySalary, workingDays, paidDays: workingDays, netPay: round2(e.monthlySalary) })))
        .onConflictDoNothing();
    }
    res.json({ created: active.length });
  } catch (err) {
    sendError(res, err, 'Failed to generate salaries');
  }
});

router.patch('/salaries/:id', requireHr, async (req: AuthRequest, res) => {
  try {
    const [current] = await db.select().from(salaries).where(eq(salaries.id, req.params.id as string)).limit(1);
    if (!current) return res.status(404).json({ message: 'Salary row not found' });
    const updates = pickColumns(salaries, req.body, ['baseSalary', 'workingDays', 'paidDays', 'bonus', 'deductions', 'note', 'status']);
    const merged = { ...current, ...updates };
    if (merged.paidDays > merged.workingDays) throw new HttpError(400, 'Paid days cannot exceed working days');
    const [row] = await db
      .update(salaries)
      .set({
        ...updates,
        netPay: netPay(merged),
        paidAt: updates.status === 'paid' && current.status !== 'paid' ? new Date() : updates.status === 'draft' ? null : current.paidAt,
        updatedAt: new Date(),
      })
      .where(eq(salaries.id, current.id))
      .returning();
    res.json(row);
  } catch (err) {
    sendError(res, err, 'Failed to update salary');
  }
});

router.delete('/salaries/:id', requireHr, async (req, res) => {
  try {
    const [row] = await db.delete(salaries).where(eq(salaries.id, req.params.id as string)).returning({ id: salaries.id });
    if (!row) return res.status(404).json({ message: 'Salary row not found' });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to delete salary row');
  }
});

export default router;
