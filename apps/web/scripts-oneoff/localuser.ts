import { pool } from '../src/server/db/index';
import { hashPassword } from '../src/server/utils/password';
(async () => {
  if (!/localhost:5433/.test(process.env.DATABASE_URL ?? '')) throw new Error('local only');
  const h = await hashPassword('admin123');
  const r = await pool.query(`insert into users (username,email,name,password_hash,role,initials) values ('uitest','uitest@example.com','UI Test',$1,'SUPER_ADMIN','UT')
    on conflict (username) do update set password_hash=excluded.password_hash, is_active=true returning username`, [h]);
  console.log(r.rows, (await pool.query(`select count(*)::int n from lead_sources`)).rows);
  await pool.end();
})();
