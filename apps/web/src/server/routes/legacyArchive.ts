import { Router } from 'express';
import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { legacyArchive } from '../db/schema';
import { authMiddleware, type AuthRequest } from '../lib/auth';
import { requireCrmAdmin } from '../lib/crm';
import { sendError } from '../lib/http';

/** CRM Admin → Old CRM Archive: every row of the old PHP CRM's tables, as it was */
const router = Router();
/** The archive row that holds a table's column order (written by the import) */
const COLUMNS_KEY = '__columns';
router.use(authMiddleware, requireCrmAdmin);

router.get('/', async (_req: AuthRequest, res) => {
  try {
    const tables = await db
      .select({ name: legacyArchive.tableName, rows: count() })
      .from(legacyArchive)
      .where(ne(legacyArchive.rowKey, COLUMNS_KEY))
      .groupBy(legacyArchive.tableName)
      .orderBy(asc(legacyArchive.tableName));
    res.json({ tables });
  } catch (err) {
    sendError(res, err, 'Failed to load the archive');
  }
});

/** One old table's rows, newest id first, with a text search over every column */
router.get('/:table', async (req: AuthRequest, res) => {
  try {
    const table = String(req.params.table);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 1000);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const where = and(
      eq(legacyArchive.tableName, table),
      ne(legacyArchive.rowKey, COLUMNS_KEY),
      q ? sql`${legacyArchive.data}::text ILIKE ${`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}` : undefined
    );
    // Numeric ids sort as numbers; other keys after them
    const order = sql`CASE WHEN ${legacyArchive.rowKey} ~ '^[0-9]+$' THEN ${legacyArchive.rowKey}::bigint END DESC NULLS LAST, ${legacyArchive.rowKey}`;
    const [rows, [{ total }], [layout]] = await Promise.all([
      db.select({ rowKey: legacyArchive.rowKey, data: legacyArchive.data }).from(legacyArchive).where(where).orderBy(order).limit(limit).offset((page - 1) * limit),
      db.select({ total: count() }).from(legacyArchive).where(where),
      db.select({ data: legacyArchive.data }).from(legacyArchive).where(and(eq(legacyArchive.tableName, table), eq(legacyArchive.rowKey, COLUMNS_KEY))).limit(1),
    ]);
    // The old table's column order (stored rows don't keep it)
    const columns = layout?.data.columns?.split(',') ?? Object.keys(rows[0]?.data ?? {});
    res.json({ table, total, page, limit, columns, rows: rows.map((r) => r.data) });
  } catch (err) {
    sendError(res, err, 'Failed to load the table');
  }
});

export default router;
