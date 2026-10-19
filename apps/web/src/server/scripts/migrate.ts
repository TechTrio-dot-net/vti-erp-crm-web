/** Applies pending SQL migrations from ./drizzle (deployments do this automatically: see deploy.ts) */
import '../env';
import { pool } from '../db/index';
import { runMigrations } from '../db/migrate';

runMigrations()
  .then(() => console.log('Migrations applied'))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
