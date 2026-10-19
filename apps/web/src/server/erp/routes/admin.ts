import { Router } from 'express';
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../../db/index';
import { activityLogs, companySettings, roles, users, type SettingType } from '../../db/schema';
import { isUuid } from '../../lib/http';
import { ALL_PERMISSIONS, PERMISSIONS, isSuperRole } from '../../lib/erpPermissions';
import { invalidateAuthUser } from '../../lib/auth';
import { logActivity } from '../activity';
import { erpUser, invalidateRoleCache, requirePermission, requireAnyPermission, type ErpUser } from '../context';
import { ValidationError, conflict, notFound } from '../errors';
import { Input, likePattern, meta, pageQuery, searchTerm } from '../input';
import { allSettings, flushSettings } from '../settings';
import { endOfDay, startOfDay } from '../time';

const router = Router();

// ─── Settings ────────────────────────────────────────────────────────────────

/** Setting group → permission needed to manage it */
const GROUP_PERMISSIONS: Record<string, string> = { company: 'settings.company', quotation: 'settings.quotation', tax: 'settings.quotation' };

/** Extra validation for specific keys, on top of the type rules */
const KEY_RULES: Record<string, (value: unknown) => string | null> = {
  'company.email': (value) => (!value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)) ? null : 'Enter a valid email address.'),
  'company.gstin': (value) => (String(value ?? '').length <= 15 ? null : 'A GSTIN is at most 15 characters.'),
  'quotation.number_prefix': (value) => (/^[A-Za-z0-9]{1,10}$/.test(String(value ?? '')) ? null : 'The prefix may only contain letters and numbers (max 10).'),
  'quotation.currency': (value) => (String(value ?? '').length === 3 ? null : 'Use a three-letter currency code.'),
  'tax.gst_rate': (value) => {
    const rate = Number(value);
    return Number.isFinite(rate) && rate >= 0 && rate <= 100 ? null : 'Enter a GST rate between 0 and 100.';
  },
};

function typeError(type: SettingType, value: unknown): string | null {
  switch (type) {
    case 'number':
      return value !== '' && value !== null && Number.isFinite(Number(value)) ? null : 'Enter a number.';
    case 'boolean':
      return typeof value === 'boolean' || [0, 1, '0', '1', 'true', 'false'].includes(value as never) ? null : 'Choose yes or no.';
    case 'list':
      if (!Array.isArray(value) || !value.length) return 'Add at least one value.';
      return value.every((item) => Number.isInteger(Number(item)) && Number(item) >= 1 && Number(item) <= 10000)
        ? null
        : 'Every value must be a whole number between 1 and 10000.';
    case 'text':
      return String(value ?? '').length <= 5000 ? null : 'This text is too long (max 5000 characters).';
    default:
      return String(value ?? '').length <= 255 ? null : 'This value is too long (max 255 characters).';
  }
}

function normalise(type: SettingType, value: unknown): unknown {
  switch (type) {
    case 'number':
      return Number(value);
    case 'boolean':
      return value === true || value === 1 || value === '1' || value === 'true';
    case 'list':
      return (value as unknown[]).map((item) => Number.parseInt(String(item), 10));
    default:
      return value ?? '';
  }
}

const manageableGroups = (user: ErpUser) =>
  Object.entries(GROUP_PERMISSIONS)
    .filter(([, permission]) => user.can(permission))
    .map(([group]) => group);

async function settingsIndex(user: ErpUser) {
  const groups = manageableGroups(user);
  if (!groups.length) return { data: [] };
  const rows = await db.select().from(companySettings).where(inArray(companySettings.group, groups)).orderBy(asc(companySettings.sortOrder));
  const grouped = new Map<string, { group: string; settings: unknown[] }>();
  for (const s of rows) {
    if (!grouped.has(s.group)) grouped.set(s.group, { group: s.group, settings: [] });
    grouped.get(s.group)!.settings.push({ key: s.key, label: s.label, type: s.type, description: s.description, value: s.value });
  }
  return { data: [...grouped.values()] };
}

/** Each settings group is restricted by the permission that manages it */
router.get('/admin/settings', requireAnyPermission('settings.company', 'settings.quotation'), async (req, res) => {
  res.json(await settingsIndex(erpUser(req)));
});

