import { pool } from '../src/server/db/index';
(async () => {
  const { rows } = await pool.query(`
    select u.name, to_char((l.created_at at time zone 'Asia/Kolkata')::date,'MM-DD') d, count(*)::int n, count(*) filter (where l.first_contact_at is null)::int p
    from leads l join users u on u.id=l.assigned_to and u.role='SALES' and u.is_active
    where (l.created_at at time zone 'Asia/Kolkata')::date between '2026-10-07' and '2026-10-13' group by 1,2`);
  const days = ['10-13','10-12','10-11','10-10','10-09','10-08','10-07'];
  const out: Record<string, Record<string,string>> = {};
  for (const r of rows) (out[r.name] ??= {})[r.d] = r.p ? `${r.n}-${r.p}` : `${r.n}`;
  console.table(Object.fromEntries(Object.entries(out).map(([k,v]) => [k, Object.fromEntries(days.map(d => [d, v[d] ?? '–']))])));
  await pool.end();
})();
