import { randomUUID } from 'crypto';
import request from 'supertest';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createApp } from '../src/server/app';
import { db } from '../src/server/db/index';
import {
  artistServices,
  artists,
  durations,
  employees,
  languages,
  performers,
  pricingRules,
  roles,
  services,
  users,
  videoTypes,
  type Role,
} from '../src/server/db/schema';
import { invalidateAuthUser, signAccessToken } from '../src/server/lib/auth';
import { forgetAll } from '../src/server/erp/cache';
import { invalidateRoleCache } from '../src/server/erp/context';
import { SERVICE_DUBBING, SERVICE_VIDEO_EDITING, SERVICE_VOICE_OVER } from '../src/server/erp/catalog';
import { seedCatalog } from '../src/server/erp/seed/catalog';
import { ensureErpDefaults } from '../src/server/erp/seed/defaults';
import { hashPassword } from '../src/server/utils/password';

export { db };

export const app = createApp();
export const api = () => request(app);

export const PASSWORD = 'Password123';

/** Role slugs the specs act as. ADMIN is a custom role holding VTI's former Admin permissions. */
export const ROLE = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  MANAGER: 'PROJECT_MANAGER',
  EMPLOYEE: 'TEAM_MEMBER',
  HR: 'HR',
} as const;

const ADMIN_PERMISSIONS = [
  'dashboard.view',
  'quotations.view',
  'quotations.view_all',
  'quotations.create',
  'quotations.update',
  'quotations.delete',
  'payments.record',
  'services.manage',
  'artists.assign',
  'artists.manage',
  'languages.manage',
  'video_types.manage',
  'durations.manage',
  'pricing.manage',
  'employees.view',
  'employees.manage',
  'settings.company',
  'reports.view',
];

