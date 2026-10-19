import { Router } from 'express';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { db } from '../../db/index';
import {
  ARTIST_GENDERS,
  PRICING_UNITS,
  SERVICE_FIELDS,
  artistLanguages,
  artistServices,
  artists,
  durations,
  employees,
  languages,
  performers,
  pricingRules,
  services,
  videoTypes,
} from '../../db/schema';
import { isUuid } from '../../lib/http';
import { changes, logActivity } from '../activity';
import { flushLookups } from '../cache';
import { SERVICE_STATUSES, isQuotable, quotationFields, restrictsArtistSelection, serviceStatus, slugify, statusColumns } from '../catalog';
import { erpUser, requirePermission } from '../context';
import { money, moneyOrNull } from '../decimal';
import { ValidationError, conflict, isInUse, notFound } from '../errors';
import { Input, likePattern, meta, pageQuery, searchTerm, toBool } from '../input';

const router = Router();

type Row = Record<string, unknown> & { id: string };

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : null);

function sortOrder(input: Input): number | undefined {
  return input.number('sort_order', { integer: true, min: 0, max: 65535, message: 'The sort order must be a whole number.' }) ?? undefined;
}

function activeFlag(input: Input): { active?: boolean } {
  const value = input.bool('is_active');
  return value === undefined ? {} : { active: value };
}

/** Drops keys whose value is undefined (fields the request left out keep their current value) */
function defined<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}

interface MasterConfig {
  path: string;
  permission: string;
  label: string;
  table: PgTable & { id: PgColumn; active: PgColumn };
  searchable: PgColumn[];
  orderBy: SQL[];
  parse: (body: unknown) => Record<string, unknown>;
  present: (row: Row) => Row | Promise<Row>;
  nameOf: (row: Row) => string;
  beforeCreate?: (values: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

/**
 * List (search, is_active, pagination), show, create, update and delete for a lookup table. A record
 * still referenced elsewhere (a quotation line, a pricing rule, an artist) cannot be deleted.
 */
function master(config: MasterConfig) {
  const { path, table, label } = config;
  const guard = requirePermission(config.permission);

  async function find(id: string): Promise<Row> {
    const [row] = isUuid(id) ? await db.select().from(table).where(eq(table.id, id)).limit(1) : [];
    if (!row) throw notFound(label);
    return row as Row;
  }

  router.get(path, guard, async (req, res) => {
    const { page, perPage } = pageQuery(req.query, { perPage: 25 });
    const search = searchTerm(req.query);
    const active = toBool(req.query.is_active);
    const where = and(
      search ? or(...config.searchable.map((column) => ilike(column, likePattern(search)))) : undefined,
      active === undefined ? undefined : eq(table.active, active)
    );
    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(table)
        .where(where)
        .orderBy(...config.orderBy)
        .limit(perPage)
        .offset((page - 1) * perPage),
      db.select({ total: count() }).from(table).where(where),
    ]);
    res.json({ data: await Promise.all((rows as Row[]).map(config.present)), meta: meta(page, perPage, Number(total), rows.length) });
  });

  router.get(`${path}/:id`, guard, async (req, res) => {
    res.json({ data: await config.present(await find((req.params.id as string))) });
  });

  router.post(path, guard, async (req, res) => {
    let values = config.parse(req.body);
    if (config.beforeCreate) values = await config.beforeCreate(values);
    const [row] = (await db.insert(table).values(values as never).returning()) as Row[];
    flushLookups();
    await logActivity(req, 'created', `${label} "${config.nameOf(row)}" created`, { id: row.id, type: label });
    res.status(201).json({ data: await config.present(row) });
  });

  router.put(`${path}/:id`, guard, async (req, res) => {
    const before = await find((req.params.id as string));
    const values = config.parse(req.body);
    const [row] = (await db
      .update(table)
      .set({ ...values, updatedAt: new Date() } as never)
      .where(eq(table.id, before.id))
      .returning()) as Row[];
    flushLookups();
    const diff = changes(before, row);
    if (Object.keys(diff.new).length) {
      await logActivity(req, 'updated', `${label} "${config.nameOf(row)}" updated`, { id: row.id, type: label }, diff);
    }
    res.json({ data: await config.present(row) });
  });

