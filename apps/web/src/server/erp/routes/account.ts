import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { departments, designations, employees, users } from '../../db/schema';
import { erpUser } from '../context';
import { notFound } from '../errors';

const router = Router();

/** The signed-in user, with the permission slugs the frontend uses to show or hide navigation and actions */
router.get('/auth/me', async (req, res) => {
  const user = erpUser(req);
  const [account] = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      email: users.email,
      isActive: users.isActive,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      initials: users.initials,
      employeeId: employees.id,
      employeeCode: employees.employeeCode,
      phone: employees.phone,
      department: departments.name,
      designation: designations.name,
    })
    .from(users)
    .leftJoin(employees, eq(employees.userId, users.id))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .where(eq(users.id, user.id))
    .limit(1);
  if (!account) throw notFound('Account');

  res.json({
    data: {
      id: account.id,
      name: account.name,
      username: account.username,
      email: account.email,
      initials: account.initials,
      is_active: account.isActive,
      last_login_at: account.lastLoginAt?.toISOString() ?? null,
      role: user.role,
      employee: account.employeeId
        ? {
            id: account.employeeId,
            employee_code: account.employeeCode,
            phone: account.phone,
            department: account.department,
            designation: account.designation,
          }
        : null,
      created_at: account.createdAt.toISOString(),
      is_super_admin: user.isSuperAdmin,
      permissions: user.permissions,
    },
  });
});

export default router;
