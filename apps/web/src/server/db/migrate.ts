import { join } from 'path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { pgConfig } from './index';

// apps/web/drizzle. Migrations run from the command line (deploy step, db:migrate, tests), never in a request.
const MIGRATIONS_FOLDER = join(process.cwd(), 'drizzle');
const MIGRATION_LOCK_ID = 727_001;
const LOCK_WAIT_MS = 30_000;

/**
 * Migrations need one real session: the advisory lock and its unlock must run on the same backend.
 * Neon's "-pooler" endpoint (PgBouncer, transaction mode) can send them to different backends and leak
 * the lock, so migrations connect to the direct endpoint instead.
 */
function directConnection(): pg.ClientConfig {
  const config = pgConfig();
  const url = new URL(config.connectionString!);
  url.hostname = url.hostname.replace('-pooler.', '.');
  return { ...config, connectionString: url.toString() };
}

/** Applies pending migrations; an advisory lock keeps concurrent instances from racing. */
export async function runMigrations(): Promise<void> {
  const client = new pg.Client(directConnection());
  await client.connect();
  try {
    // Bounded wait instead of pg_advisory_lock, so a stuck holder can never hang startup forever
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [MIGRATION_LOCK_ID]);
      if (rows[0]?.locked) break;
      if (Date.now() > deadline) {
        throw new Error('Timed out waiting for the migration lock (another API process may be migrating)');
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    try {
      await migrate(drizzle({ client, casing: 'snake_case' }), { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    }
  } finally {
    await client.end();
  }
}
