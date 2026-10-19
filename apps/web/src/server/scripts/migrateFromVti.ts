/**
 * Imports the former VTI ERP (NestJS + MongoDB) into this database: roles, users, employees,
 * departments, designations, company settings, the quotation catalog, pricing rules, quotations,
 * payments (with their screenshots) and the activity log.
 *
 *   VTI_MONGODB_URI="mongodb+srv://…/vti_erp" pnpm migrate:vti [--dry-run] [--map-roles]
 *
 * Optional: VTI_STORAGE_PATH=D:\VTI-ERP\backend\storage copies payment screenshots into the app's file storage (Cloudflare R2 when the R2_* settings are present, else STORAGE_PATH).
 *
 * Safe to re-run: records are matched on natural keys (email, employee ID, slug, code, name, quotation
 * number) and anything already imported is skipped, never duplicated. Passwords keep working: VTI's
 * bcrypt hashes are carried over as they are.
 *
 * Roles: by default each VTI role becomes its own role (VTI_ADMIN, VTI_EMPLOYEE, …) with exactly the
 * permissions it had, so nobody gains access to the CRM, project or HR screens. Super Admin maps to
 * SUPER_ADMIN. With --map-roles, VTI roles map onto the built-in roles instead
 * (admin → MANAGEMENT, manager → PROJECT_MANAGER, hr → HR, employee → TEAM_MEMBER), which also grants
 * those roles' CRM/project/HR access; review the role mapping before using it.
 */
import '../env';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { MongoClient, type Document, type ObjectId } from 'mongodb';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db, pool } from '../db/index';
import { runMigrations } from '../db/migrate';
import {
  activityLogs,
  artistLanguages,
  artistServices,
  artists,
  companySettings,
  departments,
  designations,
  durations,
  employees,
  languages,
  performers,
  pricingRules,
  quotationItems,
  quotationPayments,
  quotationSequences,
  quotations,
  roles,
  services,
  users,
  videoTypes,
  type EmployeeStatus,
  type Role,
} from '../db/schema';
import { ALL_PERMISSIONS } from '../lib/erpPermissions';
import { money } from '../erp/decimal';
import { ensureErpDefaults } from '../erp/seed/defaults';
import { forgetAll } from '../erp/cache';
import { putObject } from '../lib/storage';

const DRY_RUN = process.argv.includes('--dry-run');
const MAP_ROLES = process.argv.includes('--map-roles');

const uri = process.env.VTI_MONGODB_URI;
if (!uri) {
  console.error('Set VTI_MONGODB_URI to the VTI ERP MongoDB connection string (the MONGODB_URI from VTI-ERP/backend/.env).');
  process.exit(1);
}

const stats: Record<string, { imported: number; matched: number; skipped: number }> = {};
const tally = (name: string, kind: 'imported' | 'matched' | 'skipped') => {
  stats[name] ??= { imported: 0, matched: 0, skipped: 0 };
  stats[name][kind]++;
};

const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const key = (value: unknown): string => String(value);
const dec = (value: unknown): string | null => (value === null || value === undefined ? null : money(String(value)));
const date = (value: unknown): Date | null => (value instanceof Date ? value : value ? new Date(String(value)) : null);
const dayString = (value: unknown): string | null => {
  const d = date(value);
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
};

/** Insert a row, or pretend to in a dry run (returning a placeholder id so mappings still resolve) */
async function insert<T extends { id: string }>(label: string, run: () => Promise<T[]>): Promise<string> {
  tally(label, 'imported');
  if (DRY_RUN) return `dry-run-${label}-${stats[label].imported}`;
  const [row] = await run();
  return row.id;
}