  router.delete(`${path}/:id`, guard, async (req, res) => {
    const row = await find((req.params.id as string));
    try {
      await db.delete(table).where(eq(table.id, row.id));
    } catch (err) {
      if (isInUse(err)) throw conflict(`This ${label.toLowerCase()} is in use and cannot be deleted. Deactivate it instead.`);
      throw err;
    }
    flushLookups();
    await logActivity(req, 'deleted', `${label} "${config.nameOf(row)}" deleted`, { id: row.id, type: label });
    res.status(204).end();
  });
}

const timestamps = (row: Row) => ({ created_at: iso(row.createdAt), updated_at: iso(row.updatedAt) });

// ─── Languages, video types, durations, performers ──────────────────────────

master({
  path: '/admin/languages',
  permission: 'languages.manage',
  label: 'Language',
  table: languages,
  searchable: [languages.name, languages.code],
  orderBy: [asc(languages.sortOrder), asc(languages.name)],
  parse: (body) => {
    const input = Input.from(body);
    const values = defined({
      name: input.requiredString('name', 'The language name is required.', { max: 60 }),
      code: input.optionalString('code', { max: 10 }),
      ...activeFlag(input),
      sortOrder: sortOrder(input),
    });
    input.done();
    return values;
  },
  present: (row) => ({ id: row.id, name: row.name, code: row.code, is_active: row.active, sort_order: row.sortOrder, ...timestamps(row) }),
  nameOf: (row) => String(row.name),
});

master({
  path: '/admin/video-types',
  permission: 'video_types.manage',
  label: 'Video type',
  table: videoTypes,
  searchable: [videoTypes.name],
  orderBy: [asc(videoTypes.sortOrder), asc(videoTypes.name)],
  parse: (body) => {
    const input = Input.from(body);
    const values = defined({
      name: input.requiredString('name', 'The video type name is required.', { max: 100 }),
      description: input.optionalString('description', { max: 255, raw: true }),
      requiresPerformer: input.bool('requires_performer'),
      customPrice: input.bool('custom_price'),
      ...activeFlag(input),
      sortOrder: sortOrder(input),
    });
    input.done();
    return values;
  },
  present: (row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    requires_performer: row.requiresPerformer,
    custom_price: row.customPrice,
    is_active: row.active,
    sort_order: row.sortOrder,
    ...timestamps(row),
  }),
  nameOf: (row) => String(row.name),
});

master({
  path: '/admin/durations',
  permission: 'durations.manage',
  label: 'Duration',
  table: durations,
  searchable: [durations.label],
  orderBy: [asc(durations.sortOrder), asc(durations.minutes)],
  parse: (body) => {
    const input = Input.from(body);
    const minutes = input.number('minutes', {
      required: true,
      decimals: 2,
      min: 0.01,
      max: 10000,
      message: 'Enter the duration in minutes.',
      minMessage: 'The duration must be greater than zero.',
    });
    const values = defined({
      label: input.requiredString('label', 'The duration label is required.', { max: 50 }),
      minutes: minutes === undefined || minutes === null ? undefined : money(minutes),
      ...activeFlag(input),
      sortOrder: sortOrder(input),
    });
    input.done();
    return values;
  },
  present: (row) => ({ id: row.id, label: row.label, minutes: money(row.minutes), is_active: row.active, sort_order: row.sortOrder, ...timestamps(row) }),
  nameOf: (row) => String(row.label),
});

