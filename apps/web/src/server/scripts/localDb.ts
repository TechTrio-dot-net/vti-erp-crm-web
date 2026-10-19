/**
 * A PostgreSQL server for local development, with no install: `pnpm db:local` keeps one running in
 * apps/web/.pgdata (data survives restarts). Point DATABASE_URL at the address it prints.
 *
 * Production should use a managed PostgreSQL (e.g. Neon) instead.
 */
import { existsSync } from 'fs';
import { join } from 'path';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';

const PORT = Number(process.env.LOCAL_DB_PORT) || 5433;
const DATABASE = 'voicetunes';
const dataDir = join(process.cwd(), '.pgdata');

const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: true,
  onLog: () => {},
});

async function alreadyRunning() {
  const probe = new pg.Client({ connectionString: `postgresql://postgres:postgres@localhost:${PORT}/postgres` });
  try {
    await probe.connect();
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // Another `pnpm db:local` (or `pnpm dev`) already serves this port: nothing to start
  if (await alreadyRunning()) {
    console.log(`PostgreSQL is already running on port ${PORT}.`);
    setInterval(() => {}, 1 << 30);
    return;
  }
  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    console.log('Creating a new local database cluster in .pgdata …');
    await server.initialise();
  }
  await server.start();

  const client = new pg.Client({ connectionString: `postgresql://postgres:postgres@localhost:${PORT}/postgres` });
  await client.connect();
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DATABASE]);
  if (!rowCount) await client.query(`CREATE DATABASE ${DATABASE}`);
  await client.end();

  console.log(`PostgreSQL is running. Use this in apps/web/.env.local:\n\n  DATABASE_URL=postgresql://postgres:postgres@localhost:${PORT}/${DATABASE}?sslmode=disable\n`);
  console.log('Press Ctrl+C to stop.');
}

async function stop() {
  await server.stop().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

main().catch(async (err) => {
  console.error('Could not start the local database:', (err as Error).message);
  await server.stop().catch(() => {});
  process.exit(1);
});
