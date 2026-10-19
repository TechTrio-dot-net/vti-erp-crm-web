import { writeFileSync } from 'fs';
import { pool } from '../src/server/db/index';
(async () => { const { rows } = await pool.query(`select phone_normalized p from leads where phone_normalized is not null`); writeFileSync(process.argv[2], rows.map((r) => r.p).join('\n')); console.log('CRM leads with a phone:', rows.length); await pool.end(); })();
