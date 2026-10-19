import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '../../db/index';
import {
  artistLanguages,
  artistServices,
  artists,
  durations,
  languages,
  performers,
  pricingRules,
  services,
  videoTypes,
  type PricingUnit,
} from '../../db/schema';
import {
  DEFAULT_SERVICE_FIELDS,
  SERVICE_DUBBING,
  SERVICE_SOCIAL_MEDIA_MARKETING,
  SERVICE_VIDEO_EDITING,
  SERVICE_VOICE_OVER,
  SERVICE_WEBSITE,
} from '../catalog';
import { flushLookups } from '../cache';
import { money } from '../decimal';

/** name, ISO code */
const LANGUAGES: [string, string][] = [
  ['Hindi', 'hi'],
  ['English', 'en'],
  ['Gujarati', 'gu'],
  ['Marathi', 'mr'],
  ['Punjabi', 'pa'],
  ['Rajasthani', 'raj'],
  ['Sindhi', 'sd'],
  ['Bengali', 'bn'],
];

const DURATIONS: [number, string][] = [
  [1, '1 Minute'],
  [3, '3 Minutes'],
];

/** code, name, gender, rate per minute (INR), languages. Quotations show the code; the name stays internal. */
const VOICE_ARTISTS: [string, string, 'male' | 'female', number, string[]][] = [
  ['JS_01_VO_M', 'Jal Sir', 'male', 1250, ['English', 'Gujarati', 'Hindi']],
  ['NS_02_VO_M', 'Nitish Sir', 'male', 1250, ['Hindi', 'English', 'Punjabi', 'Rajasthani']],
  ['VB_03_VO_M', 'Vikram Bajaj', 'male', 1750, ['Gujarati', 'Hindi', 'English', 'Punjabi']],
  ['KL_04_VO_M', 'Kamalakar', 'male', 1500, ['Marathi', 'Hindi']],
  ['HM_05_VO_F', "Hanee Ma'am", 'female', 1250, ['Gujarati', 'Hindi', 'English', 'Sindhi']],
  ['TP_06_VO_F', "Trusha Ma'am", 'female', 1250, ['Gujarati', 'Hindi', 'English']],
  ['TN_07_VO_F', "Tanya Ma'am", 'female', 1250, ['Hindi', 'English']],
  ['KV_08_VO_F', "Khushali Ma'am", 'female', 2500, ['Gujarati', 'Hindi', 'English']],
  ['RN_09_VO_F', 'Ranipa', 'female', 1500, ['Bengali', 'Hindi', 'English']],
];

/** Video editors are chosen by coordination (artists.assign) */
const VIDEO_EDITORS: [string, string][] = [
  ['TJ_10_VE', 'Tejas Patel'],
  ['AD_11_VE', 'Anil Desai'],
  ['SC_12_VE', 'Shailendra Chauhan'],
  ['VP_13_VE', 'Vedant Patel'],
  ['SV_14_VE', 'Shiva'],
];

/** The talent who appear in green screen, UGC and raw shoot videos */
const PERFORMERS: [string, string][] = [
  ['SH', "Shailee Ma'am"],
  ['DH', "Dhwani Ma'am"],
  ['KV', "Khushali Ma'am"],
];

/**
 * Video types in display order with their rate (INR) and unit. A rate keyed by performer code makes the
 * type require a performer; a null rate means the price is entered on each quotation.
 */
const VIDEO_TYPES: [string, number | Record<string, number> | null, PricingUnit][] = [
  ['Green Screen Video', { SH: 3250, DH: 3250, KV: 25000 }, 'per_minute'],
  ['UGC Video', { SH: 3250, DH: 3250, KV: 25000 }, 'per_minute'],
  ['Normal Graphics Video', 2500, 'per_minute'],
  ['2D Animation', 5500, 'per_minute'],
  ['3D Animation', 1500, 'per_second'],
  ['AI Video', 3500, 'per_minute'],
  ['Raw Shoot', { SH: 2500, DH: 2500, KV: 20000 }, 'per_minute'],
  ['Product Shoot', null, 'per_minute'],
  ['Location Shoot', null, 'per_minute'],
  ['Motion Graphics Video', 5500, 'per_minute'],
  ['Explainer Video', 2500, 'per_minute'],
  ['White Board Animation', 5500, 'per_minute'],
];

const SERVICES: [string, string][] = [
  [SERVICE_VIDEO_EDITING, 'Video Editing'],
  [SERVICE_VOICE_OVER, 'Voice Over'],
  [SERVICE_DUBBING, 'Dubbing'],
  [SERVICE_SOCIAL_MEDIA_MARKETING, 'Social Media Marketing'],
  [SERVICE_WEBSITE, 'Website'],
];

/** A service by slug; an existing CRM service with the same name is adopted rather than duplicated */
async function ensureService(slug: string, name: string, order: number): Promise<string> {
  const [bySlug] = await db.select({ id: services.id }).from(services).where(eq(services.slug, slug)).limit(1);
  if (bySlug) return bySlug.id;

  const defaults = { fields: DEFAULT_SERVICE_FIELDS[slug] ?? [], artistRestricted: slug === SERVICE_VIDEO_EDITING, sortOrder: order };
  const [byName] = await db.select({ id: services.id, fields: services.fields }).from(services).where(sql`lower(${services.name}) = ${name.toLowerCase()}`).limit(1);
  if (byName) {
    await db
      .update(services)
      .set({ slug, ...(byName.fields.length ? {} : defaults) })
      .where(eq(services.id, byName.id));
    return byName.id;
  }
  const [created] = await db.insert(services).values({ slug, name, ...defaults }).returning({ id: services.id });
  return created.id;
}