// Performers are talent, so they are managed by whoever manages artists
master({
  path: '/admin/performers',
  permission: 'artists.manage',
  label: 'Performer',
  table: performers,
  searchable: [performers.code, performers.name],
  orderBy: [asc(performers.sortOrder), asc(performers.code)],
  parse: (body) => {
    const input = Input.from(body);
    const values = defined({
      code: input.requiredString('code', 'The performer code is required.', { max: 40 }),
      name: input.requiredString('name', 'The performer name is required.', { max: 120 }),
      ...activeFlag(input),
      sortOrder: sortOrder(input),
    });
    input.done();
    return values;
  },
  present: (row) => ({ id: row.id, code: row.code, name: row.name, is_active: row.active, sort_order: row.sortOrder, ...timestamps(row) }),
  nameOf: (row) => String(row.code),
});

// ─── Services (shared with the sales CRM) ────────────────────────────────────

async function uniqueServiceSlug(name: string): Promise<string> {
  const base = slugify(name) || 'service';
  let slug = base;
  for (let i = 2; (await db.select({ id: services.id }).from(services).where(eq(services.slug, slug)).limit(1)).length; i++) slug = `${base}-${i}`;
  return slug;
}

master({
  path: '/admin/services',
  permission: 'services.manage',
  label: 'Service',
  table: services,
  searchable: [services.name],
  orderBy: [asc(services.sortOrder), asc(services.name)],
  parse: (body) => {
    const input = Input.from(body);
    const status = input.oneOf('status', SERVICE_STATUSES, 'Choose a valid status.', { required: true });
    const price = input.number('price', { nullable: true, min: 0, message: 'Enter a valid price.' });
    const values = defined({
      name: input.requiredString('name', 'The service name is required.', { max: 100, raw: true }),
      description: input.optionalString('description', { max: 255, raw: true }),
      ...(status ? statusColumns(status) : {}),
      fields: input.stringArray('fields', { allowed: SERVICE_FIELDS, unique: true, message: 'That is not a field a quotation form can ask for.' }),
      artistRestricted: input.bool('artist_restricted'),
      sortOrder: sortOrder(input),
      categoryId: input.optionalId('category_id', 'Choose a valid category.'),
      subCategoryId: input.optionalId('sub_category_id', 'Choose a valid sub category.'),
      price,
    });
    input.done();
    return values;
  },
  // The slug is generated on create and never edited (the quotation catalog keys off it)
  beforeCreate: async (values) => ({ ...values, slug: await uniqueServiceSlug(String(values.name)) }),
  present: async (row) => {
    const service = row as unknown as typeof services.$inferSelect;
    const [[{ artistsCount }], [{ rulesCount }]] = await Promise.all([
      db
        .select({ artistsCount: count() })
        .from(artistServices)
        .innerJoin(artists, eq(artists.id, artistServices.artistId))
        .where(and(eq(artistServices.serviceId, service.id), isNull(artists.deletedAt))),
      db.select({ rulesCount: count() }).from(pricingRules).where(eq(pricingRules.serviceId, service.id)),
    ]);
    return {
      id: service.id,
      name: service.name,
      slug: service.slug,
      description: service.description,
      status: serviceStatus(service),
      is_active: service.active,
      fields: quotationFields(service),
      is_quotable: isQuotable(service),
      artist_restricted: restrictsArtistSelection(service),
      sort_order: service.sortOrder,
      category_id: service.categoryId,
      sub_category_id: service.subCategoryId,
      price: service.price,
      artists_count: Number(artistsCount),
      pricing_rules_count: Number(rulesCount),
      ...timestamps(row),
    };
  },
  nameOf: (row) => String(row.name),
});

// ─── Artists ─────────────────────────────────────────────────────────────────

const ARTIST_CODE = /^[A-Za-z0-9_-]+$/;

