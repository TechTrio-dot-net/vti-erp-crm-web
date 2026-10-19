import { beforeEach, describe, expect, it } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import { languages, pricingRules, services } from '../src/server/db/schema';
import { SERVICE_DUBBING, SERVICE_VOICE_OVER } from '../src/server/erp/catalog';
import { ROLE, actingAsRole, artistId, as, db, languageId, resetDb, seedTestCatalog, serviceIdOf, type Actor } from './harness';

describe('Catalog administration', () => {
  beforeEach(async () => {
    await resetDb();
    await seedTestCatalog();
  });

  /** One service from the quotation-form lookup, by slug */
  const lookupService = async (actor: Actor, slug: string) => {
    const { body } = await as(actor).get('/api/v1/lookups/quotation-form').expect(200);
    const service = body.data.services.find((s: { slug: string }) => s.slug === slug);
    if (!service) throw new Error(`Service ${slug} is not listed.`);
    return service;
  };

  it('keeps an employee out of catalog administration', async () => {
    const employee = await actingAsRole(ROLE.EMPLOYEE);

    await as(employee).get('/api/v1/admin/languages').expect(403);
    await as(employee).post('/api/v1/admin/pricing-rules').send({}).expect(403);
    await as(employee).get('/api/v1/admin/services').expect(403);
  });

  it('runs language CRUD and refreshes the cached dropdowns', async () => {
    const admin = await actingAsRole(ROLE.ADMIN);
    const [{ n }] = await db.select({ n: count() }).from(languages).where(eq(languages.active, true));
    const seeded = Number(n);

    const before = await as(admin).get('/api/v1/lookups/quotation-form').expect(200);
    expect(before.body.data.languages).toHaveLength(seeded);

    const created = await as(admin).post('/api/v1/admin/languages').send({ name: 'Tamil', code: 'ta' }).expect(201);

    const afterCreate = await as(admin).get('/api/v1/lookups/quotation-form').expect(200);
    expect(afterCreate.body.data.languages).toHaveLength(seeded + 1);

    const deactivated = await as(admin).put(`/api/v1/admin/languages/${created.body.data.id}`).send({ name: 'Tamil', code: 'ta', is_active: false }).expect(200);
    expect(deactivated.body.data.is_active).toBe(false);

    const afterDeactivate = await as(admin).get('/api/v1/lookups/quotation-form').expect(200);
    expect(afterDeactivate.body.data.languages).toHaveLength(seeded);

    // A duplicate name is refused
    const duplicate = await as(admin).post('/api/v1/admin/languages').send({ name: 'Tamil' }).expect(422);
    expect(duplicate.body.errors.name).toBeDefined();

    const list = await as(admin).get('/api/v1/admin/languages?search=tam').expect(200);
    expect(list.body.data.map((l: { name: string }) => l.name)).toEqual(['Tamil']);
    expect(list.body.meta.total).toBe(1);

    await as(admin).delete(`/api/v1/admin/languages/${created.body.data.id}`).expect(204);
  });

  it('refuses to delete a language that pricing still uses', async () => {
    const admin = await actingAsRole(ROLE.ADMIN);
    const hindi = await languageId('Hindi');
    await db.insert(pricingRules).values({ serviceId: await serviceIdOf(SERVICE_VOICE_OVER), languageId: hindi, basePrice: '1' });

    const { body } = await as(admin).delete(`/api/v1/admin/languages/${hindi}`).expect(409);
    expect(body.message).toContain('in use');
  });

  it('creates an artist with services and languages, and lists them in dropdowns', async () => {
    const admin = await actingAsRole(ROLE.ADMIN);

    const voiceBefore = await as(admin).get('/api/v1/voice-artists').expect(200);
    const dubbingBefore = await as(admin).get('/api/v1/dubbing-artists').expect(200);

    const { body } = await as(admin)
      .post('/api/v1/admin/artists')
      .send({
        code: 'VO_M_0001',
        name: 'New Voice',
        gender: 'male',
        service_ids: [await serviceIdOf(SERVICE_VOICE_OVER), await serviceIdOf(SERVICE_DUBBING)],
        language_ids: [await languageId('Hindi'), await languageId('Gujarati')],
      })
      .expect(201);

    expect(body.data.services).toHaveLength(2);
    expect(body.data.languages).toHaveLength(2);

    const voiceAfter = await as(admin).get('/api/v1/voice-artists').expect(200);
    const dubbingAfter = await as(admin).get('/api/v1/dubbing-artists').expect(200);
    expect(voiceAfter.body.data).toHaveLength(voiceBefore.body.data.length + 1);
    expect(dubbingAfter.body.data).toHaveLength(dubbingBefore.body.data.length + 1);

    // Soft delete: gone from the lists, but the code stays reserved
    await as(admin).delete(`/api/v1/admin/artists/${body.data.id}`).expect(204);
    const voiceGone = await as(admin).get('/api/v1/voice-artists').expect(200);
    expect(voiceGone.body.data).toHaveLength(voiceBefore.body.data.length);
    await as(admin).get(`/api/v1/admin/artists/${body.data.id}`).expect(404);
  });

  it('requires an artist to provide at least one service', async () => {
    const admin = await actingAsRole(ROLE.ADMIN);
    const { body } = await as(admin).post('/api/v1/admin/artists').send({ code: 'BAD CODE', name: 'X', service_ids: [] }).expect(422);
    expect(body.errors.service_ids).toBeDefined();
    expect(body.errors.code).toBeDefined();
  });

  it('lets a super admin stand up a whole new service without a code change', async () => {
    const superAdmin = await actingAsRole(ROLE.SUPER_ADMIN);

    const service = await as(superAdmin).post('/api/v1/admin/services').send({ name: 'Podcast Editing', status: 'active', fields: ['artist_id', 'language_id'] }).expect(201);
    expect(service.body.data.slug).toBe('podcast-editing');

    const artist = await as(superAdmin).post('/api/v1/admin/artists').send({ code: 'PE_01', name: 'Podcast Editor', service_ids: [service.body.data.id] }).expect(201);

    await as(superAdmin)
      .post('/api/v1/admin/pricing-rules')
      .send({ name: 'PE_01 rate', service_id: service.body.data.id, artist_id: artist.body.data.id, unit: 'per_minute', base_price: 900 })
      .expect(201);

    // The new service now drives the quotation form and prices like any other
    const listed = await lookupService(superAdmin, 'podcast-editing');
    expect(listed.is_quotable).toBe(true);
    expect(listed.fields).toEqual(['artist_id', 'language_id']);
    expect(listed.artists.map((a: { code: string }) => a.code)).toEqual(['PE_01']);

    const { body } = await as(superAdmin)
      .post('/api/v1/quotations/calculate')
      .send({ items: [{ service_id: service.body.data.id, artist_id: artist.body.data.id, language_id: await languageId('Hindi'), duration_minutes: 2, quantity: 1 }] })
      .expect(200);
    expect(body.data.subtotal).toBe('1800.00');

    // The same service appears in the sales CRM's service master
    const crm = await as(superAdmin).get('/api/masters/services').expect(200);
    expect(crm.body.map((s: { name: string }) => s.name)).toContain('Podcast Editing');
  });

  it('quotes a service with no fields per unit, at the price entered', async () => {
    const superAdmin = await actingAsRole(ROLE.SUPER_ADMIN);

    await as(superAdmin).post('/api/v1/admin/services').send({ name: 'Photography', status: 'active', fields: [] }).expect(201);

    const invalid = await as(superAdmin).post('/api/v1/admin/services').send({ name: 'Bad', status: 'active', fields: ['nonsense'] }).expect(422);
    expect(invalid.body.errors['fields.0'] ?? invalid.body.errors.fields).toBeDefined();

    const listed = await lookupService(superAdmin, 'photography');
    expect(listed.is_quotable).toBe(true);
    expect(listed.fields).toEqual([]);

    const calculate = (item: Record<string, unknown>) =>
      as(superAdmin).post('/api/v1/quotations/calculate').send({ items: [{ service_id: listed.id, quantity: 3, ...item }] });

    const missing = await calculate({}).expect(422);
    expect(missing.body.errors['items.0.custom_price']).toBeDefined();

    // No duration needed: 15,000 × 3
    const { body } = await calculate({ custom_price: 15000 }).expect(200);
    expect(body.data.items[0].unit).toBe('per_unit');
    expect(body.data.items[0].line_total).toBe('45000.00');
    expect(body.data.items[0].snapshot.duration_label).toBe('');

    // A coming-soon service still can't be quoted
    await as(superAdmin).put(`/api/v1/admin/services/${listed.id}`).send({ name: 'Photography', status: 'coming_soon', fields: [] }).expect(200);
    await calculate({ custom_price: 15000 }).expect(422);
  });

  it('gives a service created in the CRM master a slug the catalog can use', async () => {
    const superAdmin = await actingAsRole(ROLE.SUPER_ADMIN);
    const created = await as(superAdmin).post('/api/masters/services').send({ name: 'Radio Jingle', price: 5000 }).expect(201);
    expect(created.body.slug).toBe('radio-jingle');

    const [row] = await db.select().from(services).where(and(eq(services.slug, 'radio-jingle'), eq(services.active, true)));
    expect(row.price).toBe(5000);
  });

  it('validates pricing rules', async () => {
    const admin = await actingAsRole(ROLE.ADMIN);

    const invalid = await as(admin)
      .post('/api/v1/admin/pricing-rules')
      .send({
        service_id: await serviceIdOf(SERVICE_VOICE_OVER),
        // An editor, not a voice artist
        artist_id: await artistId('VE_DEMO_001'),
        unit: 'per_minute',
        base_price: 100,
        min_duration_minutes: 5,
        max_duration_minutes: 2,
      })
      .expect(422);
    expect(invalid.body.errors.artist_id).toBeDefined();
    expect(invalid.body.errors.max_duration_minutes).toBeDefined();

    const valid = await as(admin)
      .post('/api/v1/admin/pricing-rules')
      .send({ service_id: await serviceIdOf(SERVICE_VOICE_OVER), artist_id: await artistId('VO_F_DP0002'), language_id: await languageId('English'), unit: 'per_minute', base_price: 2500 })
      .expect(201);
    expect(valid.body.data.language.name).toBe('English');
    expect(valid.body.data.base_price).toBe('2500.00');

    const filtered = await as(admin).get(`/api/v1/admin/pricing-rules?artist_id=${await artistId('VO_F_DP0002')}`).expect(200);
    // The demo artist's standard rate and the English rate just added
    expect(filtered.body.meta.total).toBe(2);
  });

  it('limits settings by the permission that manages each group', async () => {
    const admin = await actingAsRole(ROLE.ADMIN);

    const groups = await as(admin).get('/api/v1/admin/settings').expect(200);
    expect(groups.body.data).toHaveLength(1);
    expect(groups.body.data[0].group).toBe('company');

    // Tax belongs to a group this role cannot manage
    await as(admin).put('/api/v1/admin/settings').send({ values: { 'tax.gst_rate': 5 } }).expect(422);
    await as(admin).put('/api/v1/admin/settings').send({ values: { 'company.phone': '+91 22 1234 5678' } }).expect(200);

    const superAdmin = await actingAsRole(ROLE.SUPER_ADMIN);
    await as(superAdmin).put('/api/v1/admin/settings').send({ values: { 'tax.gst_rate': '12', 'quotation.quantity_presets': [1, 5] } }).expect(200);

    const { body } = await as(superAdmin).get('/api/v1/lookups/quotation-form').expect(200);
    expect(body.data.tax.rate).toBe(12);
    expect(body.data.quantity_presets).toEqual([1, 5]);
  });

  it('reserves the activity log for roles that may read it', async () => {
    const admin = await actingAsRole(ROLE.ADMIN);
    await as(admin).get('/api/v1/admin/activity-logs').expect(403);

    const superAdmin = await actingAsRole(ROLE.SUPER_ADMIN);
    await as(superAdmin).post('/api/v1/admin/languages').send({ name: 'Tamil' }).expect(201);

    const { body } = await as(superAdmin).get('/api/v1/admin/activity-logs?search=tamil').expect(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].user).toBe('Test SUPER_ADMIN');
    expect(body.meta.total).toBe(1);
  });
});
