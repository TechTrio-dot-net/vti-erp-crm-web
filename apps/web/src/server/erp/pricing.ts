import { and, eq, gte, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '../db/index';
import {
  artistServices,
  artists,
  durations,
  languages,
  performers,
  pricingRules,
  services,
  videoTypes,
  type LineSnapshot,
  type PricingUnit,
} from '../db/schema';
import { isUuid } from '../lib/http';
import { Decimal, dec, money, trimZeros } from './decimal';
import { ValidationError } from './errors';
import { isQuotable, quotationFields, restrictsArtistSelection } from './catalog';
import { getBoolean, getNumber, getString } from './settings';

/** One line as the client sends it */
export interface QuotationItemInput {
  service_id: string;
  artist_id?: string | null;
  language_id?: string | null;
  source_language_id?: string | null;
  video_type_id?: string | null;
  /** Required when the video type requires a performer; ignored otherwise */
  performer_id?: string | null;
  duration_id?: string | null;
  duration_minutes?: string | number | null;
  quantity: number;
  /** A rate replacing the base price, in the rule's unit */
  custom_price?: string | number | null;
}

/** One line once priced — stored on the quotation and returned to the client */
export interface PricedLine {
  service_id: string;
  artist_id: string | null;
  language_id: string | null;
  source_language_id: string | null;
  video_type_id: string | null;
  performer_id: string | null;
  duration_id: string | null;
  duration_minutes: string;
  quantity: number;
  unit: PricingUnit;
  unit_price: string;
  base_price: string | null;
  custom_price: string | null;
  line_total: string;
  pricing_rule_id: string | null;
  description: string;
  snapshot: LineSnapshot;
}

export interface Calculation {
  items: PricedLine[];
  currency: string;
  subtotal: string;
  tax: { label: string; enabled: boolean; rate: string; amount: string };
  grand_total: string;
}

type DimensionField = 'artist_id' | 'language_id' | 'source_language_id' | 'video_type_id';
const DIMENSION_FIELDS: DimensionField[] = ['artist_id', 'language_id', 'source_language_id', 'video_type_id'];
const FIELD_LABELS: Record<DimensionField, string> = {
  artist_id: 'artist',
  language_id: 'language',
  source_language_id: 'source language',
  video_type_id: 'video type',
};

type RuleRow = typeof pricingRules.$inferSelect;

export interface RuleDimensions {
  artistId: string | null;
  languageId: string | null;
  sourceLanguageId: string | null;
  videoTypeId: string | null;
  performerId: string | null;
}

/** Price a set of quotation lines and compute the totals. All quotation pricing happens here. */
export async function calculate(items: QuotationItemInput[], includeGst = true, date: Date = new Date()): Promise<Calculation> {
  const day = date.toISOString().slice(0, 10);
  const lines: PricedLine[] = [];
  let subtotal = new Decimal(0);

  // GST applies when it is switched on in Settings and the quotation is issued with GST
  const taxEnabled = includeGst && (await getBoolean('tax.gst_enabled', true));
  const taxRate = dec(taxEnabled ? await getNumber('tax.gst_rate', 0) : 0).toDecimalPlaces(2);

  for (const [index, item] of items.entries()) {
    const line = await priceLine(item, index, day);
    subtotal = subtotal.plus(line.line_total);
    lines.push(line);
  }

  const taxAmount = subtotal.times(taxRate).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return {
    items: lines,
    currency: await getString('quotation.currency', 'INR'),
    subtotal: money(subtotal),
    tax: { label: 'GST', enabled: taxEnabled, rate: money(taxRate), amount: money(taxAmount) },
    grand_total: money(subtotal.plus(taxAmount)),
  };
}

const matchesDimension = (column: AnyPgColumn, value: string | null): SQL =>
  value === null ? isNull(column) : (or(isNull(column), eq(column, value)) as SQL);

/**
 * The rule that prices this selection, or null. A rule matches when each dimension is unset ("any")
 * or equal to the selection (an unset selection only matches unset rules), and its date window,
 * duration range and minimum quantity fit. The winner has the highest priority, then is the most
 * specific, then has the highest minimum quantity, then the latest effective_from, then is the newest.
 */
export async function resolveRule(serviceId: string, dims: RuleDimensions, minutes: Decimal, quantity: number, day: string): Promise<RuleRow | null> {
  const minutesText = money(minutes);
  const candidates = await db
    .select()
    .from(pricingRules)
    .where(
      and(
        eq(pricingRules.active, true),
        eq(pricingRules.serviceId, serviceId),
        lte(pricingRules.minQuantity, quantity),
        or(isNull(pricingRules.effectiveFrom), lte(pricingRules.effectiveFrom, day)),
        or(isNull(pricingRules.effectiveTo), gte(pricingRules.effectiveTo, day)),
        matchesDimension(pricingRules.artistId, dims.artistId),
        matchesDimension(pricingRules.languageId, dims.languageId),
        matchesDimension(pricingRules.sourceLanguageId, dims.sourceLanguageId),
        matchesDimension(pricingRules.videoTypeId, dims.videoTypeId),
        matchesDimension(pricingRules.performerId, dims.performerId),
        or(isNull(pricingRules.minDurationMinutes), sql`${pricingRules.minDurationMinutes} <= ${minutesText}::numeric`),
        or(isNull(pricingRules.maxDurationMinutes), sql`${pricingRules.maxDurationMinutes} >= ${minutesText}::numeric`)
      )
    );

  if (!candidates.length) return null;
  return candidates.sort((a, b) => compareRank(rank(b), rank(a)))[0];
}

/** Number of optional dimensions a rule narrows on (higher = more specific) */
export function specificity(rule: Pick<RuleRow, 'artistId' | 'languageId' | 'sourceLanguageId' | 'videoTypeId' | 'performerId' | 'minDurationMinutes' | 'maxDurationMinutes'>): number {
  let score = [rule.artistId, rule.languageId, rule.sourceLanguageId, rule.videoTypeId, rule.performerId].filter((v) => v !== null && v !== undefined).length;
  if (rule.minDurationMinutes !== null || rule.maxDurationMinutes !== null) score++;
  return score;
}

// Ties go to the newest rule (ids are random, so creation time decides)
function rank(rule: RuleRow): [number, number, number, number, number, string] {
  return [
    rule.priority ?? 0,
    specificity(rule),
    rule.minQuantity ?? 1,
    rule.effectiveFrom ? Date.parse(rule.effectiveFrom) : 0,
    rule.createdAt.getTime(),
    rule.id,
  ];
}

function compareRank(a: ReturnType<typeof rank>, b: ReturnType<typeof rank>): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

async function one<T>(rows: Promise<T[]>): Promise<T | null> {
  return (await rows)[0] ?? null;
}

async function priceLine(item: QuotationItemInput, index: number, day: string): Promise<PricedLine> {
  const key = (field: string) => `items.${index}.${field}`;
  const errors: Record<string, string> = {};

  const service = isUuid(item.service_id) ? await one(db.select().from(services).where(eq(services.id, item.service_id)).limit(1)) : null;
  if (!service || !isQuotable(service)) {
    throw ValidationError.of({ [key('service_id')]: 'Quotations for this service are not available yet.' });
  }

  const fields = quotationFields(service);
  // Where the service reserves the artist choice, the line may arrive without one and prices at the
  // service's standard rate until it is assigned
  const optional: string[] = restrictsArtistSelection(service) ? ['artist_id'] : [];

  for (const field of fields) {
    if (optional.includes(field)) continue;
    if (!item[field]) errors[key(field)] = `Please select a ${FIELD_LABELS[field]} for ${service.name}.`;
  }
  if (Object.keys(errors).length) throw ValidationError.of(errors);

  // Only the fields this service uses are considered, so stray input cannot affect the rule chosen
  const selected = Object.fromEntries(
    DIMENSION_FIELDS.map((field) => {
      const raw = fields.includes(field) ? item[field] : null;
      return [field, raw && isUuid(raw) ? raw : null];
    })
  ) as Record<DimensionField, string | null>;

  // An artist counts only when they are active, not deleted and linked to this service
  const artist = selected.artist_id
    ? await one(
        db
          .select({ id: artists.id, code: artists.code, name: artists.name })
          .from(artists)
          .innerJoin(artistServices, and(eq(artistServices.artistId, artists.id), eq(artistServices.serviceId, service.id)))
          .where(and(eq(artists.id, selected.artist_id), eq(artists.active, true), isNull(artists.deletedAt)))
          .limit(1)
      )
    : null;
  const activeLanguage = (id: string) =>
    one(db.select({ id: languages.id, name: languages.name }).from(languages).where(and(eq(languages.id, id), eq(languages.active, true))).limit(1));
  const language = selected.language_id ? await activeLanguage(selected.language_id) : null;
  const sourceLanguage = selected.source_language_id ? await activeLanguage(selected.source_language_id) : null;
  const videoType = selected.video_type_id
    ? await one(db.select().from(videoTypes).where(and(eq(videoTypes.id, selected.video_type_id), eq(videoTypes.active, true))).limit(1))
    : null;

  if (selected.artist_id && !artist) errors[key('artist_id')] = `The selected artist is not available for ${service.name}.`;
  if (selected.language_id && !language) errors[key('language_id')] = 'The selected language is not available.';
  if (selected.source_language_id && !sourceLanguage) errors[key('source_language_id')] = 'The selected source language is not available.';
  if (language && sourceLanguage && language.id === sourceLanguage.id) {
    errors[key('language_id')] = 'The dubbing language must differ from the source language.';
  }
  if (selected.video_type_id && !videoType) errors[key('video_type_id')] = 'The selected video type is not available.';

  // Only a video type that needs a performer takes one, so a leftover choice cannot change the rule
  let performer: { id: string; code: string; name: string } | null = null;
  if (videoType?.requiresPerformer) {
    performer =
      item.performer_id && isUuid(item.performer_id)
        ? await one(
            db
              .select({ id: performers.id, code: performers.code, name: performers.name })
              .from(performers)
              .where(and(eq(performers.id, item.performer_id), eq(performers.active, true)))
              .limit(1)
          )
        : null;
    if (!item.performer_id) errors[key('performer_id')] = `Please select a performer for ${videoType.name}.`;
    else if (!performer) errors[key('performer_id')] = 'The selected performer is not available.';
  }

  // Any line's rate can be set on the quotation; a custom-price video type has no base price, so it must be
  const customPrice = positiveMoney(item.custom_price);
  if (item.custom_price !== null && item.custom_price !== undefined && item.custom_price !== '' && customPrice === null) {
    errors[key('custom_price')] = 'The price must be more than zero.';
  } else if (videoType?.customPrice && customPrice === null) {
    errors[key('custom_price')] = `Please enter the price for ${videoType.name}.`;
  }

  // A service with no selection fields (e.g. Website) is quoted per unit, with no duration
  const perUnitOnly = fields.length === 0;
  const { minutes, duration } = perUnitOnly ? { minutes: new Decimal(0), duration: null } : await resolveDuration(item, key, errors);
  const quantity = Number(item.quantity ?? 0);
  if (!Number.isInteger(quantity) || quantity < 1) errors[key('quantity')] = 'Quantity must be at least 1.';

  if (Object.keys(errors).length) throw ValidationError.of(errors);

  // The rule is looked up even when a price was entered, so the line records the base price it departed from
  const rule = videoType?.customPrice
    ? null
    : await resolveRule(
        service.id,
        {
          artistId: artist?.id ?? null,
          languageId: language?.id ?? null,
          sourceLanguageId: sourceLanguage?.id ?? null,
          videoTypeId: videoType?.id ?? null,
          performerId: performer?.id ?? null,
        },
        minutes,
        quantity,
        day
      );

  if (!customPrice && !rule) {
    throw ValidationError.of(
      perUnitOnly
        ? { [key('custom_price')]: `Please enter the price for ${service.name}.` }
        : {
            [key('service_id')]:
              selected.artist_id === null
                ? `No standard rate is configured for ${service.name}. Enter a price, or ask an administrator to add a pricing rule with no artist.`
                : `No price is configured for this ${service.name} selection. Enter a price, or ask an administrator to add a pricing rule.`,
          }
    );
  }

  // An entered price keeps the rule's unit; with no rule to follow, it is a price per unit
  const unit: PricingUnit = rule && !perUnitOnly ? rule.unit : 'per_unit';
  const basePrice = rule ? dec(rule.basePrice) : null;
  const unitPrice = customPrice ?? basePrice!;
  // Durations are kept in minutes to 2 places; a whole number of seconds survives that round trip
  const seconds = minutes.times(60).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const lineTotal =
    unit === 'per_unit' ? unitPrice.times(quantity) : unitPrice.times(unit === 'per_second' ? seconds : minutes).times(quantity);

  const durationLabel = perUnitOnly ? '' : (duration?.label ?? (unit === 'per_second' ? secondsLabel(seconds) : minutesLabel(minutes)));
  const snapshot: LineSnapshot = {
    service: { id: service.id, name: service.name, slug: service.slug },
    artist: artist ? { id: artist.id, code: artist.code, name: artist.name } : null,
    language: language ? { id: language.id, name: language.name } : null,
    source_language: sourceLanguage ? { id: sourceLanguage.id, name: sourceLanguage.name } : null,
    video_type: videoType ? { id: videoType.id, name: videoType.name } : null,
    performer: performer ? { id: performer.id, code: performer.code, name: performer.name } : null,
    duration_label: durationLabel,
  };

  return {
    service_id: service.id,
    artist_id: artist?.id ?? null,
    language_id: language?.id ?? null,
    source_language_id: sourceLanguage?.id ?? null,
    video_type_id: videoType?.id ?? null,
    performer_id: performer?.id ?? null,
    duration_id: duration?.id ?? null,
    duration_minutes: money(minutes),
    quantity,
    unit,
    unit_price: money(unitPrice),
    base_price: basePrice ? money(basePrice) : null,
    custom_price: customPrice ? money(customPrice) : null,
    line_total: money(lineTotal),
    pricing_rule_id: rule?.id ?? null,
    description: describeLine(snapshot, quantity),
    snapshot,
  };
}

/** A preset duration (duration_id) takes precedence over a custom duration_minutes */
async function resolveDuration(
  item: QuotationItemInput,
  key: (field: string) => string,
  errors: Record<string, string>
): Promise<{ minutes: Decimal; duration: { id: string; label: string } | null }> {
  if (item.duration_id) {
    const duration = isUuid(item.duration_id)
      ? await one(
          db
            .select({ id: durations.id, label: durations.label, minutes: durations.minutes })
            .from(durations)
            .where(and(eq(durations.id, item.duration_id), eq(durations.active, true)))
            .limit(1)
        )
      : null;
    if (!duration) {
      errors[key('duration_id')] = 'The selected duration is not available.';
      return { minutes: new Decimal(1), duration: null };
    }
    return { minutes: dec(duration.minutes).toDecimalPlaces(2), duration };
  }

  const raw = item.duration_minutes;
  if (raw === null || raw === undefined || raw === '' || !Number.isFinite(Number(raw)) || Number(raw) <= 0) {
    errors[key('duration_minutes')] = 'Please select a duration or enter a custom duration in minutes.';
    return { minutes: new Decimal(1), duration: null };
  }
  return { minutes: dec(raw).toDecimalPlaces(2, Decimal.ROUND_HALF_UP), duration: null };
}

/** The one-line summary stored on a quotation line, e.g. "Video Editing · TJ_10_VE · UGC Video · KV · 2 Minutes · Qty 1" */
export function describeLine(snapshot: LineSnapshot, quantity: number): string {
  const languagesText =
    snapshot.source_language && snapshot.language ? `${snapshot.source_language.name} → ${snapshot.language.name}` : snapshot.language?.name;
  return [snapshot.service.name, snapshot.artist?.code, snapshot.video_type?.name, snapshot.performer?.code, languagesText, snapshot.duration_label, `Qty ${quantity}`]
    .filter(Boolean)
    .join(' · ');
}

function minutesLabel(minutes: Decimal): string {
  const value = trimZeros(minutes);
  return value === '1' ? '1 Minute' : `${value} Minutes`;
}

function secondsLabel(seconds: Decimal): string {
  const value = trimZeros(seconds);
  return value === '1' ? '1 Second' : `${value} Seconds`;
}

/** A price rounded to paise, or null when it is missing or not above zero */
function positiveMoney(raw: string | number | null | undefined): Decimal | null {
  if (raw === null || raw === undefined || raw === '' || !Number.isFinite(Number(raw))) return null;
  const price = dec(raw).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return price.greaterThan(0) ? price : null;
}