function parseArtist(body: unknown) {
  const input = Input.from(body);
  const values = {
    code: input.requiredString('code', 'The artist code is required.', {
      max: 40,
      pattern: ARTIST_CODE,
      patternMessage: 'The code may only contain letters, numbers, dashes and underscores.',
    }),
    name: input.requiredString('name', 'The artist name is required.', { max: 120, raw: true }),
    gender: (input.raw('gender') === '' || input.raw('gender') === null
      ? null
      : (input.oneOf('gender', ARTIST_GENDERS, 'Choose male, female or other.') ?? null)) as (typeof ARTIST_GENDERS)[number] | null,
    email: input.optionalEmail('email') ?? null,
    phone: input.optionalPhone('phone') ?? null,
    employeeId: input.optionalId('employee_id', 'Choose a valid employee.') ?? null,
    notes: input.optionalString('notes', { max: 2000, raw: true }) ?? null,
    ...activeFlag(input),
  };
  const serviceIds = input.idArray('service_ids', {
    required: true,
    message: 'Select at least one service this artist provides.',
    minMessage: 'Select at least one service this artist provides.',
    eachMessage: 'One of the selected services is not valid.',
  });
  const languageIds = input.idArray('language_ids', { message: 'One of the selected languages is not valid.', eachMessage: 'One of the selected languages is not valid.' });
  input.done();
  return { values, serviceIds, languageIds };
}

async function findArtist(id: string) {
  const [row] = isUuid(id) ? await db.select().from(artists).where(and(eq(artists.id, id), isNull(artists.deletedAt))).limit(1) : [];
  if (!row) throw notFound('Artist');
  return row;
}

/** The admin table shows each artist's services, languages and rate count */
async function presentArtist(artist: typeof artists.$inferSelect) {
  const [linkedServices, linkedLanguages, [{ n }]] = await Promise.all([
    db
      .select({ id: services.id, name: services.name, slug: services.slug })
      .from(artistServices)
      .innerJoin(services, eq(services.id, artistServices.serviceId))
      .where(eq(artistServices.artistId, artist.id))
      .orderBy(asc(services.sortOrder)),
    db
      .select({ id: languages.id, name: languages.name })
      .from(artistLanguages)
      .innerJoin(languages, eq(languages.id, artistLanguages.languageId))
      .where(eq(artistLanguages.artistId, artist.id))
      .orderBy(asc(languages.sortOrder)),
    db.select({ n: count() }).from(pricingRules).where(eq(pricingRules.artistId, artist.id)),
  ]);
  return {
    id: artist.id,
    code: artist.code,
    name: artist.name,
    gender: artist.gender,
    email: artist.email,
    phone: artist.phone,
    employee: artist.employeeId,
    notes: artist.notes,
    is_active: artist.active,
    deleted_at: iso(artist.deletedAt),
    services: linkedServices,
    languages: linkedLanguages,
    pricing_rules_count: Number(n),
    created_at: artist.createdAt.toISOString(),
    updated_at: artist.updatedAt.toISOString(),
  };
}

async function syncArtistLinks(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], artistId: string, serviceIds: string[], languageIds: string[]) {
  await tx.delete(artistServices).where(eq(artistServices.artistId, artistId));
  await tx.delete(artistLanguages).where(eq(artistLanguages.artistId, artistId));
  if (serviceIds.length) await tx.insert(artistServices).values(serviceIds.map((serviceId) => ({ artistId, serviceId })));
  if (languageIds.length) await tx.insert(artistLanguages).values(languageIds.map((languageId) => ({ artistId, languageId })));
}

router.get('/admin/artists', requirePermission('artists.manage'), async (req, res) => {
  const { page, perPage } = pageQuery(req.query, { perPage: 25 });
  const search = searchTerm(req.query);
  const input = Input.from(req.query);
  const serviceId = input.optionalId('service_id', 'Choose a valid service.');
  input.done();
  const active = toBool(req.query.is_active);

  const where = and(
    isNull(artists.deletedAt),
    search ? or(ilike(artists.name, likePattern(search)), ilike(artists.code, likePattern(search))) : undefined,
    serviceId ? inArray(artists.id, db.select({ id: artistServices.artistId }).from(artistServices).where(eq(artistServices.serviceId, serviceId))) : undefined,
    active === undefined ? undefined : eq(artists.active, active)
  );
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(artists).where(where).orderBy(asc(artists.name)).limit(perPage).offset((page - 1) * perPage),
    db.select({ total: count() }).from(artists).where(where),
  ]);
  res.json({ data: await Promise.all(rows.map(presentArtist)), meta: meta(page, perPage, Number(total), rows.length) });
});