router.put('/admin/settings', requireAnyPermission('settings.company', 'settings.quotation'), async (req, res) => {
  const user = erpUser(req);
  const values = req.body?.values;
  if (!values || typeof values !== 'object' || Array.isArray(values) || !Object.keys(values).length) {
    throw ValidationError.of({ values: 'Send the settings to update.' });
  }

  const groups = manageableGroups(user);
  const keys = Object.keys(values);
  const known = await db.select().from(companySettings).where(and(inArray(companySettings.key, keys), inArray(companySettings.group, groups)));
  const byKey = new Map(known.map((s) => [s.key, s]));

  const errors: Record<string, string> = {};
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    const setting = byKey.get(key);
    if (!setting) {
      errors[`values.${key}`] = 'This setting does not exist or you cannot change it.';
      continue;
    }
    const error = KEY_RULES[key]?.(value) ?? typeError(setting.type, value);
    if (error) {
      errors[`values.${key}`] = error;
      continue;
    }
    // Normalise types before storing (e.g. "18" → 18, "1" → true)
    clean[key] = normalise(setting.type, value);
  }
  if (Object.keys(errors).length) throw ValidationError.of(errors);

  await db.transaction(async (tx) => {
    for (const [key, value] of Object.entries(clean)) {
      await tx.update(companySettings).set({ value: value as never, updatedAt: new Date() }).where(eq(companySettings.key, key));
    }
  });
  flushSettings();
  await allSettings();
  await logActivity(req, 'updated', 'Company settings updated', null, { keys: Object.keys(clean) });
  res.json(await settingsIndex(user));
});

// ─── Activity log ────────────────────────────────────────────────────────────

router.get('/admin/activity-logs', requirePermission('activity_logs.view'), async (req, res) => {
  const { page, perPage } = pageQuery(req.query, { perPage: 50 });
  const input = Input.from(req.query);
  const event = input.optionalString('event', { max: 50 });
  const userId = input.optionalId('user_id', 'Choose a valid user.');
  const from = input.date('from', { message: 'Enter a valid date.' });
  const to = input.date('to', { message: 'Enter a valid date.' });
  input.done();
  const search = searchTerm(req.query);

  const where = and(
    event ? eq(activityLogs.event, event) : undefined,
    userId ? eq(activityLogs.userId, userId) : undefined,
    search ? ilike(activityLogs.description, likePattern(search)) : undefined,
    from ? gte(activityLogs.createdAt, startOfDay(from.slice(0, 10))) : undefined,
    to ? lte(activityLogs.createdAt, endOfDay(to.slice(0, 10))) : undefined
  );

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ log: activityLogs, user: users.name })
      .from(activityLogs)
      .leftJoin(users, eq(users.id, activityLogs.userId))
      .where(where)
      .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db.select({ total: count() }).from(activityLogs).where(where),
  ]);

  res.json({
    data: rows.map(({ log, user }) => ({
      id: log.id,
      event: log.event,
      description: log.description,
      subject_type: log.subjectType,
      subject_id: log.subjectId,
      properties: log.properties,
      user: user ?? null,
      ip_address: log.ipAddress,
      created_at: log.createdAt.toISOString(),
    })),
    meta: meta(page, perPage, Number(total), rows.length),
  });
});

// ─── Roles and permissions ───────────────────────────────────────────────────

/** All permissions grouped by module, for the role editor */
router.get('/admin/permissions', requirePermission('roles.manage'), (_req, res) => {
  const groups = new Map<string, { module: string; permissions: unknown[] }>();
  for (const [slug, [name, module]] of Object.entries(PERMISSIONS)) {
    if (!groups.has(module)) groups.set(module, { module, permissions: [] });
    groups.get(module)!.permissions.push({ id: slug, slug, name });
  }
  res.json({ data: [...groups.values()] });
});

type RoleRow = typeof roles.$inferSelect;

async function presentRoles(rows: RoleRow[]) {
  const counts = rows.length
    ? await db
        .select({ role: users.role, n: count() })
        .from(users)
        .where(inArray(users.role, rows.map((r) => r.slug) as never[]))
        .groupBy(users.role)
    : [];
  const byRole = new Map(counts.map((c) => [c.role as string, Number(c.n)]));
  return rows.map((role) => ({
    id: role.id,
    name: role.name,
    slug: role.slug,
    description: role.description,
    is_system: role.isSystem,
    users_count: byRole.get(role.slug) ?? 0,
    // Super Admin and Management always hold every permission
    permissions: isSuperRole(role.slug) ? [...ALL_PERMISSIONS] : role.permissions.filter((slug) => slug in PERMISSIONS),
  }));
}

