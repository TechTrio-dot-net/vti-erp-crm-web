import { Router } from 'express';
import { and, asc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { db } from '../../db/index';
import {
  artistLanguages,
  artistServices,
  artists,
  categories,
  departments,
  designations,
  durations,
  languages,
  performers,
  roles,
  services,
  videoTypes,
} from '../../db/schema';
import { isSuperRole } from '../../lib/erpPermissions';
import { LOOKUPS_KEY, remember } from '../cache';
import { isQuotable, quotationFields, restrictsArtistSelection, serviceStatus, SERVICE_DUBBING, SERVICE_VIDEO_EDITING, SERVICE_VOICE_OVER } from '../catalog';
import { erpUser, type ErpUser } from '../context';
import { money } from '../decimal';
import { forbidden } from '../errors';
import { getBoolean, getNumber, getSetting, getString } from '../settings';

const router = Router();
const TTL_MS = 60 * 60 * 1000;

/** Everything the quotation form needs, in one cached response */
async function buildQuotationForm(): Promise<Record<string, unknown>> {
  const [serviceRows, languageRows, videoTypeRows, durationRows, performerRows, artistRows, links, spoken] = await Promise.all([
    db.select().from(services).where(eq(services.active, true)).orderBy(asc(services.sortOrder), asc(services.name)),
    db.select().from(languages).where(eq(languages.active, true)).orderBy(asc(languages.sortOrder), asc(languages.name)),
    db.select().from(videoTypes).where(eq(videoTypes.active, true)).orderBy(asc(videoTypes.sortOrder), asc(videoTypes.name)),
    db.select().from(durations).where(eq(durations.active, true)).orderBy(asc(durations.sortOrder), asc(durations.minutes)),
    db.select().from(performers).where(eq(performers.active, true)).orderBy(asc(performers.sortOrder), asc(performers.code)),
    db.select({ id: artists.id, code: artists.code, name: artists.name }).from(artists).where(and(eq(artists.active, true), isNull(artists.deletedAt))).orderBy(asc(artists.code)),
    db.select().from(artistServices),
    db.select().from(artistLanguages),
  ]);

  const languagesOf = new Map<string, string[]>();
  for (const row of spoken) languagesOf.set(row.artistId, [...(languagesOf.get(row.artistId) ?? []), row.languageId]);

  return {
    services: serviceRows.map((service) => {
      const linked = new Set(links.filter((link) => link.serviceId === service.id).map((link) => link.artistId));
      return {
        id: service.id,
        name: service.name,
        slug: service.slug,
        description: service.description,
        status: serviceStatus(service),
        is_quotable: isQuotable(service),
        // True = only artists.assign holders may choose this artist
        artist_restricted: restrictsArtistSelection(service),
        fields: quotationFields(service),
        artists: artistRows
          .filter((artist) => linked.has(artist.id))
          // Empty language_ids = the artist is offered for every language
          .map((artist) => ({ ...artist, language_ids: languagesOf.get(artist.id) ?? [] })),
      };
    }),
    languages: languageRows.map((l) => ({ id: l.id, name: l.name, code: l.code })),
    video_types: videoTypeRows.map((v) => ({ id: v.id, name: v.name, requires_performer: v.requiresPerformer, custom_price: v.customPrice })),
    // Like artists, the form shows the code; the name is for admin screens
    performers: performerRows.map((p) => ({ id: p.id, code: p.code, name: p.name })),
    durations: durationRows.map((d) => ({ id: d.id, label: d.label, minutes: money(d.minutes) })),
    quantity_presets: (await getSetting<unknown[]>('quotation.quantity_presets', [1])).map((value) => Number(value)),
    currency: await getString('quotation.currency', 'INR'),
    tax: { enabled: await getBoolean('tax.gst_enabled', true), label: 'GST', rate: await getNumber('tax.gst_rate', 0) },
    // Printed on quotations
    company: {
      name: await getString('company.name'),
      address: await getString('company.address'),
      email: await getString('company.email'),
      phone: await getString('company.phone'),
      gstin: await getString('company.gstin'),
      website: await getString('company.website'),
    },
    // Defaults for the editable quotation document text
    document: { details: await getString('quotation.default_details'), terms: await getString('quotation.terms') },
  };
}

router.get('/lookups/quotation-form', async (req, res) => {
  const user = erpUser(req);
  const data = await remember(LOOKUPS_KEY, TTL_MS, buildQuotationForm);
  if (user.can('artists.assign')) {
    res.json({ data });
    return;
  }
  // The cache is shared, so artists are stripped per user: only services that reserve the choice hide theirs
  const servicesList = (data.services as Record<string, unknown>[]).map((service) =>
    service.artist_restricted
      ? { ...service, artists: [], fields: (service.fields as string[]).filter((field) => field !== 'artist_id') }
      : service
  );
  res.json({ data: { ...data, services: servicesList } });
});

router.get('/services', async (_req, res) => {
  const rows = await db.select().from(services).where(eq(services.active, true)).orderBy(asc(services.sortOrder), asc(services.name));
  res.json({ data: rows.map((s) => ({ id: s.id, name: s.name, slug: s.slug, description: s.description, status: serviceStatus(s) })) });
});

router.get('/languages', async (_req, res) => {
  const rows = await db.select().from(languages).where(eq(languages.active, true)).orderBy(asc(languages.sortOrder), asc(languages.name));
  res.json({ data: rows.map((l) => ({ id: l.id, name: l.name, code: l.code })) });
});

router.get('/video-types', async (_req, res) => {
  const rows = await db.select().from(videoTypes).where(eq(videoTypes.active, true)).orderBy(asc(videoTypes.sortOrder), asc(videoTypes.name));
  res.json({ data: rows.map((v) => ({ id: v.id, name: v.name })) });
});

router.get('/durations', async (_req, res) => {
  const rows = await db.select().from(durations).where(eq(durations.active, true)).orderBy(asc(durations.sortOrder), asc(durations.minutes));
  res.json({ data: rows.map((d) => ({ id: d.id, label: d.label, minutes: money(d.minutes) })) });
});

/** CRM main and sub categories (sub categories carry their main category's id) */
router.get('/lookups/categories', async (_req, res) => {
  const rows = await db
    .select({ id: categories.id, name: categories.name, parent_id: categories.parentId })
    .from(categories)
    .where(eq(categories.active, true))
    .orderBy(asc(categories.name));
  res.json({ data: rows });
});

router.get('/lookups/departments', async (_req, res) => {
  const rows = await db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.active, true)).orderBy(asc(departments.name));
  res.json({ data: rows });
});

