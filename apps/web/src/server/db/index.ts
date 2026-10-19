import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}

/**
 * pg ignores `channel_binding` and warns about `sslmode=require`, so strip both
 * from the URL and express them as explicit client options instead.
 */
export function pgConfig(overrides: pg.PoolConfig = {}): pg.PoolConfig {
  const url = new URL(getDatabaseUrl());
  const sslMode = url.searchParams.get('sslmode');
  const channelBinding = url.searchParams.get('channel_binding');
  url.searchParams.delete('sslmode');
  url.searchParams.delete('channel_binding');
  const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname);
  return {
    connectionString: url.toString(),
    ssl: sslMode === 'disable' || (isLocal && !sslMode) ? false : { rejectUnauthorized: true },
    enableChannelBinding: channelBinding === 'require' || channelBinding === 'prefer',
    ...overrides,
  } as pg.PoolConfig;
}

// A new TLS connection to Neon costs ~600ms vs ~100ms for a query on an open one, so keep connections
// around between requests. On Vercel every function instance holds a small pool of its own (point
// DATABASE_URL at Neon's "-pooler" endpoint), and attachDatabasePool releases idle clients before the
// instance is suspended.
const serverless = !!process.env.VERCEL;

function createPool() {
  const created = new pg.Pool(
    pgConfig({
      min: serverless ? 0 : Number(process.env.DB_POOL_MIN) || 2,
      max: Number(process.env.DB_POOL_MAX) || (serverless ? 5 : 10),
      idleTimeoutMillis: serverless ? 60_000 : 5 * 60_000,
      connectionTimeoutMillis: 15_000, // Neon can take a few seconds to wake a suspended compute
      keepAlive: true,
    })
  );
  created.on('error', (err) => console.error('[DB] Idle client error:', err.message));
  if (serverless) attachDatabasePool(created);
  return created;
}

// `next dev` re-evaluates modules on every change; reuse one pool instead of leaking a new one each time
const globalForDb = globalThis as unknown as { vtiPool?: pg.Pool };
export const pool = globalForDb.vtiPool ?? createPool();
if (process.env.NODE_ENV !== 'production') globalForDb.vtiPool = pool;

export const db = drizzle({ client: pool, schema, casing: 'snake_case' });
export type DB = typeof db;
export { schema };