async function ensureRule(values: typeof pricingRules.$inferInsert): Promise<void> {
  const match = (column: AnyPgColumn, value: string | null | undefined) => (value ? eq(column, value) : isNull(column));
  const [existing] = await db
    .select({ id: pricingRules.id })
    .from(pricingRules)
    .where(
      and(
        eq(pricingRules.serviceId, values.serviceId),
        match(pricingRules.artistId, values.artistId),
        match(pricingRules.videoTypeId, values.videoTypeId),
        match(pricingRules.performerId, values.performerId),
        isNull(pricingRules.languageId),
        isNull(pricingRules.sourceLanguageId)
      )
    )
    .limit(1);
  if (!existing) await db.insert(pricingRules).values(values);
}

/**
 * The five services and Voice Tunes India's real catalog: languages, voice over / dubbing artists with
 * their per-minute rates, and the video editors, performers and video types with their rates.
 * Idempotent: nothing already present is overwritten, so admin edits survive a re-run.
 */
export async function seedCatalog(): Promise<void> {
  const serviceIds = new Map<string, string>();
  for (const [order, [slug, name]] of SERVICES.entries()) serviceIds.set(slug, await ensureService(slug, name, order + 1));

  await db
    .insert(languages)
    .values(LANGUAGES.map(([name, code], order) => ({ name, code, sortOrder: order + 1 })))
    .onConflictDoNothing();
  const languageIds = new Map((await db.select({ id: languages.id, name: languages.name }).from(languages)).map((l) => [l.name, l.id]));

  for (const [order, [minutes, label]] of DURATIONS.entries()) {
    await db
      .insert(durations)
      .values({ minutes: money(minutes), label, sortOrder: order + 1 })
      .onConflictDoUpdate({ target: durations.minutes, set: { label, sortOrder: order + 1 } });
  }

  // ── Video editing: editors, performers, video types and their rates
  const videoEditing = serviceIds.get(SERVICE_VIDEO_EDITING)!;
  for (const [code, name] of VIDEO_EDITORS) {
    await db.insert(artists).values({ code, name }).onConflictDoNothing();
    const [artist] = await db.select({ id: artists.id }).from(artists).where(eq(artists.code, code)).limit(1);
    await db.insert(artistServices).values({ artistId: artist.id, serviceId: videoEditing }).onConflictDoNothing();
  }

  await db
    .insert(performers)
    .values(PERFORMERS.map(([code, name], order) => ({ code, name, sortOrder: order + 1 })))
    .onConflictDoNothing();
  const performerIds = new Map((await db.select({ id: performers.id, code: performers.code }).from(performers)).map((p) => [p.code, p.id]));

  for (const [order, [name, rate, unit]] of VIDEO_TYPES.entries()) {
    const perPerformer = rate !== null && typeof rate === 'object';
    await db
      .insert(videoTypes)
      .values({ name, sortOrder: order + 1, requiresPerformer: perPerformer, customPrice: rate === null })
      .onConflictDoNothing();
    if (rate === null) continue;
    const [videoType] = await db.select({ id: videoTypes.id }).from(videoTypes).where(eq(videoTypes.name, name)).limit(1);

    // One rule per performer, or a single rule for any performer
    const prices: [string | null, number][] = perPerformer ? Object.entries(rate) : [[null, rate]];
    for (const [performerCode, price] of prices) {
      await ensureRule({
        serviceId: videoEditing,
        videoTypeId: videoType.id,
        performerId: performerCode ? (performerIds.get(performerCode) ?? null) : null,
        name: `${name} — ${performerCode ?? 'standard rate'}`,
        unit,
        basePrice: money(price),
      });
    }
  }

  // ── Voice over and dubbing share one artist roster and one per-minute rate
  const voiceServices = [serviceIds.get(SERVICE_VOICE_OVER)!, serviceIds.get(SERVICE_DUBBING)!];
  for (const [code, name, gender, rate, spoken] of VOICE_ARTISTS) {
    await db.insert(artists).values({ code, name, gender }).onConflictDoNothing();
    const [artist] = await db.select({ id: artists.id }).from(artists).where(eq(artists.code, code)).limit(1);

    await db
      .insert(artistServices)
      .values(voiceServices.map((serviceId) => ({ artistId: artist.id, serviceId })))
      .onConflictDoNothing();
    const spokenIds = spoken.flatMap((language) => (languageIds.has(language) ? [languageIds.get(language)!] : []));
    if (spokenIds.length) {
      await db
        .insert(artistLanguages)
        .values(spokenIds.map((languageId) => ({ artistId: artist.id, languageId })))
        .onConflictDoNothing();
    }
    for (const serviceId of voiceServices) {
      await ensureRule({ serviceId, artistId: artist.id, name: `${code} — standard rate`, unit: 'per_minute', basePrice: money(rate) });
    }
  }

  flushLookups();
}