/** Empties every table and in-process cache, the equivalent of a fresh database */
export async function resetDb(): Promise<void> {
  const { rows } = await db.$client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  );
  if (rows.length) {
    const truncate = sql.raw(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    // Sign-in bookkeeping is written without awaiting the response, so a previous test's write
    // can still be in flight and deadlock with the truncate — let it finish and try again.
    for (let attempt = 1; ; attempt++) {
      try {
        await db.execute(truncate);
        break;
      } catch (err) {
        const code = (err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
        if (attempt >= 5 || (code !== '40P01' && code !== '55P03')) throw err;
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
      }
    }
  }
  forgetAll();
  invalidateRoleCache();
  invalidateAuthUser();
}

/** service slug → [artist code, artist name, rate per minute] */
const FIXTURES: [string, string, string, number][] = [
  [SERVICE_VIDEO_EDITING, 'VE_DEMO_001', 'Demo Video Editor', 1500],
  [SERVICE_VOICE_OVER, 'VO_F_DP0002', 'Demo Voice Artist', 2300],
  [SERVICE_DUBBING, 'DB_DEMO_001', 'Demo Dubbing Artist', 2000],
];

/** A video type no real rate applies to, so video editing lines price from the demo rates the tests create */
export const DEMO_VIDEO_TYPE = 'Demo Video Type';

/** Roles, settings and the real catalog, plus demo artists the pricing tests quote against */
export async function seedTestCatalog(): Promise<void> {
  await db.insert(videoTypes).values({ name: DEMO_VIDEO_TYPE }).onConflictDoNothing();
  await ensureErpDefaults();
  await db
    .insert(roles)
    .values({ slug: ROLE.ADMIN, name: 'Admin', description: 'Management access according to assigned permissions', permissions: ADMIN_PERMISSIONS })
    .onConflictDoNothing();
  await seedCatalog();

  for (const [slug, code, name, price] of FIXTURES) {
    const serviceId = await serviceIdOf(slug);
    await db.insert(artists).values({ code, name }).onConflictDoNothing();
    const artist = await artistId(code);
    await db.insert(artistServices).values({ artistId: artist, serviceId }).onConflictDoNothing();
    await db.insert(pricingRules).values({ serviceId, artistId: artist, name: `${name} — standard rate`, unit: 'per_minute', basePrice: String(price) });
  }
  forgetAll();
  invalidateRoleCache();
}

export interface Actor {
  token: string;
  userId: string;
}

/** A user with the given role, signed in */
export async function actingAsRole(role: string, overrides: Partial<typeof users.$inferInsert> = {}): Promise<Actor> {
  const suffix = randomUUID().slice(0, 8);
  const [user] = await db
    .insert(users)
    .values({
      name: `Test ${role}`,
      username: `${role.toLowerCase()}-${suffix}`,
      email: `${role.toLowerCase()}-${suffix}@example.test`,
      passwordHash: await hashPassword(PASSWORD),
      role: role as Role,
      ...overrides,
    })
    .returning();
  return { token: signAccessToken({ userId: user.id, role: user.role }), userId: user.id };
}

/** Requests carrying the actor's bearer token */
export function as(actor: Actor) {
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${actor.token}`);
  return {
    get: (url: string) => auth(api().get(url)),
    post: (url: string) => auth(api().post(url)),
    put: (url: string) => auth(api().put(url)),
    patch: (url: string) => auth(api().patch(url)),
    delete: (url: string) => auth(api().delete(url)),
  };
}

// ── Fixture lookups ─────────────────────────────────────────────────────────

export async function serviceIdOf(slug: string): Promise<string> {
  const [row] = await db.select({ id: services.id }).from(services).where(eq(services.slug, slug));
  return row.id;
}

export async function artistId(code: string): Promise<string> {
  const [row] = await db.select({ id: artists.id }).from(artists).where(eq(artists.code, code));
  return row.id;
}

export async function languageId(name: string): Promise<string> {
  const [row] = await db.select({ id: languages.id }).from(languages).where(eq(languages.name, name));
  return row.id;
}

export async function videoTypeId(name = DEMO_VIDEO_TYPE): Promise<string> {
  const [row] = await db.select({ id: videoTypes.id }).from(videoTypes).where(eq(videoTypes.name, name));
  return row.id;
}

export async function performerId(code: string): Promise<string> {
  const [row] = await db.select({ id: performers.id }).from(performers).where(eq(performers.code, code));
  return row.id;
}

export async function durationId(minutes: number): Promise<string> {
  const [row] = await db.select({ id: durations.id }).from(durations).where(eq(durations.minutes, minutes.toFixed(2)));
  return row.id;
}

export async function roleId(slug: string): Promise<string> {
  const [row] = await db.select({ id: roles.id }).from(roles).where(eq(roles.slug, slug));
  return row.id;
}

// ── Quotation lines ─────────────────────────────────────────────────────────

export type Line = Record<string, unknown>;

/** The brief's example: VO_F_DP0002, Hindi, 3 minutes, quantity 1 */
export async function voiceOverItem(overrides: Line = {}): Promise<Line> {
  return {
    service_id: await serviceIdOf(SERVICE_VOICE_OVER),
    artist_id: await artistId('VO_F_DP0002'),
    language_id: await languageId('Hindi'),
    duration_id: await durationId(3),
    quantity: 1,
    ...overrides,
  };
}

export async function videoEditingItem(overrides: Line = {}): Promise<Line> {
  return {
    service_id: await serviceIdOf(SERVICE_VIDEO_EDITING),
    artist_id: await artistId('VE_DEMO_001'),
    video_type_id: await videoTypeId(),
    language_id: await languageId('English'),
    duration_minutes: 2,
    quantity: 2,
    ...overrides,
  };
}

export async function dubbingItem(overrides: Line = {}): Promise<Line> {
  return {
    service_id: await serviceIdOf(SERVICE_DUBBING),
    artist_id: await artistId('DB_DEMO_001'),
    source_language_id: await languageId('English'),
    language_id: await languageId('Hindi'),
    duration_minutes: 1.5,
    quantity: 1,
    ...overrides,
  };
}

/** The fallback rule video editing uses while no editor is assigned */
export async function standardVideoEditingRate(rate: number): Promise<void> {
  await db.insert(pricingRules).values({
    name: 'Video Editing — standard rate',
    serviceId: await serviceIdOf(SERVICE_VIDEO_EDITING),
    unit: 'per_minute',
    basePrice: String(rate),
  });
}

export async function linkEmployee(userId: string, employeeCode: string) {
  await db.insert(employees).values({ userId, employeeCode, name: 'Test Employee' });
}

export { and, eq, isNull };
