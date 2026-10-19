import { Router, type RequestHandler } from 'express';
import { asc, eq, isNull, isNotNull } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { db } from '../db/index';
import { categories, departments, designations, divisions, services } from '../db/schema';
import { authMiddleware } from '../lib/auth';
import { CRM_ADMIN_ROLES, HR_ROLES, requireCrmAdmin, requireHr } from '../lib/crm';
import { pickColumns, sendError, uuidParam } from '../lib/http';
import { roleOrPermission } from '../erp/access';
import { flushLookups } from '../erp/cache';
import { slugify } from '../erp/catalog';

const router = Router();
router.use(authMiddleware);
router.param('id', uuidParam);

/**
 * Registers list/create/update/delete for a simple master table.
 * Reads are open to any signed-in user (pickers need them); writes need the given guard.
 */
function crud<T extends PgTable & { id: never; name: never }>(
  path: string,
  table: T,
  fields: readonly string[],
  writeGuard: RequestHandler,
  label: string,
  listWhere?: (query: Record<string, unknown>) => ReturnType<typeof eq> | undefined,
  hooks: { beforeCreate?: (values: Record<string, unknown>) => Promise<Record<string, unknown>>; afterWrite?: () => void } = {}
) {
  const t = table as unknown as PgTable & { id: typeof services.id; name: typeof services.name };

  router.get(path, async (req, res) => {
    try {
      const rows = await db
        .select()
        .from(t)
        .where(listWhere?.(req.query))
        .orderBy(asc(t.name));
      res.json(rows);
    } catch (err) {
      sendError(res, err, `Failed to fetch ${label}`);
    }
  });

  router.post(path, writeGuard, async (req, res) => {
    try {
      let values = pickColumns(t, req.body, fields as never[]) as Record<string, unknown>;
      if (typeof values.name !== 'string' || !values.name.trim()) return res.status(400).json({ message: 'Name is required' });
      values.name = values.name.trim();
      if (hooks.beforeCreate) values = await hooks.beforeCreate(values);
      const [row] = await db.insert(t).values(values as never).returning();
      hooks.afterWrite?.();
      res.status(201).json(row);
    } catch (err) {
      sendError(res, err, `Failed to create ${label}`);
    }
  });

  router.patch(`${path}/:id`, writeGuard, async (req, res) => {
    try {
      const values = pickColumns(t, req.body, fields as never[]) as Record<string, unknown>;
      if (typeof values.name === 'string') values.name = values.name.trim();
      const [row] = await db
        .update(t)
        .set({ ...values, updatedAt: new Date() } as never)
        .where(eq(t.id, req.params.id as string))
        .returning();
      if (!row) return res.status(404).json({ message: `${label} not found` });
      hooks.afterWrite?.();
      res.json(row);
    } catch (err) {
      sendError(res, err, `Failed to update ${label}`);
    }
  });

  router.delete(`${path}/:id`, writeGuard, async (req, res) => {
    try {
      const [row] = await db.delete(t).where(eq(t.id, req.params.id as string)).returning({ id: t.id });
      if (!row) return res.status(404).json({ message: `${label} not found` });
      hooks.afterWrite?.();
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err, `Failed to delete ${label}`);
    }
  });
}

/** A slug that no other service uses (the quotation catalog keys services by slug) */
async function withServiceSlug(values: Record<string, unknown>) {
  const base = slugify(String(values.name)) || 'service';
  let slug = base;
  for (let i = 2; (await db.select({ id: services.id }).from(services).where(eq(services.slug, slug)).limit(1)).length; i++) slug = `${base}-${i}`;
  return { ...values, slug };
}

crud(
  '/services',
  services as never,
  ['name', 'categoryId', 'subCategoryId', 'price', 'active', 'description', 'sortOrder'],
  roleOrPermission(CRM_ADMIN_ROLES, 'services.manage'),
  'service',
  undefined,
  { beforeCreate: withServiceSlug, afterWrite: flushLookups }
);
crud('/divisions', divisions as never, ['name', 'description', 'active'], requireHr, 'division');
crud(
  '/departments',
  departments as never,
  ['name', 'code', 'divisionId', 'description', 'active'],
  roleOrPermission(HR_ROLES, 'departments.manage'),
  'department',
  (q) => (typeof q.divisionId === 'string' && q.divisionId ? eq(departments.divisionId, q.divisionId) : undefined)
);
crud('/designations', designations as never, ['name', 'description', 'active'], roleOrPermission(HR_ROLES, 'designations.manage'), 'designation');
// ?level=main → main categories, ?level=sub → sub categories, ?parentId= → subs of one main category
crud('/categories', categories as never, ['name', 'parentId', 'active'], requireCrmAdmin, 'category', (q) =>
  typeof q.parentId === 'string' && q.parentId
    ? eq(categories.parentId, q.parentId)
    : q.level === 'main'
      ? (isNull(categories.parentId) as ReturnType<typeof eq>)
      : q.level === 'sub'
        ? (isNotNull(categories.parentId) as ReturnType<typeof eq>)
        : undefined
);

export default router;
