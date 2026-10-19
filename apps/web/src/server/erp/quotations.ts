import type { Request } from 'express';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index';
import {
  artistServices,
  artists,
  employees,
  quotationItems,
  quotationSequences,
  quotations,
  services,
  users,
  type LineSnapshot,
  type QuotationStatus,
  type QuotationValidity,
} from '../db/schema';
import { isUuid } from '../lib/http';
import { logActivity } from './activity';
import { flushDashboard } from './cache';
import { restrictsArtistSelection } from './catalog';
import type { ErpUser } from './context';
import { money } from './decimal';
import { ValidationError, conflict, notFound } from './errors';
import { paymentSummary } from './paymentSummary';
import { calculate, describeLine, type Calculation, type PricedLine, type QuotationItemInput } from './pricing';
import type { QuotationData, TextField } from './quotationInput';
import { getString } from './settings';
import { dayIn, dayMonthYearIn, localDateString } from './time';

export type QuotationRow = typeof quotations.$inferSelect;
type ItemRow = typeof quotationItems.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Allowed status changes: from → [to, …] */
const TRANSITIONS: Record<QuotationStatus, QuotationStatus[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['accepted', 'rejected', 'draft', 'cancelled'],
  rejected: ['draft', 'cancelled'],
  accepted: ['cancelled'],
  cancelled: [],
};

/** Quotations in these statuses can no longer be edited */
const LOCKED: QuotationStatus[] = ['accepted', 'cancelled'];

/** Quotations still going ahead, which can have an editor assigned (assignment never changes the price) */
export const ASSIGNABLE: QuotationStatus[] = ['draft', 'sent', 'accepted'];

const COLUMN: Record<TextField, keyof QuotationRow> = {
  client_name: 'clientName',
  client_company: 'clientCompany',
  client_email: 'clientEmail',
  client_phone: 'clientPhone',
  client_gstin: 'clientGstin',
  client_address: 'clientAddress',
  external_reference: 'externalReference',
  notes: 'notes',
  subject: 'subject',
  details: 'details',
  scope: 'scope',
  included_services: 'includedServices',
  terms: 'terms',
  prepared_by_name: 'preparedByName',
  prepared_by_phone: 'preparedByPhone',
};

// ─── Policy ──────────────────────────────────────────────────────────────────

type Owned = Pick<QuotationRow, 'status' | 'createdBy'>;
const owns = (user: ErpUser, quotation: Owned) => quotation.createdBy === user.id;

export const policy = {
  viewAny: (user: ErpUser) => user.canAny('quotations.view', 'quotations.view_all'),
  view: (user: ErpUser, quotation: Owned) => user.can('quotations.view_all') || (user.can('quotations.view') && owns(user, quotation)),
  create: (user: ErpUser) => user.can('quotations.create'),
  /** Editors can change any quotation they can see; creators can still change their own drafts */
  update: (user: ErpUser, quotation: Owned) =>
    user.can('quotations.update') ? policy.view(user, quotation) : owns(user, quotation) && quotation.status === 'draft' && user.can('quotations.create'),
  delete: (user: ErpUser, quotation: Owned) => user.can('quotations.delete') && policy.view(user, quotation),
};

/** Users without quotations.view_all only see the quotations they created */
export function visibleTo(user: ErpUser): SQL | undefined {
  return user.can('quotations.view_all') ? undefined : eq(quotations.createdBy, user.id);
}

export const nextStatuses = (quotation: Pick<QuotationRow, 'status'>): QuotationStatus[] => TRANSITIONS[quotation.status] ?? [];

// ─── Reading ─────────────────────────────────────────────────────────────────

export async function findQuotation(id: string): Promise<QuotationRow> {
  const [row] = isUuid(id) ? await db.select().from(quotations).where(and(eq(quotations.id, id), isNull(quotations.deletedAt))).limit(1) : [];
  if (!row) throw notFound('Quotation');
  return row;
}

export async function userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return new Map();
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((row) => [row.id, row.name]));
}

