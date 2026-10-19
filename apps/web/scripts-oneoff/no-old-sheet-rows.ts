/** Live: the Google Sheet source stops importing rows that were already in the sheet. Changes one setting, no leads. */
import { pool } from '../src/server/db/index';
(async () => {
  const r = await pool.query(`update lead_sources set config = config || '{"importExisting": false}'::jsonb, updated_at = now()
    where type = 'google_sheet' and (config->>'importExisting')::boolean is true returning name, config - 'baselinedTabs' config`);
  console.log(JSON.stringify(r.rows));
  await pool.end();
})();
