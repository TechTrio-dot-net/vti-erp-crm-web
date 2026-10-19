/**
 * Seeds the quotation catalog only — services, languages, durations, artists, performers, video types
 * and their rates — plus roles and company settings. Idempotent: nothing already present is changed.
 *
 *   pnpm seed:catalog
 */
import '../env';
import { pool } from '../db/index';
import { runMigrations } from '../db/migrate';
import { seedCatalog } from '../erp/seed/catalog';
import { ensureErpDefaults } from '../erp/seed/defaults';

async function main() {
  await runMigrations();
  await ensureErpDefaults();
  await seedCatalog();
  console.log('Roles, company settings and the quotation catalog are in place.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