async function findRole(id: string): Promise<RoleRow> {
  const [role] = isUuid(id) ? await db.select().from(roles).where(eq(roles.id, id)).limit(1) : [];
  if (!role) throw notFound('Role');
  return role;
}

function parseRole(body: unknown) {
  const input = Input.from(body);
  const name = input.requiredString('name', 'The role name is required.', { max: 80 });
  const description = input.optionalString('description', { max: 255 });
  const permissions = input.raw('permissions');
  if (!Array.isArray(permissions) || !permissions.every((slug) => typeof slug === 'string')) {
    input.fail('permissions', 'Choose the permissions this role grants.');
  } else {
    if (new Set(permissions).size !== permissions.length) input.fail('permissions', 'All values must be unique.');
    // Keyed by position so the role editor can point at the offending entry
    permissions.forEach((slug, index) => {
      if (!(slug in PERMISSIONS)) input.fail(`permissions.${index}`, `"${slug}" is not a permission.`);
    });
  }
  input.done();
  return { name, description: description ?? null, permissions: permissions as string[] };
}

/** Custom role slugs are upper-case like the system roles, e.g. COORDINATION */
async function uniqueRoleSlug(name: string): Promise<string> {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'ROLE';
  let slug = base;
  for (let i = 2; (await db.select({ id: roles.id }).from(roles).where(eq(roles.slug, slug)).limit(1)).length; i++) slug = `${base}_${i}`;
  return slug;
}

router.get('/admin/roles', requirePermission('roles.manage'), async (_req, res) => {
  const rows = await db.select().from(roles).orderBy(asc(roles.createdAt), asc(roles.name));
  res.json({ data: await presentRoles(rows) });
});

router.get('/admin/roles/:id', requirePermission('roles.manage'), async (req, res) => {
  res.json({ data: (await presentRoles([await findRole((req.params.id as string))]))[0] });
});

router.post('/admin/roles', requirePermission('roles.manage'), async (req, res) => {
  const dto = parseRole(req.body);
  const [role] = await db
    .insert(roles)
    .values({ name: dto.name, slug: await uniqueRoleSlug(dto.name), description: dto.description, permissions: dto.permissions, createdBy: erpUser(req).id })
    .returning();
  invalidateRoleCache();
  await logActivity(req, 'created', `Role "${role.name}" created`, { id: role.id, type: 'Role' }, { permissions: dto.permissions });
  res.status(201).json({ data: (await presentRoles([role]))[0] });
});

router.put('/admin/roles/:id', requirePermission('roles.manage'), async (req, res) => {
  const dto = parseRole(req.body);
  const role = await findRole((req.params.id as string));
  const before = role.permissions;
  // Super Admin and Management always hold every permission
  const slugs = isSuperRole(role.slug) ? [...ALL_PERMISSIONS] : dto.permissions;

  const [updated] = await db
    .update(roles)
    .set({ name: dto.name, description: dto.description, permissions: slugs, updatedBy: erpUser(req).id, updatedAt: new Date() })
    .where(eq(roles.id, role.id))
    .returning();
  invalidateRoleCache();
  invalidateAuthUser();
  await logActivity(req, 'updated', `Role "${updated.name}" updated`, { id: role.id, type: 'Role' }, {
    granted: slugs.filter((slug) => !before.includes(slug)),
    revoked: before.filter((slug) => !slugs.includes(slug)),
  });
  res.json({ data: (await presentRoles([updated]))[0] });
});

router.delete('/admin/roles/:id', requirePermission('roles.manage'), async (req, res) => {
  const role = await findRole((req.params.id as string));
  if (role.isSystem) throw conflict('System roles cannot be deleted.');
  const [{ n }] = await db.select({ n: count() }).from(users).where(sql`${users.role} = ${role.slug}`);
  if (Number(n) > 0) throw conflict('This role is assigned to users. Reassign them before deleting it.');
  await db.delete(roles).where(eq(roles.id, role.id));
  invalidateRoleCache();
  await logActivity(req, 'deleted', `Role "${role.name}" deleted`, { id: role.id, type: 'Role' });
  res.status(204).end();
});

export default router;
