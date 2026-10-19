import { pool } from '../src/server/db/index';
(async () => {
  const { rows: tables } = await pool.query(`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`);
  const out: string[] = [];
  for (const t of tables) {
    const { rows } = await pool.query(`select count(*)::int n from "${t.table_name}"`);
    out.push(`${t.table_name}=${rows[0].n}`);
  }
  console.log(out.join('  '));
  const { rows: fks } = await pool.query(`select c.conrelid::regclass::text as child, a.attname as col, c.confrelid::regclass::text as parent, c.confdeltype as on_delete, a.attnotnull as notnull
    from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum = any(c.conkey) where c.contype='f' and c.connamespace='public'::regnamespace order by 1,2`);
  console.log('\nFKS ' + fks.map((f) => `${f.child}.${f.col}->${f.parent}(${f.on_delete}${f.notnull ? ',NN' : ''})`).join(' '));
  await pool.end();
})();
