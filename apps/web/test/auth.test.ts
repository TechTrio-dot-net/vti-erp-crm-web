import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { employees, users } from '../src/server/db/schema';
import { invalidateAuthUser } from '../src/server/lib/auth';
import { PASSWORD, ROLE, actingAsRole, api, as, db, resetDb, seedTestCatalog } from './harness';

describe('Authentication', () => {
  let userId: string;

  beforeEach(async () => {
    await resetDb();
    await seedTestCatalog();

    // An employee who can sign in by username, email or employee ID
    const actor = await actingAsRole(ROLE.EMPLOYEE, { username: 'emp', email: 'Emp@Example.com' });
    userId = actor.userId;
    await db.insert(employees).values({ userId, employeeCode: 'VTI-0100', name: 'Test Employee', phone: '+91 98765 43210' });
  });

  const login = (username: string, password = PASSWORD) => api().post('/api/auth/login').send({ username, password });

  it('signs in by username, email or employee ID', async () => {
    for (const identifier of ['emp', 'emp@example.com', 'VTI-0100', 'vti-0100']) {
      const { body } = await login(identifier).expect(200);
      expect(body.token).toEqual(expect.any(String));
      expect(body.user.id).toBe(userId);
      expect(body.user.passwordHash).toBeUndefined();
    }
  });

  it('rejects a wrong password and inactive or terminated accounts', async () => {
    await login('emp', 'WrongPass1').expect(401);

    await db.update(employees).set({ status: 'terminated' }).where(eq(employees.userId, userId));
    await login('VTI-0100').expect(401);

    await db.update(employees).set({ status: 'active' }).where(eq(employees.userId, userId));
    await db.update(users).set({ isActive: false }).where(eq(users.id, userId));
    await login('emp').expect(401);
  });

  it('records sign-ins in the activity log', async () => {
    await login('emp').expect(200);
    const superAdmin = await actingAsRole(ROLE.SUPER_ADMIN);

    // Written in the background
    await new Promise((resolve) => setTimeout(resolve, 200));
    const { body } = await as(superAdmin).get('/api/v1/admin/activity-logs?event=login').expect(200);
    expect(body.data[0].description).toContain('signed in');
  });

  it('requires a token for the ERP endpoints', async () => {
    await api().get('/api/v1/auth/me').expect(401);
  });

  it('stops a token working once the account is deactivated', async () => {
    const { body } = await login('emp').expect(200);
    const actor = { token: body.token, userId };

    await as(actor).get('/api/v1/auth/me').expect(200);
    await db.update(users).set({ isActive: false }).where(eq(users.id, userId));
    invalidateAuthUser(userId);
    await as(actor).get('/api/v1/auth/me').expect(401);
  });

  describe('changing a password', () => {
    it('ends other sessions but keeps this one, via replacement tokens', async () => {
      const first = await login('emp').expect(200);
      const second = await login('emp').expect(200);

      const { body, headers } = await as({ token: second.body.token, userId })
        .post('/api/auth/change-password')
        .send({ current_password: PASSWORD, password: 'NewPassword456', password_confirmation: 'NewPassword456' })
        .expect(200);
      expect(body.token).toEqual(expect.any(String));
      expect(String(headers['set-cookie'])).toContain('refreshToken=');

      // The other device is signed out; this one continues on the replacement
      await as({ token: first.body.token, userId }).get('/api/v1/auth/me').expect(401);
      await as({ token: body.token, userId }).get('/api/v1/auth/me').expect(200);

      await login('emp', 'NewPassword456').expect(200);
      await login('emp', PASSWORD).expect(401);
    });

    it('refuses the old refresh token after the change', async () => {
      const session = await login('emp').expect(200);
      const cookie = String(session.headers['set-cookie']).split(';')[0];

      await api().post('/api/auth/refresh').set('Cookie', cookie).expect(200);
      await as({ token: session.body.token, userId })
        .post('/api/auth/change-password')
        .send({ current_password: PASSWORD, password: 'NewPassword456', password_confirmation: 'NewPassword456' })
        .expect(200);
      await api().post('/api/auth/refresh').set('Cookie', cookie).expect(401);
    });

    it('rejects a wrong current password', async () => {
      const actor = await actingAsRole(ROLE.EMPLOYEE);
      const { body } = await as(actor)
        .post('/api/auth/change-password')
        .send({ current_password: 'NotMyPassword1', password: 'NewPassword456', password_confirmation: 'NewPassword456' })
        .expect(422);
      expect(body.errors.current_password).toBeDefined();
    });

    it('requires the confirmation to match', async () => {
      const actor = await actingAsRole(ROLE.EMPLOYEE);
      const { body } = await as(actor)
        .post('/api/auth/change-password')
        .send({ current_password: PASSWORD, password: 'NewPassword456', password_confirmation: 'Different789' })
        .expect(422);
      expect(body.errors.password_confirmation).toBeDefined();
    });

    it('requires letters and numbers', async () => {
      const actor = await actingAsRole(ROLE.EMPLOYEE);
      const { body } = await as(actor)
        .post('/api/auth/change-password')
        .send({ current_password: PASSWORD, password: 'onlyletters', password_confirmation: 'onlyletters' })
        .expect(422);
      expect(body.errors.password).toBeDefined();
    });
  });

  describe('resetting a password', () => {
    it('answers the same way whether or not the account exists', async () => {
      const known = await api().post('/api/auth/forgot-password').send({ email: 'VTI-0100' }).expect(200);
      const unknown = await api().post('/api/auth/forgot-password').send({ email: 'nobody@example.com' }).expect(200);
      expect(known.body.message).toBe(unknown.body.message);

      const [row] = await db.select({ resetToken: users.resetToken }).from(users).where(eq(users.id, userId));
      expect(row.resetToken).toEqual(expect.any(String));
    });

    it('signs the user out everywhere once the password is reset', async () => {
      const session = await login('emp').expect(200);
      await api().post('/api/auth/forgot-password').send({ email: 'emp@example.com' }).expect(200);
      const [row] = await db.select({ resetToken: users.resetToken }).from(users).where(eq(users.id, userId));

      await api().post('/api/auth/reset-password').send({ token: 'f'.repeat(64), password: 'ResetPass789' }).expect(400);
      await as({ token: session.body.token, userId }).get('/api/v1/auth/me').expect(200);

      await api().post('/api/auth/reset-password').send({ token: row.resetToken, password: 'ResetPass789' }).expect(200);
      await as({ token: session.body.token, userId }).get('/api/v1/auth/me').expect(401);
      await login('emp', 'ResetPass789').expect(200);
    });
  });
});
