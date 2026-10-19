import { createServer } from 'net';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import EmbeddedPostgres from 'embedded-postgres';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    storagePath: string;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

/**
 * One throwaway PostgreSQL server for the whole run: the real database engine, so migrations,
 * constraints, numeric math and transactions behave exactly as in production.
 */
export default async function setup(project: TestProject) {
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir: mkdtempSync(join(tmpdir(), 'voicetunes-pg-')),
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    onLog: () => {},
  });
  await server.initialise();
  await server.start();
  await server.createDatabase('voicetunes_test');

  const databaseUrl = `postgresql://postgres:postgres@localhost:${port}/voicetunes_test?sslmode=disable`;
  process.env.DATABASE_URL = databaseUrl;
  const { runMigrations } = await import('../src/server/db/migrate');
  await runMigrations();

  project.provide('databaseUrl', databaseUrl);
  project.provide('storagePath', mkdtempSync(join(tmpdir(), 'voicetunes-storage-')));

  return async () => {
    await server.stop();
  };
}
