/**
 * Prepares the database before the app starts serving: applies pending SQL migrations from ./drizzle and
 * creates the default roles, permissions and company settings (never overwriting existing ones).
 *
 * Runs automatically as part of `vercel-build` on every Vercel deployment, and before `pnpm dev` locally.
 * Set SKIP_DB_SETUP=true to skip it (e.g. preview deployments that share the production database).
 */
import '../env';
import { pool } from '../db/index';
import { runMigrations } from '../db/migrate';
import { ensureErpDefaults } from '../erp/seed/defaults';

// `pnpm dev` starts the local database alongside the app, so wait for it to accept connections
async function waitForDatabase(attempts = 30) {
  for (let i = 1; ; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ECONNREFUSED' || i >= attempts) throw err;
      if (i === 1) console.log('Waiting for PostgreSQL to accept connections…');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function main() {
  if (process.env.SKIP_DB_SETUP === 'true') {
    console.log('[deploy] SKIP_DB_SETUP=true — database left as it is');
    return;
  }
  if (!process.env.DATABASE_URL) {
    const message = '[deploy] DATABASE_URL is not set — add it in Vercel → Project → Settings → Environment Variables (or apps/web/.env.local)';
    if (process.env.VERCEL_ENV === 'production') throw new Error(message);
    console.warn(message);
    return;
  }
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if (!process.env[key]) console.warn(`[deploy] ${key} is not set — sign-in will fail until it is`);
  }
  const started = Date.now();
  await waitForDatabase();
  await runMigrations();
  await ensureErpDefaults();
  console.log(`[deploy] Database ready (${Date.now() - started}ms)`);
}

main()
  .catch((err) => {
    console.error('[deploy] Database setup failed:', (err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