function toDateOnly(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

export function serializeItem(item: ItemRow) {
  return {
    id: item.id,
    service_id: item.serviceId,
    artist_id: item.artistId,
    language_id: item.languageId,
    source_language_id: item.sourceLanguageId,
    video_type_id: item.videoTypeId,
    performer_id: item.performerId,
    duration_id: item.durationId,
    duration_minutes: money(item.durationMinutes),
    quantity: item.quantity,
    unit: item.unit,
    unit_price: money(item.unitPrice),
    // Sent back so editing the quotation re-prices the line with the same entered price
    custom_price: item.isCustomPrice ? money(item.unitPrice) : null,
    base_price: item.basePrice === null ? null : money(item.basePrice),
    line_total: money(item.lineTotal),
    description: item.description,
    snapshot: item.snapshot ?? {},
  };
}

export function serializeQuotation(
  q: QuotationRow,
  options: {
    items?: ItemRow[];
    itemsCount?: number;
    creator?: { id: string; name: string } | null;
    can: { update: boolean; delete: boolean };
  }
) {
  return {
    id: q.id,
    quotation_number: q.quotationNumber,
    status: q.status,
    subject: q.subject,
    details: q.details,
    client_name: q.clientName,
    client_company: q.clientCompany,
    client_email: q.clientEmail,
    client_phone: q.clientPhone,
    client_gstin: q.clientGstin,
    client_address: q.clientAddress,
    scope: q.scope,
    included_services: q.includedServices,
    terms: q.terms,
    prepared_by_name: q.preparedByName,
    prepared_by_phone: q.preparedByPhone,
    external_reference: q.externalReference,
    lead_id: q.leadId,
    currency: q.currency,
    subtotal: money(q.subtotal),
    include_gst: q.includeGst,
    tax_rate: money(q.taxRate),
    tax_amount: money(q.taxAmount),
    grand_total: money(q.grandTotal),
    payment: paymentSummary(q),
    notes: q.notes,
    validity: q.validity,
    validity_days: q.validityDays ?? null,
    valid_until: toDateOnly(q.validUntil),
    ...(options.itemsCount !== undefined ? { items_count: options.itemsCount } : {}),
    ...(options.items ? { items: options.items.map(serializeItem) } : {}),
    ...(options.creator !== undefined ? { created_by: options.creator } : {}),
    created_at: q.createdAt.toISOString(),
    updated_at: q.updatedAt.toISOString(),
    can: options.can,
    // Only offered to someone who may update the quotation
    next_statuses: options.can.update ? nextStatuses(q) : [],
  };
}

export const abilities = (user: ErpUser, q: QuotationRow) => ({ update: policy.update(user, q), delete: policy.delete(user, q) });

/** The quotation with its lines and creator, as the detail endpoints return it */
export async function withRelations(q: QuotationRow, user: ErpUser) {
  const [items, creator] = await Promise.all([
    db.select().from(quotationItems).where(eq(quotationItems.quotationId, q.id)).orderBy(asc(quotationItems.sortOrder), asc(quotationItems.id)),
    q.createdBy ? db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, q.createdBy)).limit(1) : Promise.resolve([]),
  ]);
  return serializeQuotation(q, { items, creator: creator[0] ?? null, can: abilities(user, q) });
}

/** quotation id → number of lines */
export async function itemCounts(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: quotationItems.quotationId, n: count() })
    .from(quotationItems)
    .where(inArray(quotationItems.quotationId, ids))
    .groupBy(quotationItems.quotationId);
  return new Map(rows.map((row) => [row.id, Number(row.n)]));
}

// ─── Writing ─────────────────────────────────────────────────────────────────

function textColumns(text: QuotationData['text']): Partial<QuotationRow> {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(text)) out[COLUMN[field as TextField]] = value ?? null;
  return out as Partial<QuotationRow>;
}

function totals(priced: Calculation) {
  return {
    currency: priced.currency,
    subtotal: priced.subtotal,
    taxRate: priced.tax.rate,
    taxAmount: priced.tax.amount,
    grandTotal: priced.grand_total,
  };
}