router.get('/admin/artists/:id', requirePermission('artists.manage'), async (req, res) => {
  res.json({ data: await presentArtist(await findArtist((req.params.id as string))) });
});

router.post('/admin/artists', requirePermission('artists.manage'), async (req, res) => {
  const { values, serviceIds, languageIds } = parseArtist(req.body);
  const artist = await db.transaction(async (tx) => {
    const [row] = await tx.insert(artists).values(values).returning();
    await syncArtistLinks(tx, row.id, serviceIds, languageIds);
    return row;
  });
  flushLookups();
  await logActivity(req, 'created', `Artist ${artist.code} created`, { id: artist.id, type: 'Artist' });
  res.status(201).json({ data: await presentArtist(artist) });
});

router.put('/admin/artists/:id', requirePermission('artists.manage'), async (req, res) => {
  const before = await findArtist((req.params.id as string));
  const { values, serviceIds, languageIds } = parseArtist(req.body);
  const artist = await db.transaction(async (tx) => {
    const [row] = await tx.update(artists).set({ ...values, updatedAt: new Date() }).where(eq(artists.id, before.id)).returning();
    await syncArtistLinks(tx, row.id, serviceIds, languageIds);
    return row;
  });
  flushLookups();
  await logActivity(req, 'updated', `Artist ${artist.code} updated`, { id: artist.id, type: 'Artist' }, changes(before, artist));
  res.json({ data: await presentArtist(artist) });
});

/** Soft delete: past quotations keep their reference; pricing rules stop matching */
router.delete('/admin/artists/:id', requirePermission('artists.manage'), async (req, res) => {
  const artist = await findArtist((req.params.id as string));
  await db.update(artists).set({ deletedAt: new Date() }).where(eq(artists.id, artist.id));
  flushLookups();
  await logActivity(req, 'deleted', `Artist ${artist.code} deleted`, { id: artist.id, type: 'Artist' });
  res.status(204).end();
});

// ─── Pricing rules ───────────────────────────────────────────────────────────

function parsePricingRule(body: unknown) {
  const input = Input.from(body);
  const nullableNumber = (field: string, min: number, message = 'Enter a valid number.') =>
    input.number(field, { nullable: true, decimals: 2, min, max: 10000, message }) ?? null;

  const values = {
    name: input.optionalString('name', { max: 150, raw: true }) ?? null,
    serviceId: input.requiredId('service_id', 'Choose a service.'),
    artistId: input.optionalId('artist_id', 'Choose a valid artist.') ?? null,
    languageId: input.optionalId('language_id', 'Choose a valid language.') ?? null,
    sourceLanguageId: input.optionalId('source_language_id', 'Choose a valid source language.') ?? null,
    videoTypeId: input.optionalId('video_type_id', 'Choose a valid video type.') ?? null,
    performerId: input.optionalId('performer_id', 'Choose a valid performer.') ?? null,
    unit: input.oneOf('unit', PRICING_UNITS, 'Choose per minute, per second or per unit.', { required: true })!,
    basePrice: input.number('base_price', { required: true, decimals: 2, min: 0, max: 9999999999, message: 'Enter a price.' }),
    costPrice: input.number('cost_price', { nullable: true, decimals: 2, min: 0, max: 9999999999, message: 'Enter a valid cost price.' }) ?? null,
    minQuantity: input.number('min_quantity', { integer: true, min: 1, max: 100000, message: 'The minimum quantity must be a whole number.' }) ?? undefined,
    minDurationMinutes: nullableNumber('min_duration_minutes', 0),
    maxDurationMinutes: nullableNumber('max_duration_minutes', 0.01),
    effectiveFrom: input.date('effective_from', { message: 'Enter a valid date.' })?.slice(0, 10) ?? null,
    effectiveTo: input.date('effective_to', { message: 'Enter a valid date.' })?.slice(0, 10) ?? null,
    priority: input.number('priority', { integer: true, min: -1000, max: 1000, message: 'The priority must be a whole number.' }) ?? undefined,
    ...activeFlag(input),
    notes: input.optionalString('notes', { max: 2000, raw: true }) ?? null,
  };
  input.done();
  return values;
}