router.get('/lookups/designations', async (_req, res) => {
  const rows = await db.select({ id: designations.id, name: designations.name }).from(designations).where(eq(designations.active, true)).orderBy(asc(designations.name));
  res.json({ data: rows });
});

/** Roles the current user may assign: everything with users.manage, otherwise all but Super Admin and Management */
export async function assignableRoles(user: Pick<ErpUser, 'can'>) {
  return db
    .select({ id: roles.id, name: roles.name, slug: roles.slug, is_system: roles.isSystem })
    .from(roles)
    .where(user.can('users.manage') ? undefined : notInArray(roles.slug, ['SUPER_ADMIN', 'MANAGEMENT']))
    .orderBy(asc(roles.createdAt), asc(roles.name));
}

export const canAssignRole = (user: Pick<ErpUser, 'can'>, slug: string) => user.can('users.manage') || !isSuperRole(slug);

router.get('/lookups/roles', async (req, res) => {
  res.json({ data: await assignableRoles(erpUser(req)) });
});

/** Artists for one service (GET /artists?service=voice-over) or every artist */
async function artistsFor(user: ErpUser, slug: string | null) {
  const [service] = slug ? await db.select({ id: services.id, artistRestricted: services.artistRestricted }).from(services).where(eq(services.slug, slug)).limit(1) : [];
  // Listing every artist, or one of the services that reserves the choice, needs the assign permission
  const reserved = slug === null || Boolean(service?.artistRestricted);
  if (reserved && !user.can('artists.assign')) throw forbidden();

  const where = and(eq(artists.active, true), isNull(artists.deletedAt));
  if (slug && !service) return { data: [] };
  const rows = slug
    ? await db
        .select({ id: artists.id, code: artists.code, name: artists.name })
        .from(artists)
        .where(and(where, inArray(artists.id, db.select({ id: artistServices.artistId }).from(artistServices).where(eq(artistServices.serviceId, service!.id)))))
        .orderBy(asc(artists.name))
    : await db.select({ id: artists.id, code: artists.code, name: artists.name }).from(artists).where(where).orderBy(asc(artists.name));
  return { data: rows };
}

router.get('/artists', async (req, res) => {
  res.json(await artistsFor(erpUser(req), typeof req.query.service === 'string' ? req.query.service : null));
});
router.get('/video-editors', async (req, res) => res.json(await artistsFor(erpUser(req), SERVICE_VIDEO_EDITING)));
router.get('/voice-artists', async (req, res) => res.json(await artistsFor(erpUser(req), SERVICE_VOICE_OVER)));
router.get('/dubbing-artists', async (req, res) => res.json(await artistsFor(erpUser(req), SERVICE_DUBBING)));

export default router;