/** The last day a quotation is valid: 15 days, 1 calendar month, or a custom number of days after issue */
function validUntil(issuedAt: Date, validity: QuotationValidity, customDays: number | null): string {
  const date = new Date(issuedAt);
  if (validity === '1_month') {
    // 31 Jan + 1 month lands on 28/29 Feb, not 2/3 March
    const day = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + 1);
    date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
    return localDateString(date);
  }
  date.setDate(date.getDate() + (validity === 'custom' && customDays ? customDays : 15));
  return localDateString(date);
}

/**
 * Next number for the day, e.g. QT-11-09-2026-0001. One atomic upsert on a per-day counter, so two
 * quotations saved at once can never be given the same number. The counter's day and the printed date
 * are both the business-timezone calendar day.
 */
async function nextNumber(at: Date): Promise<string> {
  const [row] = await db
    .insert(quotationSequences)
    .values({ date: dayIn(at), lastNumber: 1 })
    .onConflictDoUpdate({ target: quotationSequences.date, set: { lastNumber: sql`${quotationSequences.lastNumber} + 1` } })
    .returning({ lastNumber: quotationSequences.lastNumber });
  const prefix = await getString('quotation.number_prefix', 'QT');
  return `${prefix}-${dayMonthYearIn(at)}-${String(row.lastNumber).padStart(4, '0')}`;
}

async function phoneOf(userId: string): Promise<string | null> {
  const [row] = await db.select({ phone: employees.phone }).from(employees).where(eq(employees.userId, userId)).limit(1);
  return row?.phone ?? null;
}

/** Lines are replaced wholesale on every save */
async function replaceItems(tx: Tx, quotationId: string, lines: PricedLine[]): Promise<void> {
  await tx.delete(quotationItems).where(eq(quotationItems.quotationId, quotationId));
  if (!lines.length) return;
  await tx.insert(quotationItems).values(
    lines.map((line, order) => ({
      quotationId,
      serviceId: line.service_id,
      artistId: line.artist_id,
      videoTypeId: line.video_type_id,
      performerId: line.performer_id,
      languageId: line.language_id,
      sourceLanguageId: line.source_language_id,
      durationId: line.duration_id,
      pricingRuleId: line.pricing_rule_id,
      durationMinutes: line.duration_minutes,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unit_price,
      isCustomPrice: line.custom_price !== null,
      basePrice: line.base_price,
      lineTotal: line.line_total,
      description: line.description,
      snapshot: line.snapshot,
      sortOrder: order,
    }))
  );
}

export async function createQuotation(req: Request, data: QuotationData, user: ErpUser): Promise<QuotationRow> {
  const includeGst = data.include_gst ?? true;
  const priced = await calculate(data.items, includeGst);

  const now = new Date();
  const validity = data.validity ?? '15_days';
  const validityDays = validity === 'custom' ? (data.validity_days ?? null) : null;
  const number = await nextNumber(now);
  const preparedByPhone = data.text.prepared_by_phone ?? (await phoneOf(user.id));

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(quotations)
      .values({
        ...textColumns(data.text),
        ...totals(priced),
        clientName: data.text.client_name!,
        // Defaults to the person creating the quotation
        preparedByName: data.text.prepared_by_name ?? user.name,
        preparedByPhone,
        leadId: data.lead_id ?? null,
        quotationNumber: number,
        status: 'draft',
        validity,
        validityDays,
        includeGst,
        validUntil: validUntil(now, validity, validityDays),
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    await replaceItems(tx, row.id, priced.items);
    return row;
  });

  await logActivity(req, 'created', `Quotation ${created.quotationNumber} created for ${created.clientName}`, { id: created.id, type: 'Quotation' }, {
    grand_total: created.grandTotal,
  });
  flushDashboard();
  return created;
}

