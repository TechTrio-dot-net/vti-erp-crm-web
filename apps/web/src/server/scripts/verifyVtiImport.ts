/**
 * Compares the former VTI ERP (MongoDB) with this database after `pnpm migrate:vti`: record counts per
 * collection and the money totals on quotations and payments. Read-only on both sides.
 *
 *   VTI_MONGODB_URI="…" pnpm verify:vti
 */
import '../env';
import { MongoClient } from 'mongodb';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db/index';
import { money } from '../erp/decimal';

async function main() {
  const client = new MongoClient(process.env.VTI_MONGODB_URI!);
  await client.connect();
  const mongo = client.db();
  const n = async (table: string, where = 'true') => Number((await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`))).rows[0].n);

  const rows: Record<string, { vti: number; merged: number; ok: string }> = {};
  const check = (name: string, vti: number, merged: number) => (rows[name] = { vti, merged, ok: merged >= vti ? '✓' : '✗ MISSING' });

  check('users', await mongo.collection('users').countDocuments(), await n('users'));
  check('employees (not deleted)', await mongo.collection('employees').countDocuments({ deleted_at: null }), await n('employees'));
  check('departments', await mongo.collection('departments').countDocuments(), await n('departments'));
  check('designations', await mongo.collection('designations').countDocuments(), await n('designations'));
  check('services', await mongo.collection('services').countDocuments(), await n('services'));
  check('languages', await mongo.collection('languages').countDocuments(), await n('languages'));
  check('video types', await mongo.collection('video_types').countDocuments(), await n('video_types'));
  check('durations', await mongo.collection('durations').countDocuments(), await n('durations'));
  check('performers', await mongo.collection('performers').countDocuments(), await n('performers'));
  check('artists', await mongo.collection('artists').countDocuments(), await n('artists'));
  check('pricing rules', await mongo.collection('pricing_rules').countDocuments(), await n('pricing_rules'));
  check('quotations', await mongo.collection('quotations').countDocuments(), await n('quotations'));
  check('quotation lines', await mongo.collection('quotation_items').countDocuments(), await n('quotation_items'));
  check('payments', await mongo.collection('payments').countDocuments(), await n('quotation_payments'));
  check('company settings', await mongo.collection('company_settings').countDocuments(), await n('company_settings'));
  check('activity log', await mongo.collection('activity_logs').countDocuments(), await n('activity_logs', "event <> 'login' OR created_at < now() - interval '1 minute'"));
  console.table(rows);

  const sum = async (collection: string, field: string) =>
    money((await mongo.collection(collection).find().toArray()).reduce((s, d) => s + Number(String(d[field] ?? 0)), 0));
  const pg = async (query: string) => money((await db.execute(sql.raw(query))).rows[0].total);
  const totals = {
    'quotation grand totals': { vti: await sum('quotations', 'grand_total'), merged: await pg('SELECT coalesce(sum(grand_total),0) AS total FROM quotations') },
    'amounts paid on quotations': { vti: await sum('quotations', 'amount_paid'), merged: await pg('SELECT coalesce(sum(amount_paid),0) AS total FROM quotations') },
    'payments received': { vti: await sum('payments', 'amount'), merged: await pg('SELECT coalesce(sum(amount),0) AS total FROM quotation_payments') },
  };
  console.table(Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, { ...v, ok: v.vti === v.merged ? '✓' : '✗ DIFFERENT' }])));

  const numbers = (await mongo.collection('quotations').find().project({ quotation_number: 1 }).toArray()).map((q) => String(q.quotation_number)).sort();
  const merged = (await db.execute(sql`SELECT quotation_number FROM quotations ORDER BY 1`)).rows.map((r) => String(r.quotation_number));
  console.log('Quotation numbers match:', JSON.stringify(numbers) === JSON.stringify(merged) ? '✓' : `✗ VTI ${numbers} vs ${merged}`);

  const files = (await mongo.collection('payments').find({ attachment: { $ne: null } }).toArray()).map((p) => p.attachment.file);
  console.log(`Payment screenshots referenced: ${files.length}`);
  await client.close();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
