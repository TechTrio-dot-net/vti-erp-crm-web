import { pool } from '../src/server/db/index';
import { listSheetTabs, readSheetRows } from '../src/server/services/googleSheets';
(async () => {
  const { rows } = await pool.query(`select id, name, type, active, config - 'baselinedTabs' config, last_synced_at, last_error,
    (select count(*)::int from lead_imports i where i.source_id=s.id) imports, (select count(*)::int from lead_source_bdms b where b.source_id=s.id) team from lead_sources s`);
  console.log(JSON.stringify(rows, null, 1));
  const url = rows.find((r) => r.type === 'google_sheet')?.config.sheetUrl ?? 'https://docs.google.com/spreadsheets/d/1fiV5duOEZ_bVEZhijWrBTk8kxTneFKmC3lrqmTlUXlg/edit';
  const tabs = await listSheetTabs(url);
  for (const t of tabs) { const r = await readSheetRows(url, undefined, t.gid); console.log(t.gid.padEnd(11), String(r.length).padStart(5), 'rows ', t.title); }
  await pool.end();
})();