const SYSTEM_ROLE_MAP: Record<string, string> = MAP_ROLES
  ? { 'super-admin': 'SUPER_ADMIN', admin: 'MANAGEMENT', manager: 'PROJECT_MANAGER', hr: 'HR', employee: 'TEAM_MEMBER' }
  : { 'super-admin': 'SUPER_ADMIN' };

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const mongo = client.db();
  const all = (name: string, filter: Document = {}) => mongo.collection(name).find(filter).toArray();
  console.log(`Connected to MongoDB database "${mongo.databaseName}"${DRY_RUN ? ' (dry run: nothing will be written)' : ''}`);

  await runMigrations();
  await ensureErpDefaults();

  // ── Roles ────────────────────────────────────────────────────────────────
  const permissionSlugs = new Map((await all('permissions')).map((p) => [key(p._id), String(p.slug)]));
  const roleSlugById = new Map<string, string>();
  for (const role of await all('roles')) {
    const vtiSlug = String(role.slug);
    const granted = ((role.permissions ?? []) as ObjectId[]).map((id) => permissionSlugs.get(key(id))).filter((s): s is string => !!s && ALL_PERMISSIONS.includes(s));
    const target = SYSTEM_ROLE_MAP[vtiSlug] ?? `VTI_${vtiSlug.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
    roleSlugById.set(key(role._id), target);

    const [existing] = await db.select().from(roles).where(eq(roles.slug, target)).limit(1);
    if (existing) {
      tally('roles', 'matched');
      if (!DRY_RUN && target !== 'SUPER_ADMIN') {
        const merged = [...new Set([...existing.permissions, ...granted])];
        await db.update(roles).set({ permissions: merged }).where(eq(roles.id, existing.id));
      }
      continue;
    }
    await insert('roles', () =>
      db
        .insert(roles)
        .values({ slug: target, name: `${role.name} (VTI)`, description: str(role.description) ?? 'Imported from VTI ERP', permissions: granted, isSystem: false })
        .returning({ id: roles.id })
    );
  }

  // ── Departments and designations ─────────────────────────────────────────
  const departmentIds = new Map<string, string>();
  for (const d of await all('departments')) {
    const [match] = await db.select({ id: departments.id }).from(departments).where(sql`lower(${departments.name}) = ${String(d.name).toLowerCase()}`).limit(1);
    if (match) {
      tally('departments', 'matched');
      departmentIds.set(key(d._id), match.id);
      continue;
    }
    const [codeClash] = d.code ? await db.select({ id: departments.id }).from(departments).where(eq(departments.code, String(d.code))).limit(1) : [];
    departmentIds.set(
      key(d._id),
      await insert('departments', () =>
        db
          .insert(departments)
          .values({ name: String(d.name), code: codeClash ? null : str(d.code), description: str(d.description), active: d.is_active !== false, createdAt: date(d.created_at) ?? undefined })
          .returning({ id: departments.id })
      )
    );
  }

  const designationIds = new Map<string, string>();
  for (const d of await all('designations')) {
    const [match] = await db.select({ id: designations.id }).from(designations).where(sql`lower(${designations.name}) = ${String(d.name).toLowerCase()}`).limit(1);
    if (match) {
      tally('designations', 'matched');
      designationIds.set(key(d._id), match.id);
      continue;
    }
    designationIds.set(
      key(d._id),
      await insert('designations', () =>
        db
          .insert(designations)
          .values({ name: String(d.name), description: str(d.description), active: d.is_active !== false, createdAt: date(d.created_at) ?? undefined })
          .returning({ id: designations.id })
      )
    );
  }

  // ── Users and employees ──────────────────────────────────────────────────
  const vtiEmployees = await all('employees');
  const employeeByUser = new Map(vtiEmployees.filter((e) => e.user).map((e) => [key(e.user), e]));

  async function freeUsername(base: string): Promise<string> {
    const clean = base.toLowerCase().replace(/[^a-z0-9_.-]+/g, '') || 'user';
    let candidate = clean;
    for (let i = 2; (await db.select({ id: users.id }).from(users).where(eq(users.username, candidate)).limit(1)).length; i++) candidate = `${clean}-${i}`;
    return candidate;
  }

  const userIds = new Map<string, string>();
  for (const u of await all('users')) {
    const email = str(u.email)?.toLowerCase() ?? null;
    const employee = employeeByUser.get(key(u._id));
    const code = str(employee?.employee_code);

    const [byEmail] = email ? await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1) : [];
    const [byCode] =
      !byEmail && code
        ? await db.select({ id: users.id }).from(users).innerJoin(employees, eq(employees.userId, users.id)).where(sql`lower(${employees.employeeCode}) = ${code.toLowerCase()}`).limit(1)
        : [];
    const match = byEmail ?? byCode;
    if (match) {
      tally('users', 'matched');
      userIds.set(key(u._id), match.id);
      continue;
    }

    const name = String(u.name);
    userIds.set(
      key(u._id),
      await insert('users', async () =>
        db
          .insert(users)
          .values({
            name,
            email,
            username: await freeUsername(code ?? email?.split('@')[0] ?? name),
            // bcrypt hashes are portable, so every password keeps working
            passwordHash: String(u.password),
            role: (roleSlugById.get(key(u.role)) ?? 'TEAM_MEMBER') as Role,
            isActive: u.is_active !== false && !u.deleted_at,
            lastLoginAt: date(u.last_login_at),
            tokensValidFrom: date(u.tokens_valid_from),
            initials: name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase(),
            createdAt: date(u.created_at) ?? undefined,
          })
          .returning({ id: users.id })
      )
    );
  }

  const employeeIds = new Map<string, string>();
  for (const e of vtiEmployees) {
    const code = String(e.employee_code);
    const [match] = await db.select({ id: employees.id, userId: employees.userId }).from(employees).where(sql`lower(${employees.employeeCode}) = ${code.toLowerCase()}`).limit(1);
    const userId = e.user ? (userIds.get(key(e.user)) ?? null) : null;
    if (match) {
      tally('employees', 'matched');
      employeeIds.set(key(e._id), match.id);
      if (!DRY_RUN && !match.userId && userId && !userId.startsWith('dry-run')) {
        await db.update(employees).set({ userId }).where(eq(employees.id, match.id));
      }
      continue;
    }
    if (e.deleted_at) {
      tally('employees', 'skipped');
      continue;
    }
    const status = (['active', 'inactive', 'on_leave', 'terminated'].includes(e.status) ? e.status : 'active') as EmployeeStatus;
    employeeIds.set(
      key(e._id),
      await insert('employees', () =>
        db
          .insert(employees)
          .values({
            employeeCode: code,
            name: `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || code,
            email: str(e.email),
            phone: str(e.phone),
            departmentId: e.department ? (departmentIds.get(key(e.department)) ?? null) : null,
            designationId: e.designation ? (designationIds.get(key(e.designation)) ?? null) : null,
            joiningDate: dayString(e.date_of_joining),
            status,
            userId,
            createdAt: date(e.created_at) ?? undefined,
          })
          .returning({ id: employees.id })
      )
    );
  }

  // ── Company settings (VTI's values win) ──────────────────────────────────
  for (const s of await all('company_settings')) {
    const [match] = await db.select({ id: companySettings.id }).from(companySettings).where(eq(companySettings.key, String(s.key))).limit(1);
    if (!match) {
      tally('settings', 'skipped');
      continue;
    }
    tally('settings', 'imported');
    if (!DRY_RUN) await db.update(companySettings).set({ value: s.value as never }).where(eq(companySettings.id, match.id));
  }

  // ── Catalog ──────────────────────────────────────────────────────────────
  const serviceIds = new Map<string, string>();
  for (const s of await all('services')) {
    const slug = String(s.slug);
    const status = String(s.status ?? 'active');
    const quotationColumns = {
      description: str(s.description),
      fields: (s.fields ?? []) as never,
      artistRestricted: !!s.artist_restricted,
      sortOrder: Number(s.sort_order ?? 0),
      active: status !== 'inactive',
      comingSoon: status === 'coming_soon',
    };
    const [match] = await db
      .select({ id: services.id })
      .from(services)
      .where(sql`${services.slug} = ${slug} OR lower(${services.name}) = ${String(s.name).toLowerCase()}`)
      .limit(1);
    if (match) {
      tally('services', 'matched');
      serviceIds.set(key(s._id), match.id);
      if (!DRY_RUN) await db.update(services).set({ ...quotationColumns, slug }).where(eq(services.id, match.id));
      continue;
    }
    serviceIds.set(key(s._id), await insert('services', () => db.insert(services).values({ name: String(s.name), slug, ...quotationColumns }).returning({ id: services.id })));
  }

  const languageIds = new Map<string, string>();
  for (const l of await all('languages')) {
    const values = { name: String(l.name), active: l.is_active !== false, sortOrder: Number(l.sort_order ?? 0) };
    const [match] = await db.select({ id: languages.id }).from(languages).where(sql`lower(${languages.name}) = ${values.name.toLowerCase()}`).limit(1);
    if (match) {
      tally('languages', 'matched');
      languageIds.set(key(l._id), match.id);
      if (!DRY_RUN) await db.update(languages).set(values).where(eq(languages.id, match.id));
      continue;
    }
    const [codeClash] = l.code ? await db.select({ id: languages.id }).from(languages).where(eq(languages.code, String(l.code))).limit(1) : [];
    languageIds.set(key(l._id), await insert('languages', () => db.insert(languages).values({ ...values, code: codeClash ? null : str(l.code) }).returning({ id: languages.id })));
  }

  const videoTypeIds = new Map<string, string>();
  for (const v of await all('video_types')) {
    const values = {
      name: String(v.name),
      description: str(v.description),
      requiresPerformer: !!v.requires_performer,
      customPrice: !!v.custom_price,
      active: v.is_active !== false,
      sortOrder: Number(v.sort_order ?? 0),
    };
    const [match] = await db.select({ id: videoTypes.id }).from(videoTypes).where(sql`lower(${videoTypes.name}) = ${values.name.toLowerCase()}`).limit(1);
    if (match) {
      tally('video types', 'matched');
      videoTypeIds.set(key(v._id), match.id);
      if (!DRY_RUN) await db.update(videoTypes).set(values).where(eq(videoTypes.id, match.id));
      continue;
    }
    videoTypeIds.set(key(v._id), await insert('video types', () => db.insert(videoTypes).values(values).returning({ id: videoTypes.id })));
  }

  const durationIds = new Map<string, string>();
  for (const d of await all('durations')) {
    const minutes = dec(d.minutes)!;
    const values = { label: String(d.label), active: d.is_active !== false, sortOrder: Number(d.sort_order ?? 0) };
    const [match] = await db.select({ id: durations.id }).from(durations).where(eq(durations.minutes, minutes)).limit(1);
    if (match) {
      tally('durations', 'matched');
      durationIds.set(key(d._id), match.id);
      if (!DRY_RUN) await db.update(durations).set(values).where(eq(durations.id, match.id));
      continue;
    }
    durationIds.set(key(d._id), await insert('durations', () => db.insert(durations).values({ ...values, minutes }).returning({ id: durations.id })));
  }

  const performerIds = new Map<string, string>();
  for (const p of await all('performers')) {
    const values = { code: String(p.code), name: String(p.name), active: p.is_active !== false, sortOrder: Number(p.sort_order ?? 0) };
    const [match] = await db.select({ id: performers.id }).from(performers).where(eq(performers.code, values.code)).limit(1);
    if (match) {
      tally('performers', 'matched');
      performerIds.set(key(p._id), match.id);
      if (!DRY_RUN) await db.update(performers).set(values).where(eq(performers.id, match.id));
      continue;
    }
    performerIds.set(key(p._id), await insert('performers', () => db.insert(performers).values(values).returning({ id: performers.id })));
  }

  const artistIds = new Map<string, string>();
  for (const a of await all('artists')) {
    const values = {
      code: String(a.code),
      name: String(a.name),
      gender: (str(a.gender) as 'male' | 'female' | 'other' | null) ?? null,
      email: str(a.email),
      phone: str(a.phone),
      employeeId: a.employee ? (employeeIds.get(key(a.employee)) ?? null) : null,
      notes: str(a.notes),
      active: a.is_active !== false,
      deletedAt: date(a.deleted_at),
    };
    const [match] = await db.select({ id: artists.id }).from(artists).where(eq(artists.code, values.code)).limit(1);
    let id: string;
    if (match) {
      tally('artists', 'matched');
      id = match.id;
      if (!DRY_RUN) await db.update(artists).set({ ...values, employeeId: values.employeeId?.startsWith('dry-run') ? null : values.employeeId }).where(eq(artists.id, id));
    } else {
      id = await insert('artists', () => db.insert(artists).values({ ...values, createdAt: date(a.created_at) ?? undefined }).returning({ id: artists.id }));
    }
    artistIds.set(key(a._id), id);
    if (DRY_RUN) continue;
    const linkedServices = ((a.services ?? []) as ObjectId[]).map((s) => serviceIds.get(key(s))).filter((s): s is string => !!s);
    const linkedLanguages = ((a.languages ?? []) as ObjectId[]).map((l) => languageIds.get(key(l))).filter((l): l is string => !!l);
    if (linkedServices.length) await db.insert(artistServices).values(linkedServices.map((serviceId) => ({ artistId: id, serviceId }))).onConflictDoNothing();
    if (linkedLanguages.length) await db.insert(artistLanguages).values(linkedLanguages.map((languageId) => ({ artistId: id, languageId }))).onConflictDoNothing();
  }

  const ref = (map: Map<string, string>, value: unknown) => (value ? (map.get(key(value)) ?? null) : null);
  const matchNullable = (column: AnyPgColumn, value: string | null) => (value === null ? isNull(column) : eq(column, value));

  const ruleIds = new Map<string, string>();
  for (const r of await all('pricing_rules')) {
    const values = {
      name: str(r.name),
      serviceId: ref(serviceIds, r.service)!,
      artistId: ref(artistIds, r.artist),
      languageId: ref(languageIds, r.language),
      sourceLanguageId: ref(languageIds, r.source_language),
      videoTypeId: ref(videoTypeIds, r.video_type),
      performerId: ref(performerIds, r.performer),
      unit: String(r.unit ?? 'per_minute') as 'per_minute' | 'per_second' | 'per_unit',
      basePrice: dec(r.base_price)!,
      costPrice: dec(r.cost_price),
      minQuantity: Number(r.min_quantity ?? 1),
      minDurationMinutes: dec(r.min_duration_minutes),
      maxDurationMinutes: dec(r.max_duration_minutes),
      effectiveFrom: str(r.effective_from),
      effectiveTo: str(r.effective_to),
      priority: Number(r.priority ?? 0),
      active: r.is_active !== false,
      notes: str(r.notes),
      createdBy: ref(userIds, r.created_by),
    };
    if (!values.serviceId) {
      tally('pricing rules', 'skipped');
      continue;
    }
    // A rule narrowing on exactly the same things is the same rule: its price is brought up to date
    const [match] = DRY_RUN
      ? []
      : await db
          .select({ id: pricingRules.id })
          .from(pricingRules)
          .where(
            and(
              eq(pricingRules.serviceId, values.serviceId),
              matchNullable(pricingRules.artistId, values.artistId),
              matchNullable(pricingRules.languageId, values.languageId),
              matchNullable(pricingRules.sourceLanguageId, values.sourceLanguageId),
              matchNullable(pricingRules.videoTypeId, values.videoTypeId),
              matchNullable(pricingRules.performerId, values.performerId),
              eq(pricingRules.minQuantity, values.minQuantity),
              values.minDurationMinutes === null ? isNull(pricingRules.minDurationMinutes) : eq(pricingRules.minDurationMinutes, values.minDurationMinutes),
              values.maxDurationMinutes === null ? isNull(pricingRules.maxDurationMinutes) : eq(pricingRules.maxDurationMinutes, values.maxDurationMinutes),
              values.effectiveFrom === null ? isNull(pricingRules.effectiveFrom) : eq(pricingRules.effectiveFrom, values.effectiveFrom),
              values.effectiveTo === null ? isNull(pricingRules.effectiveTo) : eq(pricingRules.effectiveTo, values.effectiveTo),
              eq(pricingRules.priority, values.priority)
            )
          )
          .limit(1);
    if (match) {
      tally('pricing rules', 'matched');
      ruleIds.set(key(r._id), match.id);
      await db.update(pricingRules).set(values).where(eq(pricingRules.id, match.id));
      continue;
    }
    ruleIds.set(key(r._id), await insert('pricing rules', () => db.insert(pricingRules).values({ ...values, createdAt: date(r.created_at) ?? undefined }).returning({ id: pricingRules.id })));
  }

  // ── Quotations, lines and payments ───────────────────────────────────────
  const storageFrom = process.env.VTI_STORAGE_PATH ? resolve(process.env.VTI_STORAGE_PATH) : null;
  const vtiItems = await all('quotation_items');
  const vtiPayments = await all('payments');

  for (const q of await all('quotations')) {
    const number = str(q.quotation_number);
    const [match] = number ? await db.select({ id: quotations.id }).from(quotations).where(eq(quotations.quotationNumber, number)).limit(1) : [];
    if (match) {
      tally('quotations', 'matched');
      continue;
    }

    const quotationId = await insert('quotations', () =>
      db
        .insert(quotations)
        .values({
          quotationNumber: number,
          status: q.status,
          subject: str(q.subject),
          details: str(q.details),
          clientName: String(q.client_name),
          clientCompany: str(q.client_company),
          clientEmail: str(q.client_email),
          clientPhone: str(q.client_phone),
          clientGstin: str(q.client_gstin),
          clientAddress: str(q.client_address),
          scope: str(q.scope),
          includedServices: str(q.included_services),
          terms: str(q.terms),
          preparedByName: str(q.prepared_by_name),
          preparedByPhone: str(q.prepared_by_phone),
          externalReference: str(q.external_reference),
          currency: String(q.currency ?? 'INR'),
          subtotal: dec(q.subtotal) ?? '0.00',
          includeGst: q.include_gst !== false,
          taxRate: dec(q.tax_rate) ?? '0.00',
          taxAmount: dec(q.tax_amount) ?? '0.00',
          grandTotal: dec(q.grand_total) ?? '0.00',
          notes: str(q.notes),
          validity: q.validity ?? '15_days',
          validityDays: q.validity_days ?? null,
          validUntil: dayString(q.valid_until),
          createdBy: ref(userIds, q.created_by),
          updatedBy: ref(userIds, q.updated_by),
          amountPaid: dec(q.amount_paid) ?? '0.00',
          paymentCompletedAt: date(q.payment_completed_at),
          paymentCompletedBy: ref(userIds, q.payment_completed_by),
          deletedAt: date(q.deleted_at),
          createdAt: date(q.created_at) ?? undefined,
          updatedAt: date(q.updated_at) ?? undefined,
        })
        .returning({ id: quotations.id })
    );
    if (DRY_RUN) continue;

    const lines = vtiItems.filter((item) => key(item.quotation) === key(q._id)).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
    for (const [order, item] of lines.entries()) {
      tally('quotation lines', 'imported');
      await db.insert(quotationItems).values({
        quotationId,
        serviceId: ref(serviceIds, item.service)!,
        artistId: ref(artistIds, item.artist),
        videoTypeId: ref(videoTypeIds, item.video_type),
        performerId: ref(performerIds, item.performer),
        languageId: ref(languageIds, item.language),
        sourceLanguageId: ref(languageIds, item.source_language),
        durationId: ref(durationIds, item.duration),
        pricingRuleId: ref(ruleIds, item.pricing_rule),
        durationMinutes: dec(item.duration_minutes) ?? '0.00',
        quantity: Number(item.quantity ?? 1),
        unit: item.unit ?? 'per_minute',
        unitPrice: dec(item.unit_price) ?? '0.00',
        isCustomPrice: !!item.is_custom_price,
        basePrice: dec(item.base_price),
        lineTotal: dec(item.line_total) ?? '0.00',
        description: String(item.description ?? ''),
        snapshot: remapSnapshot(item.snapshot, { serviceIds, artistIds, languageIds, videoTypeIds, performerIds }),
        sortOrder: order,
      });
    }

    for (const p of vtiPayments.filter((payment) => key(payment.quotation) === key(q._id))) {
      if (p.attachment && storageFrom) {
        const source = join(storageFrom, p.attachment.file);
        if (existsSync(source)) {
          // Same storage the app serves from: Cloudflare R2 when configured, else STORAGE_PATH
          await putObject(p.attachment.file, await readFile(source), p.attachment.mime || 'application/octet-stream');
          tally('payment screenshots', 'imported');
        } else {
          tally('payment screenshots', 'skipped');
        }
      }
      tally('payments', 'imported');
      await db.insert(quotationPayments).values({
        quotationId,
        amount: dec(p.amount)!,
        receivedBy: p.received_by,
        method: p.method,
        methodDetail: str(p.method_detail),
        paidOn: String(p.paid_on),
        reference: str(p.reference),
        notes: str(p.notes),
        attachment: p.attachment ?? null,
        recordedBy: ref(userIds, p.recorded_by),
        createdAt: date(p.created_at) ?? undefined,
        updatedAt: date(p.updated_at) ?? undefined,
      });
    }
  }

  // Numbering continues where VTI left off
  for (const s of await all('quotation_sequences')) {
    tally('quotation sequences', 'imported');
    if (DRY_RUN) continue;
    await db
      .insert(quotationSequences)
      .values({ date: String(s.date), lastNumber: Number(s.last_number) })
      .onConflictDoUpdate({ target: quotationSequences.date, set: { lastNumber: sql`greatest(${quotationSequences.lastNumber}, ${Number(s.last_number)})` } });
  }

  // ── Activity log ─────────────────────────────────────────────────────────
  const subjectMaps: Record<string, Map<string, string>> = { User: userIds, Employee: employeeIds, Artist: artistIds, Service: serviceIds, Language: languageIds };
  for (const log of await all('activity_logs')) {
    const createdAt = date(log.created_at) ?? new Date();
    const userId = ref(userIds, log.user);
    const [match] = DRY_RUN
      ? []
      : await db
          .select({ id: activityLogs.id })
          .from(activityLogs)
          .where(and(eq(activityLogs.createdAt, createdAt), eq(activityLogs.event, String(log.event)), eq(activityLogs.description, String(log.description))))
          .limit(1);
    if (match) {
      tally('activity log', 'matched');
      continue;
    }
    const subjectId = log.subject_id ? (subjectMaps[String(log.subject_type)]?.get(key(log.subject_id)) ?? key(log.subject_id)) : null;
    await insert('activity log', () =>
      db
        .insert(activityLogs)
        .values({
          userId,
          event: String(log.event),
          subjectType: str(log.subject_type),
          subjectId,
          description: String(log.description),
          properties: log.properties ?? null,
          ipAddress: str(log.ip_address),
          userAgent: str(log.user_agent),
          createdAt,
        })
        .returning({ id: activityLogs.id })
    );
  }

  await client.close();
  forgetAll();

  console.table(Object.fromEntries(Object.entries(stats).map(([name, s]) => [name, s])));
  if (DRY_RUN) console.log('Dry run finished: nothing was written.');
  else console.log('Import finished. Quotation links to catalog records were remapped; lines keep the names they were priced with.');
}

/** Line snapshots carry the ids of the records they name; point them at the imported records */
function remapSnapshot(
  snapshot: Document | null | undefined,
  maps: Record<'serviceIds' | 'artistIds' | 'languageIds' | 'videoTypeIds' | 'performerIds', Map<string, string>>
) {
  if (!snapshot) return null;
  const remap = <T extends { id: string } | null | undefined>(value: T, map: Map<string, string>) => (value ? { ...value, id: map.get(key(value.id)) ?? key(value.id) } : null);
  return {
    service: remap(snapshot.service, maps.serviceIds)!,
    artist: remap(snapshot.artist, maps.artistIds),
    language: remap(snapshot.language, maps.languageIds),
    source_language: remap(snapshot.source_language, maps.languageIds),
    video_type: remap(snapshot.video_type, maps.videoTypeIds),
    performer: remap(snapshot.performer, maps.performerIds),
    duration_label: String(snapshot.duration_label ?? ''),
  } as never;
}

main()
  .catch((err) => {
    console.error('Import failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
