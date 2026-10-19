/**
 * Assigns roleIds to users from their legacy `role` string.
 * Maps legacy role enum to Role slug, then assigns roleIds
 * Run after seedRolesPermissions.ts
 */
import '../env';
import { and, eq, sql } from 'drizzle-orm';
import { db, pool } from '../db/index';
import { roles, users } from '../db/schema';

const LEGACY_ROLE_TO_SLUG: Record<string, string> = {
  SUPER_ADMIN: 'super-admin',
  MANAGEMENT: 'management',
  PROJECT_MANAGER: 'product-manager',
  DEVELOPER: 'developer',
  DESIGNER: 'designer',
  MARKETING: 'marketing',
  ADS_TEAM: 'ads-team',
  SALES: 'sales',
  SUPPORT: 'support-agent',
  HR: 'hr-manager',
  TEAM_MEMBER: 'team-member',
  CLIENT: 'client',
};

async function migrate() {
  console.log('Connected to PostgreSQL');

  const roleRows = await db.select({ id: roles.id, slug: roles.slug }).from(roles);
  const roleBySlug = new Map(roleRows.map((r) => [r.slug, r.id]));

  // Skip users that already have roleIds
  const pending = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(sql`cardinality(${users.roleIds}) = 0`);
  let updated = 0;

  for (const user of pending) {
    const slug = LEGACY_ROLE_TO_SLUG[user.role];
    if (!slug) {
      console.warn(`Unknown role: ${user.role} for user ${user.id}`);
      continue;
    }

    const roleId = roleBySlug.get(slug);
    if (!roleId) {
      console.warn(`Role ${slug} not found, run seedRolesPermissions first`);
      continue;
    }

    await db
      .update(users)
      .set({ roleIds: [roleId] })
      .where(and(eq(users.id, user.id), sql`cardinality(${users.roleIds}) = 0`));
    updated++;
    console.log(`Migrated user ${user.id} (${user.role}) -> roleIds`);
  }

  console.log(`Migration complete: ${updated} users updated`);
}

migrate()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
