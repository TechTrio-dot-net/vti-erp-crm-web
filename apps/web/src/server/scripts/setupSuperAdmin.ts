/**
 * Creates the super-admin account, or updates it (matched by email or username).
 *
 * Usage (values are read from the environment, never stored in code):
 *   SUPER_ADMIN_EMAIL=you@company.com SUPER_ADMIN_USERNAME=you SUPER_ADMIN_NAME="Your Name" \
 *   SUPER_ADMIN_PASSWORD='a-strong-password' pnpm setup:admin
 */
import '../env';
import { eq, or } from 'drizzle-orm';
import { db, pool } from '../db/index';
import { runMigrations } from '../db/migrate';
import { users } from '../db/schema';
import { hashPassword } from '../utils/password';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Set ${name} (see the usage note at the top of this script)`);
    process.exit(1);
  }
  return value;
}

async function run() {
  const email = required('SUPER_ADMIN_EMAIL').toLowerCase();
  const username = required('SUPER_ADMIN_USERNAME').toLowerCase();
  const name = required('SUPER_ADMIN_NAME');
  const password = required('SUPER_ADMIN_PASSWORD');
  if (password.length < 8) {
    console.error('SUPER_ADMIN_PASSWORD must be at least 8 characters');
    process.exit(1);
  }

  await runMigrations();
  const values = {
    email,
    username,
    name,
    passwordHash: await hashPassword(password),
    role: 'SUPER_ADMIN' as const,
    initials: name.split(/\s+/).map((n) => n[0]).join('').slice(0, 2).toUpperCase(),
    isActive: true,
  };

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.email, email), eq(users.username, username)))
    .limit(1);

  if (existing) {
    await db.update(users).set(values).where(eq(users.id, existing.id));
    console.log(`Updated super-admin: ${email}`);
  } else {
    await db.insert(users).values(values);
    console.log(`Created super-admin: ${email}`);
  }

  const admins = await db
    .select({ email: users.email, username: users.username, name: users.name })
    .from(users)
    .where(eq(users.role, 'SUPER_ADMIN'));
  console.log('\nCurrent SUPER_ADMIN accounts:');
  for (const a of admins) console.log(`  ${a.email} (${a.username}) — ${a.name}`);
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
