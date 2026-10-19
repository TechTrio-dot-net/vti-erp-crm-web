import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '../src/server/db/schema';
import { ROLE, actingAsRole, api, as, db, resetDb, seedTestCatalog } from './harness';

describe('Employees and their logins', () => {
  beforeEach(async () => {
    await resetDb();
    await seedTestCatalog();
  });

  it('generates an employee ID that can then be used to sign in', async () => {
    const hr = await actingAsRole(ROLE.HR);
    const designation = await as(hr).post('/api/masters/designations').send({ name: 'Video Editor' }).expect(201);

    const { body } = await as(hr)
      .post('/api/hr/employees')
      .send({ name: 'Ravi Kumar', email: 'ravi@example.com', phone: '+91 90000 00000', designationId: designation.body.id, status: 'active', loginEnabled: true, loginRole: 'TEAM_MEMBER', loginPassword: 'Secret123' })
      .expect(201);

    expect(body.employeeCode).toMatch(/^VTI-\d{4}$/);
    expect(body.userId).toEqual(expect.any(String));

    const list = await as(hr).get('/api/hr/employees').expect(200);
    expect(list.body[0]).toMatchObject({ name: 'Ravi Kumar', designationName: 'Video Editor', role: 'TEAM_MEMBER', loginActive: true });

    // The generated ID is a working credential, and the employee's phone is used on their quotations
    const session = await api().post('/api/auth/login').send({ username: body.employeeCode, password: 'Secret123' }).expect(200);
    const me = await as({ token: session.body.token, userId: body.userId }).get('/api/v1/auth/me').expect(200);
    expect(me.body.data.employee).toMatchObject({ employee_code: body.employeeCode, designation: 'Video Editor' });
  });

  it('refuses a weak password for a new login', async () => {
    const hr = await actingAsRole(ROLE.HR);
    const { body } = await as(hr).post('/api/hr/employees').send({ name: 'Weak', loginEnabled: true, loginRole: 'TEAM_MEMBER', loginPassword: 'short' }).expect(400);
    expect(body.message).toContain('8 characters');

    const list = await as(hr).get('/api/hr/employees?status=all').expect(200);
    expect(list.body).toHaveLength(0);
  });

  it('stops HR creating super admin accounts', async () => {
    const hr = await actingAsRole(ROLE.HR);
    await as(hr).post('/api/hr/employees').send({ name: 'Sneaky', loginEnabled: true, loginRole: 'SUPER_ADMIN', loginPassword: 'Secret123' }).expect(403);

    const roles = await as(hr).get('/api/v1/lookups/roles').expect(200);
    expect(roles.body.data.map((r: { slug: string }) => r.slug)).not.toContain('SUPER_ADMIN');
    await as(hr).patch(`/api/users/${hr.userId}`).send({ role: 'SUPER_ADMIN' }).expect(403);
  });

  it('disables the login and ends its sessions when an employee is terminated', async () => {
    const hr = await actingAsRole(ROLE.HR);
    const created = await as(hr)
      .post('/api/hr/employees')
      .send({ name: 'Old Timer', employeeCode: 'OT_01', status: 'active', loginEnabled: true, loginRole: 'TEAM_MEMBER', loginPassword: 'Secret123' })
      .expect(201);
    const session = await api().post('/api/auth/login').send({ username: 'ot_01', password: 'Secret123' }).expect(200);

    await as(hr).patch(`/api/hr/employees/${created.body.id}`).send({ status: 'terminated' }).expect(200);

    const [user] = await db.select().from(users).where(eq(users.id, created.body.userId));
    expect(user.isActive).toBe(false);
    await as({ token: session.body.token, userId: user.id }).get('/api/v1/auth/me').expect(401);
    await api().post('/api/auth/login').send({ username: 'OT_01', password: 'Secret123' }).expect(401);
  });

  it('stops anyone changing their own role or deactivating themselves', async () => {
    const superAdmin = await actingAsRole(ROLE.SUPER_ADMIN);
    await as(superAdmin).patch(`/api/users/${superAdmin.userId}`).send({ role: 'HR' }).expect(400);
    await as(superAdmin).patch(`/api/users/${superAdmin.userId}`).send({ isActive: false }).expect(400);

    const hrUser = await actingAsRole(ROLE.HR);
    const created = await as(superAdmin).post('/api/hr/employees').send({ name: 'Me', userId: hrUser.userId }).expect(201);
    await as(hrUser).patch(`/api/hr/employees/${created.body.id}`).send({ status: 'inactive' }).expect(400);
    await as(hrUser).delete(`/api/hr/employees/${created.body.id}`).expect(400);
  });

  it('accepts custom roles in the user master and ends sessions on a role change', async () => {
    const superAdmin = await actingAsRole(ROLE.SUPER_ADMIN);
    const role = await as(superAdmin).post('/api/v1/admin/roles').send({ name: 'Coordination', permissions: ['dashboard.view', 'quotations.view_all', 'artists.assign'] }).expect(201);

    const created = await as(superAdmin).post('/api/users').send({ name: 'Co Ordinator', username: 'coord', password: 'Secret123', role: role.body.data.slug }).expect(201);
    expect(created.body.role).toBe('COORDINATION');
    await as(superAdmin).post('/api/users').send({ name: 'Ghost', username: 'ghost', role: 'NOT_A_ROLE' }).expect(400);

    const session = await api().post('/api/auth/login').send({ username: 'coord', password: 'Secret123' }).expect(200);
    const actor = { token: session.body.token, userId: created.body.id };
    await as(actor).get('/api/v1/quotations/artist-assignments').expect(200);

    await as(superAdmin).patch(`/api/users/${created.body.id}`).send({ role: 'TEAM_MEMBER' }).expect(200);
    await as(actor).get('/api/v1/auth/me').expect(401);
  });

  it('lists accounts with their status, last sign-in and employee ID, and deactivates them', async () => {
    const superAdmin = await actingAsRole(ROLE.SUPER_ADMIN);
    const hr = await actingAsRole(ROLE.HR);
    const created = await as(hr)
      .post('/api/hr/employees')
      .send({ name: 'Listed Person', employeeCode: 'LP_01', loginEnabled: true, loginRole: 'TEAM_MEMBER', loginPassword: 'Secret123' })
      .expect(201);
    await api().post('/api/auth/login').send({ username: 'LP_01', password: 'Secret123' }).expect(200);
    // The sign-in time is recorded in the background
    await new Promise((resolve) => setTimeout(resolve, 200));

    const list = await as(superAdmin).get('/api/users').expect(200);
    const row = list.body.find((u: { id: string }) => u.id === created.body.userId);
    expect(row).toMatchObject({ employeeCode: 'LP_01', isActive: true, lastLoginAt: expect.any(String) });

    await as(superAdmin).patch(`/api/users/${created.body.userId}`).send({ isActive: false }).expect(200);
    await api().post('/api/auth/login').send({ username: 'LP_01', password: 'Secret123' }).expect(401);
  });
});
