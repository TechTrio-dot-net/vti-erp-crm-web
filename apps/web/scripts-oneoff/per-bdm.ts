import { pool } from '../src/server/db/index';
(async () => {
  // Old BDM ids 4 and 11 are the same people as 12 and 10 (merged, as agreed)
  const merged = `case (x)::int when 4 then 12 when 11 then 10 else (x)::int end`;
  const m = (col: string) => merged.replace(/\(x\)/g, `(${col})`);
  const { rows } = await pool.query(`
    with b as (select (data->>'id')::int id, data->>'bdm_name' name from legacy_archive where table_name='bdm_master' and row_key<>'__columns'),
    old_leads as (select ${m("data->>'bdm_id'")} bdm, count(*) n,
        count(*) filter (where data->>'status' not in ('Lost','Not Interested','Invalid','Disqualified','Just Curious','Event Planner','Travel Agent','Voucher Inquiry','Investor (Real Estate)','Closed','Booked','Token Amount Received')) open
      from legacy_archive where table_name='re_leads' and row_key<>'__columns' group by 1),
    old_fups as (select ${m("f.data->>'bdm_id'")} bdm, count(*) n from legacy_archive f
      where f.table_name='re_leads_fups' and f.row_key<>'__columns'
        and exists (select 1 from legacy_archive l where l.table_name='re_leads' and l.row_key = f.data->>'lead_id') group by 1),
    usr as (select distinct on (${m("a.data->>'bdm_id'")}) ${m("a.data->>'bdm_id'")} bdm, l.assigned_to uid
      from legacy_archive a join leads l on l.external_id='legacy-crm:'||a.row_key where a.table_name='re_leads' and a.row_key<>'__columns' and (a.data->>'bdm_id')::int>0),
    new_leads as (select assigned_to uid, count(*) n, count(*) filter (where stage not in ('WON','LOST')) open from leads where external_id like 'legacy-crm:%' group by 1),
    new_fups as (select user_id uid, count(*) n from lead_followups where client_ref like 'legacy-crm-fup:%' group by 1)
    select coalesce(u.name, 'Unassigned') as bdm, u.username, u.is_active as active,
      coalesce(ol.n,0)::int old_leads, coalesce(nl.n,0)::int new_leads, coalesce(ol.open,0)::int old_open, coalesce(nl.open,0)::int new_open,
      coalesce(of.n,0)::int old_followups, coalesce(nf.n,0)::int new_followups,
      case when coalesce(ol.n,0)=coalesce(nl.n,0) and coalesce(of.n,0)=coalesce(nf.n,0) and coalesce(ol.open,0)=coalesce(nl.open,0) then 'match' else 'DIFFERENT' end as result
    from old_leads ol
    left join usr on usr.bdm = ol.bdm
    left join users u on u.id = usr.uid
    left join new_leads nl on nl.uid is not distinct from usr.uid
    left join old_fups of on of.bdm = ol.bdm
    left join new_fups nf on nf.uid = usr.uid
    order by old_leads desc`);
  console.table(rows);
  const t = rows.reduce((a, r) => ({ ol: a.ol + r.old_leads, nl: a.nl + r.new_leads, of: a.of + r.old_followups, nf: a.nf + r.new_followups }), { ol: 0, nl: 0, of: 0, nf: 0 });
  console.log('TOTAL', t);
  console.log((await pool.query(`select count(*)::int as followups_by_bdm_0_or_unknown from lead_followups where client_ref like 'legacy-crm-fup:%' and user_id is null`)).rows[0]);
  await pool.end();
})();