/** The cross-field rules: duration and date ranges in order, the service exists, the artist provides it */
async function validatePricingRule(rule: ReturnType<typeof parsePricingRule>) {
  const errors: Record<string, string> = {};
  if (rule.maxDurationMinutes !== null && rule.minDurationMinutes !== null && rule.maxDurationMinutes < rule.minDurationMinutes) {
    errors.max_duration_minutes = 'The maximum duration must be at least the minimum duration.';
  }
  if (rule.effectiveFrom && rule.effectiveTo && rule.effectiveTo < rule.effectiveFrom) {
    errors.effective_to = 'The end date must be on or after the start date.';
  }
  const [service] = await db.select({ id: services.id }).from(services).where(eq(services.id, rule.serviceId)).limit(1);
  if (!service) errors.service_id = 'The selected service does not exist.';
  if (rule.artistId && service) {
    const [linked] = await db
      .select({ id: artistServices.artistId })
      .from(artistServices)
      .where(and(eq(artistServices.artistId, rule.artistId), eq(artistServices.serviceId, rule.serviceId)))
      .limit(1);
    if (!linked) errors.artist_id = 'This artist is not linked to the selected service.';
  }
  if (rule.performerId && !(await db.select({ id: performers.id }).from(performers).where(eq(performers.id, rule.performerId)).limit(1)).length) {
    errors.performer_id = 'The selected performer does not exist.';
  }
  if (Object.keys(errors).length) throw ValidationError.of(errors);

  return defined({
    ...rule,
    basePrice: money(rule.basePrice),
    costPrice: moneyOrNull(rule.costPrice),
    minDurationMinutes: moneyOrNull(rule.minDurationMinutes),
    maxDurationMinutes: moneyOrNull(rule.maxDurationMinutes),
  });
}

async function presentRule(rule: typeof pricingRules.$inferSelect) {
  const named = <T>(rows: Promise<T[]>) => rows.then((r) => r[0] ?? null);
  const [service, artist, language, sourceLanguage, videoType, performer] = await Promise.all([
    named(db.select({ id: services.id, name: services.name, slug: services.slug }).from(services).where(eq(services.id, rule.serviceId))),
    // A rule keeps showing the artist it names after they are deleted, so the table can explain why it stopped matching
    rule.artistId
      ? named(db.select({ id: artists.id, code: artists.code, name: artists.name, deletedAt: artists.deletedAt }).from(artists).where(eq(artists.id, rule.artistId)))
      : null,
    rule.languageId ? named(db.select({ id: languages.id, name: languages.name }).from(languages).where(eq(languages.id, rule.languageId))) : null,
    rule.sourceLanguageId ? named(db.select({ id: languages.id, name: languages.name }).from(languages).where(eq(languages.id, rule.sourceLanguageId))) : null,
    rule.videoTypeId ? named(db.select({ id: videoTypes.id, name: videoTypes.name }).from(videoTypes).where(eq(videoTypes.id, rule.videoTypeId))) : null,
    rule.performerId ? named(db.select({ id: performers.id, code: performers.code, name: performers.name }).from(performers).where(eq(performers.id, rule.performerId))) : null,
  ]);
  return {
    id: rule.id,
    name: rule.name,
    service,
    artist: artist ? { id: artist.id, code: artist.code, name: artist.name, deleted_at: iso(artist.deletedAt) } : null,
    language,
    source_language: sourceLanguage,
    video_type: videoType,
    performer,
    unit: rule.unit,
    base_price: money(rule.basePrice),
    cost_price: moneyOrNull(rule.costPrice),
    min_quantity: rule.minQuantity,
    min_duration_minutes: moneyOrNull(rule.minDurationMinutes),
    max_duration_minutes: moneyOrNull(rule.maxDurationMinutes),
    effective_from: rule.effectiveFrom,
    effective_to: rule.effectiveTo,
    priority: rule.priority,
    is_active: rule.active,
    notes: rule.notes,
    created_at: rule.createdAt.toISOString(),
  };
}

