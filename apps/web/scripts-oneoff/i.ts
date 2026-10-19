import { pool } from '../src/server/db/index';
(async () => {
  for (const t of ['dashboard_queries', 'status']) {
    const { rows } = await pool.query(`select row_key, data from legacy_archive where table_name=$1 order by row_key`, [t]);
    console.log('==', t); for (const r of rows) console.log(r.row_key, JSON.stringify(r.data));
  }
  await pool.end();
})();
