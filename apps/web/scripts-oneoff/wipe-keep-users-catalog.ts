/**
 * One-off, irreversible: empties the CRM except the users and the catalog.
 *
 *   KEEPS  users, roles, permissions · services, categories · artists (+ their services and languages),
 *          performers, languages, video types, durations, pricing rules · company settings
 *   WIPES  everything else: leads and their history, calls and recordings, quotations and payments, clients,
 *          projects and tasks, HR, lead sources and campaign rules, the old-CRM archive, notifications, logs
 *
 * Reports only, unless --wipe is given. The wipe runs in one transaction and is rolled back if any kept table
 * would lose a row. Take a backup first.
 *
 *   cd apps/web && DATABASE_URL="…" npx tsx scripts-oneoff/wipe-keep-users-catalog.ts          # report
 *   cd apps/web && DATABASE_URL="…" npx tsx scripts-oneoff/wipe-keep-users-catalog.ts --wipe   # do it
 */
import { pool } from '../src/server/db/index';

const WIPE = process.argv.includes('--wipe');

const KEEP = [
  'users', 'roles', 'permissions',
  'services', 'categories',
  'artists', 'artist_services', 'artist_languages', 'performers', 'languages', 'video_types', 'durations', 'pricing_rules',
  'company_settings',
  // Internal bookkeeping of the app (background-job timestamps, change counters), not business data
  'job_runs', 'app_signals',
];

/** Children before the tables they point at with a "restrict" link (invoices and projects before clients) */
const WIPE_ORDER = [
  'quotation_payments', 'quotation_items', 'quotations', 'quotation_sequences',
  'lead_followups', 'lead_assignments', 'lead_imports', 'whatsapp_logs', 'dial_requests',
  'call_recordings', 'call_logs', 'leads',
  'lead_source_bdms', 'campaign_bdm_rules', 'lead_sources', 'legacy_archive',
  'active_timers', 'time_entries', 'comments', 'content_calendar', 'files', 'ad_campaigns', 'activities',
  'project_team_members', 'tasks', 'invoices', 'projects', 'clients',
  'salaries', 'employees', 'departments', 'designations', 'divisions',
  'bdm_leaves', 'bdm_sessions', 'mobile_devices',
  'notifications', 'activity_logs', 'email_logs',
];

(async () => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`
    );
    const all = rows.map((r) => r.table_name);
    // Every table must be on exactly one list: nothing is wiped or kept by accident
    const unlisted = all.filter((t) => !KEEP.includes(t) && !WIPE_ORDER.includes(t));
    const unknown = [...KEEP, ...WIPE_ORDER].filter((t) => !all.includes(t));
    const both = KEEP.filter((t) => WIPE_ORDER.includes(t));
    if (unlisted.length || unknown.length || both.length) {
      throw new Error(`Table lists don't match the database — not listed: [${unlisted}] · not in database: [${unknown}] · on both lists: [${both}]`);
    }
    const count = async (t: string) => Number((await client.query(`SELECT count(*) AS n FROM "${t}"`)).rows[0].n);
    const counts = async (tables: string[]) => {
      const result: Record<string, number> = {};
      for (const t of tables) result[t] = await count(t); // one at a time: a connection runs one query at once
      return result;
    };

    await client.query('BEGIN');
    const keptBefore = await counts(KEEP);
    const wipeBefore = await counts(WIPE_ORDER);
    console.log('\nKEEP (untouched):');
    console.log('  ' + KEEP.map((t) => `${t} ${keptBefore[t]}`).join(' · '));
    console.log(`\n${WIPE ? 'WIPING' : 'WOULD WIPE'} (${Object.values(wipeBefore).reduce((a, b) => a + b, 0).toLocaleString('en-IN')} rows):`);
    console.log('  ' + WIPE_ORDER.filter((t) => wipeBefore[t] > 0).map((t) => `${t} ${wipeBefore[t]}`).join(' · '));
    console.log('  empty already: ' + WIPE_ORDER.filter((t) => wipeBefore[t] === 0).join(', '));

    if (!WIPE) {
      await client.query('ROLLBACK');
      console.log('\nReport only — nothing was changed. Add --wipe to do it.');
      return;
    }

    for (const t of WIPE_ORDER) await client.query(`DELETE FROM "${t}"`);
    // Links from kept rows to wiped ones (a user's client or division, an artist's employee record) are
    // cleared by the database itself; nothing else in the kept tables may change
    const keptAfter = await counts(KEEP);
    const wipeAfter = await counts(WIPE_ORDER);
    const lost = KEEP.filter((t) => keptAfter[t] !== keptBefore[t]);
    const left = WIPE_ORDER.filter((t) => wipeAfter[t] !== 0);
    if (lost.length || left.length) {
      await client.query('ROLLBACK');
      throw new Error(`Rolled back, nothing changed — kept tables that would have changed: [${lost}] · not emptied: [${left}]`);
    }
    await client.query('COMMIT');
    console.log('\nDone. Kept tables are unchanged:');
    console.log('  ' + KEEP.map((t) => `${t} ${keptAfter[t]}`).join(' · '));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => {
  console.error('\n' + (e as Error).message);
  process.exit(1);
});
