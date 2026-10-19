import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { activityLogs, roles } from '../src/server/db/schema';
import { ALL_PERMISSIONS, SYSTEM_ROLES } from '../src/server/lib/erpPermissions';
import { invalidateRoleCache } from '../src/server/erp/context';
import { ROLE, actingAsRole, as, db, resetDb, roleId, seedTestCatalog } from './harness';

describe('Roles and permissions', () => {
  beforeEach(async () => {
    await resetDb();
    await seedTestCatalog();
  });

  it('reserves role management for super admins by default', async () => {
    const employee = await actingAsRole(ROLE.EMPLOYEE);
    await as(employee).get('/api/v1/admin/roles').expect(403);

    const admin = await actingAsRole(ROLE.ADMIN);
    await as(admin).get('/api/v1/admin/roles').expect(403);

    for (const role of [ROLE.SUPER_ADMIN, 'MANAGEMENT']) {
      const superAdmin = await actingAsRole(role);
      const { body } = await as(superAdmin).get('/api/v1/admin/roles').expect(200);
      // Every system role, plus the ADMIN role the tests add
      expect(body.data).toHaveLength(SYSTEM_ROLES.length + 1);
    }
  });

  it('gives HR people and managers quotations', async () => {
    const hr = await actingAsRole(ROLE.HR);
    await as(hr).get('/api/hr/employees').expect(200);
    await as(hr).post('/api/masters/departments').send({ name: 'Studio' }).expect(201);
    await as(hr).get('/api/v1/quotations').expect(403);

    const manager = await actingAsRole(ROLE.MANAGER);
    await as(manager).get('/api/v1/quotations').expect(200);
    await as(manager).post('/api/masters/departments').send({ name: 'Other' }).expect(403);
  });

  it('extends HR screens to any role granted the permission', async () => {
    const superAdmin = await actingAsRole(ROLE.SUPER_ADMIN);
    const created = await as(superAdmin)
      .post('/api/v1/admin/roles')
      .send({ name: 'Office Manager', permissions: ['employees.view', 'designations.manage'] })
      .expect(201);

    const officeManager = await actingAsRole(created.body.data.slug);
    await as(officeManager).get('/api/hr/employees').expect(200);
    await as(officeManager).post('/api/hr/employees').send({ name: 'Nope' }).expect(403);
    await as(officeManager).post('/api/masters/designations').send({ name: 'Editor' }).expect(201);
    await as(officeManager).get('/api/hr/salaries').expect(403);
  });

  it('groups permissions by module', async () => {
    const superAdmin = await actingAsRole(ROLE.SUPER_ADMIN);
    const { body } = await as(superAdmin).get('/api/v1/admin/permissions').expect(200);

    expect(body.data[0]).toEqual({
      module: expect.any(String),
      permissions: expect.arrayContaining([expect.objectContaining({ id: expect.any(String), slug: expect.any(String), name: expect.any(String) })]),
    });
    const total = body.data.reduce((sum: number, group: { permissions: unknown[] }) => sum + group.permissions.length, 0);
    expect(total).toBe(24);
  });

  it('creates and updates a role', async () => {
    const superAdmin = await actingAsRole(ROLE.SUPER_ADMIN);

    const created = await as(superAdmin)
      .post('/api/v1/admin/roles')
      .send({ name: 'Sales Executive', permissions: ['dashboard.view', 'quotations.create'] })
      .expect(201);
    expect(created.body.data.slug).toBe('SALES_EXECUTIVE');
    expect(created.body.data.is_system).toBe(false);

    const updated = await as(superAdmin)
      .put(`/api/v1/admin/roles/${created.body.data.id}`)
      .send({ name: 'Sales Executive', permissions: ['dashboard.view', 'quotations.view'] })
      .expect(200);
    expect(updated.body.data.permissions.sort()).toEqual(['dashboard.view', 'quotations.view']);

    const [logged] = await db.select().from(activityLogs).where(and(eq(activityLogs.event, 'updated'), eq(activityLogs.subjectId, created.body.data.id)));
    expect(logged).toBeDefined();
  });

  it('opens the matching endpoint as soon as a permission is granted', async () => {
    const admin = await actingAsRole(ROLE.ADMIN);
    await as(admin).get('/api/v1/admin/roles').expect(403);

    const [role] = await db.select().from(roles).where(eq(roles.slug, ROLE.ADMIN));
    await db.update(roles).set({ permissions: [...role.permissions, 'roles.manage'] }).where(eq(roles.id, role.id));
    invalidateRoleCache();

    // Permissions are resolved per request, so the running token sees the grant
    await as(admin).get('/api/v1/admin/roles').expect(200);
  });

  it('refuses to delete a system role', async () => {
    const superAdmin = await actingAsRole(ROLE.SUPER_ADMIN);
    await as(superAdmin).delete(`/api/v1/admin/roles/${await roleId('SALES')}`).expect(409);
  });

  it('refuses to delete a role that is still assigned', async () => {
    const superAdmin = await actingAsRole(ROLE.SUPER_ADMIN);
    const created = await as(superAdmin).post('/api/v1/admin/roles').send({ name: 'Temporary', permissions: [] }).expect(201);

    await actingAsRole('TEMPORARY');
    await as(superAdmin).delete(`/api/v1/admin/roles/${created.body.data.id}`).expect(409);

    const unused = await as(superAdmin).post('/api/v1/admin/roles').send({ name: 'Unused', permissions: [] }).expect(201);
    await as(superAdmin).delete(`/api/v1/admin/roles/${unused.body.data.id}`).expect(204);
  });

  it('always keeps every permission on the Super Admin role', async () => {
    const superAdmin = await actingAsRole(ROLE.SUPER_ADMIN);
    const id = await roleId(ROLE.SUPER_ADMIN);

    await as(superAdmin).put(`/api/v1/admin/roles/${id}`).send({ name: 'Super Admin', permissions: [] }).expect(200);

    const [after] = await db.select().from(roles).where(eq(roles.id, id));
    expect(after.permissions).toHaveLength(ALL_PERMISSIONS.length);
  });

  it('rejects an unknown permission slug', async () => {
    const superAdmin = await actingAsRole(ROLE.SUPER_ADMIN);
    const { body } = await as(superAdmin).post('/api/v1/admin/roles').send({ name: 'X', permissions: ['does.not.exist'] }).expect(422);
    expect(body.errors['permissions.0']).toBeDefined();
  });

  it('reports the signed-in user and their permissions', async () => {
    const manager = await actingAsRole(ROLE.MANAGER);
    const { body } = await as(manager).get('/api/v1/auth/me').expect(200);

    expect(body.data.role).toMatchObject({ slug: 'PROJECT_MANAGER', name: 'Project Manager' });
    expect(body.data.is_super_admin).toBe(false);
    expect(body.data.permissions).toEqual(expect.arrayContaining(['quotations.view_all', 'artists.assign']));

    const superAdmin = await actingAsRole(ROLE.SUPER_ADMIN);
    const me = await as(superAdmin).get('/api/v1/auth/me').expect(200);
    expect(me.body.data.is_super_admin).toBe(true);
    expect(me.body.data.permissions).toHaveLength(ALL_PERMISSIONS.length);
  });
});