async function findRule(id: string) {
  const [row] = isUuid(id) ? await db.select().from(pricingRules).where(eq(pricingRules.id, id)).limit(1) : [];
  if (!row) throw notFound('Pricing rule');
  return row;
}

router.get('/admin/pricing-rules', requirePermission('pricing.manage'), async (req, res) => {
  const { page, perPage } = pageQuery(req.query, { perPage: 25 });
  const input = Input.from(req.query);
  const serviceId = input.optionalId('service_id', 'Choose a valid service.');
  const artistId = input.optionalId('artist_id', 'Choose a valid artist.');
  input.done();
  const active = toBool(req.query.is_active);

  const where = and(
    serviceId ? eq(pricingRules.serviceId, serviceId) : undefined,
    artistId ? eq(pricingRules.artistId, artistId) : undefined,
    active === undefined ? undefined : eq(pricingRules.active, active)
  );
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ rule: pricingRules })
      .from(pricingRules)
      .innerJoin(services, eq(services.id, pricingRules.serviceId))
      .where(where)
      .orderBy(asc(services.sortOrder), asc(services.name), desc(pricingRules.priority), asc(pricingRules.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db.select({ total: count() }).from(pricingRules).where(where),
  ]);
  res.json({ data: await Promise.all(rows.map((row) => presentRule(row.rule))), meta: meta(page, perPage, Number(total), rows.length) });
});

router.get('/admin/pricing-rules/:id', requirePermission('pricing.manage'), async (req, res) => {
  res.json({ data: await presentRule(await findRule((req.params.id as string))) });
});

router.post('/admin/pricing-rules', requirePermission('pricing.manage'), async (req, res) => {
  const values = await validatePricingRule(parsePricingRule(req.body));
  const [rule] = await db
    .insert(pricingRules)
    .values({ ...values, createdBy: erpUser(req).id } as typeof pricingRules.$inferInsert)
    .returning();
  flushLookups();
  await logActivity(req, 'created', `Pricing rule "${rule.name ?? `#${rule.id}`}" created`, { id: rule.id, type: 'Pricing rule' });
  res.status(201).json({ data: await presentRule(rule) });
});

router.put('/admin/pricing-rules/:id', requirePermission('pricing.manage'), async (req, res) => {
  const values = await validatePricingRule(parsePricingRule(req.body));
  const before = await findRule((req.params.id as string));
  const [rule] = await db
    .update(pricingRules)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(pricingRules.id, before.id))
    .returning();
  flushLookups();
  const diff = changes(before, rule);
  if (Object.keys(diff.new).length) {
    await logActivity(req, 'updated', `Pricing rule "${rule.name ?? `#${rule.id}`}" updated`, { id: rule.id, type: 'Pricing rule' }, diff);
  }
  res.json({ data: await presentRule(rule) });
});

router.delete('/admin/pricing-rules/:id', requirePermission('pricing.manage'), async (req, res) => {
  const rule = await findRule((req.params.id as string));
  try {
    await db.delete(pricingRules).where(eq(pricingRules.id, rule.id));
  } catch (err) {
    if (isInUse(err)) throw conflict('This pricing rule is in use and cannot be deleted. Deactivate it instead.');
    throw err;
  }
  flushLookups();
  await logActivity(req, 'deleted', `Pricing rule "${rule.name ?? `#${rule.id}`}" deleted`, { id: rule.id, type: 'Pricing rule' });
  res.status(204).end();
});

/** Employees an artist can be linked to (artist form dropdown) */
router.get('/lookups/employees', requirePermission('artists.manage'), async (_req, res) => {
  const rows = await db.select({ id: employees.id, name: employees.name, code: employees.employeeCode }).from(employees).orderBy(asc(employees.name));
  res.json({ data: rows });
});

export default router;