export async function updateQuotation(req: Request, q: QuotationRow, data: QuotationData, user: ErpUser): Promise<QuotationRow> {
  if (LOCKED.includes(q.status)) throw conflict('Accepted or cancelled quotations can no longer be edited.');

  // Re-priced with the rules in force today
  const includeGst = data.include_gst ?? q.includeGst;
  const priced = await calculate(data.items, includeGst);
  const validity = data.validity ?? q.validity;
  // A request that leaves validity out keeps the saved number of days too
  const validityDays = validity !== 'custom' ? null : data.validity ? (data.validity_days ?? null) : q.validityDays;

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(quotations)
      .set({
        ...textColumns(data.text),
        ...totals(priced),
        ...(data.lead_id !== undefined ? { leadId: data.lead_id } : {}),
        validity,
        validityDays,
        includeGst,
        validUntil: validUntil(q.createdAt, validity, validityDays),
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(quotations.id, q.id))
      .returning();
    await replaceItems(tx, q.id, priced.items);
    return row;
  });

  await logActivity(req, 'updated', `Quotation ${updated.quotationNumber} updated`, { id: q.id, type: 'Quotation' }, { grand_total: updated.grandTotal });
  flushDashboard();
  return updated;
}

export async function changeStatus(req: Request, q: QuotationRow, status: QuotationStatus, user: ErpUser): Promise<QuotationRow> {
  if (status === q.status) return q;
  if (!TRANSITIONS[q.status]?.includes(status)) {
    throw ValidationError.of({ status: `A ${q.status} quotation cannot be marked as ${status}.` });
  }
  const [updated] = await db
    .update(quotations)
    .set({ status, updatedBy: user.id, updatedAt: new Date() })
    .where(eq(quotations.id, q.id))
    .returning();
  await logActivity(req, 'status_changed', `Quotation ${q.quotationNumber} marked ${status}`, { id: q.id, type: 'Quotation' }, { from: q.status, to: status });
  flushDashboard();
  return updated;
}

/** Soft delete, so the number is never reissued and history stays intact */
export async function removeQuotation(req: Request, q: QuotationRow): Promise<void> {
  await db.update(quotations).set({ deletedAt: new Date() }).where(eq(quotations.id, q.id));
  await logActivity(req, 'deleted', `Quotation ${q.quotationNumber} deleted`, { id: q.id, type: 'Quotation' });
  flushDashboard();
}

// ─── Reserved artists (video editing) ────────────────────────────────────────

async function reservedServiceIds(): Promise<string[]> {
  const rows = await db.select({ id: services.id }).from(services).where(eq(services.artistRestricted, true));
  return rows.map((row) => row.id);
}

/**
 * Services that reserve the artist choice ignore an artist sent by anyone without artists.assign
 * (those lines price at the standard rate until coordination assigns one). `kept` are artists already
 * assigned on the quotation being saved: re-saving it must not unassign them.
 */
export async function stripReservedArtists(items: QuotationItemInput[], user: ErpUser, kept: Set<string> = new Set()): Promise<QuotationItemInput[]> {
  if (user.can('artists.assign')) return items;
  const reserved = new Set(await reservedServiceIds());
  return items.map((item) =>
    reserved.has(String(item.service_id)) ? { ...item, artist_id: item.artist_id && kept.has(String(item.artist_id)) ? item.artist_id : null } : item
  );
}

/** Artists already assigned on a quotation's reserved-service lines */
export async function assignedArtistIds(q: QuotationRow): Promise<Set<string>> {
  const reserved = await reservedServiceIds();
  if (!reserved.length) return new Set();
  const rows = await db
    .select({ artistId: quotationItems.artistId })
    .from(quotationItems)
    .where(and(eq(quotationItems.quotationId, q.id), inArray(quotationItems.serviceId, reserved), isNotNull(quotationItems.artistId)));
  return new Set(rows.map((row) => row.artistId!));
}

/** Open quotations with reserved-service lines that have no artist yet, newest first (dashboard list) */
export async function pendingArtistAssignments(user: ErpUser, limit = 20) {
  const reserved = await reservedServiceIds();
  if (!reserved.length) return { total: 0, data: [] };

  const unassigned = and(inArray(quotationItems.serviceId, reserved), isNull(quotationItems.artistId));
  const where = and(
    isNull(quotations.deletedAt),
    inArray(quotations.status, ASSIGNABLE),
    visibleTo(user),
    inArray(quotations.id, db.selectDistinct({ id: quotationItems.quotationId }).from(quotationItems).where(unassigned))
  );

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(quotations).where(where).orderBy(desc(quotations.createdAt), desc(quotations.id)).limit(limit),
    db.select({ total: count() }).from(quotations).where(where),
  ]);

  const ids = rows.map((q) => q.id);
  const [lines, names] = await Promise.all([
    ids.length
      ? db
          .select()
          .from(quotationItems)
          .where(and(unassigned, inArray(quotationItems.quotationId, ids)))
          .orderBy(asc(quotationItems.sortOrder), asc(quotationItems.id))
      : Promise.resolve([] as ItemRow[]),
    userNames(rows.map((q) => q.createdBy)),
  ]);

  return {
    total: Number(total),
    data: rows.map((q) => ({
      id: q.id,
      quotation_number: q.quotationNumber,
      client_name: q.clientName,
      client_company: q.clientCompany,
      status: q.status,
      created_by: names.get(q.createdBy ?? '') ?? null,
      created_at: q.createdAt.toISOString(),
      lines: lines
        .filter((line) => line.quotationId === q.id)
        .map((line) => ({
          id: line.id,
          service_id: line.serviceId,
          service: line.snapshot?.service.name ?? null,
          video_type: line.snapshot?.video_type?.name ?? null,
          performer: line.snapshot?.performer?.code ?? null,
          duration_label: line.snapshot?.duration_label ?? null,
          quantity: line.quantity,
        })),
    })),
  };
}

/** Assign (or clear) the artist on one reserved-service line. Only the artist changes, never the price. */
export async function assignArtist(req: Request, q: QuotationRow, itemId: string, artistId: string | null, user: ErpUser): Promise<void> {
  if (!ASSIGNABLE.includes(q.status)) throw conflict(`An editor cannot be assigned on a ${q.status} quotation.`);

  const [item] = isUuid(itemId)
    ? await db.select().from(quotationItems).where(and(eq(quotationItems.id, itemId), eq(quotationItems.quotationId, q.id))).limit(1)
    : [];
  if (!item) throw notFound('Quotation line');

  const [service] = await db.select().from(services).where(eq(services.id, item.serviceId)).limit(1);
  if (!service || !restrictsArtistSelection(service)) {
    throw ValidationError.of({ artist_id: 'The artist on this line is chosen when the quotation is written.' });
  }

  const [artist] =
    artistId && isUuid(artistId)
      ? await db
          .select({ id: artists.id, code: artists.code, name: artists.name })
          .from(artists)
          .innerJoin(artistServices, and(eq(artistServices.artistId, artists.id), eq(artistServices.serviceId, service.id)))
          .where(and(eq(artists.id, artistId), eq(artists.active, true), isNull(artists.deletedAt)))
          .limit(1)
      : [];
  if (artistId && !artist) {
    throw ValidationError.of({ artist_id: `The selected artist is not available for ${service.name}.` });
  }

  const previous = item.snapshot?.artist?.code ?? null;
  await db.transaction(async (tx) => {
    const snapshot: LineSnapshot | null = item.snapshot
      ? { ...item.snapshot, artist: artist ? { id: artist.id, code: artist.code, name: artist.name } : null }
      : null;
    await tx
      .update(quotationItems)
      .set({ artistId: artist?.id ?? null, ...(snapshot ? { snapshot, description: describeLine(snapshot, item.quantity) } : {}) })
      .where(eq(quotationItems.id, item.id));
    await tx.update(quotations).set({ updatedBy: user.id, updatedAt: new Date() }).where(eq(quotations.id, q.id));
  });

  await logActivity(
    req,
    'artist_assigned',
    artist ? `${artist.code} assigned to ${service.name} on quotation ${q.quotationNumber}` : `${service.name} on quotation ${q.quotationNumber} unassigned`,
    { id: q.id, type: 'Quotation' },
    { item: item.id, from: previous, to: artist?.code ?? null }
  );
}
