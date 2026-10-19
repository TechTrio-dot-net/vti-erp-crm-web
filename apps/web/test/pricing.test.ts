import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { pricingRules, services } from '../src/server/db/schema';
import { SERVICE_SOCIAL_MEDIA_MARKETING, SERVICE_VOICE_OVER, SERVICE_WEBSITE } from '../src/server/erp/catalog';
import { updateSettings } from '../src/server/erp/settings';
import {
  ROLE,
  actingAsRole,
  artistId,
  as,
  db,
  dubbingItem,
  languageId,
  performerId,
  resetDb,
  seedTestCatalog,
  serviceIdOf,
  standardVideoEditingRate,
  videoEditingItem,
  videoTypeId,
  voiceOverItem,
  type Actor,
  type Line,
} from './harness';

describe('Pricing', () => {
  let admin: Actor;

  const calculate = (actor: Actor, ...items: Line[]) => as(actor).post('/api/v1/quotations/calculate').send({ items });

  beforeEach(async () => {
    await resetDb();
    await seedTestCatalog();
    // Most cases exercise artist-specific rules, so act as a role that may choose artists
    admin = await actingAsRole(ROLE.ADMIN);
  });

  it('prices the brief example: 2300 x 3 min + 18% GST', async () => {
    const { body } = await calculate(admin, await voiceOverItem()).expect(200);

    expect(body.data.items[0].unit_price).toBe('2300.00');
    expect(body.data.items[0].line_total).toBe('6900.00');
    expect(body.data.items[0].snapshot.duration_label).toBe('3 Minutes');
    expect(body.data.subtotal).toBe('6900.00');
    expect(body.data.tax.rate).toBe('18.00');
    expect(body.data.tax.amount).toBe('1242.00');
    expect(body.data.grand_total).toBe('8142.00');
  });

  it('handles a custom duration and quantity', async () => {
    // 2300 × 2.5 min × 7 = 40,250
    const { body } = await calculate(admin, await voiceOverItem({ duration_id: null, duration_minutes: 2.5, quantity: 7 })).expect(200);

    expect(body.data.items[0].line_total).toBe('40250.00');
    expect(body.data.items[0].snapshot.duration_label).toBe('2.5 Minutes');
  });

  it('sums multiple services', async () => {
    // VO 6,900 + VE 1500×2×2 = 6,000 + Dubbing 2000×1.5 = 3,000
    const { body } = await calculate(admin, await voiceOverItem(), await videoEditingItem(), await dubbingItem()).expect(200);

    expect(body.data.subtotal).toBe('15900.00');
    expect(body.data.tax.amount).toBe('2862.00');
    expect(body.data.grand_total).toBe('18762.00');
  });

  describe('rule selection', () => {
    it('prefers a language-specific rule over a generic one', async () => {
      const english = await languageId('English');
      await db.insert(pricingRules).values({
        serviceId: await serviceIdOf(SERVICE_VOICE_OVER),
        artistId: await artistId('VO_F_DP0002'),
        languageId: english,
        basePrice: '2500',
      });

      const specific = await calculate(admin, await voiceOverItem({ language_id: english }));
      expect(specific.body.data.items[0].unit_price).toBe('2500.00');

      const generic = await calculate(admin, await voiceOverItem());
      expect(generic.body.data.items[0].unit_price).toBe('2300.00');
    });

    it('lets priority override specificity', async () => {
      await db.insert(pricingRules).values({ serviceId: await serviceIdOf(SERVICE_VOICE_OVER), basePrice: '999', priority: 10 });

      const { body } = await calculate(admin, await voiceOverItem());
      expect(body.data.items[0].unit_price).toBe('999.00');
    });

    it('ignores rules outside their date window', async () => {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      await db
        .update(pricingRules)
        .set({ effectiveTo: yesterday })
        .where(eq(pricingRules.serviceId, await serviceIdOf(SERVICE_VOICE_OVER)));

      const { body } = await calculate(admin, await voiceOverItem()).expect(422);
      expect(body.errors['items.0.service_id']).toBeDefined();
    });

    it('selects slab rules by duration range and minimum quantity', async () => {
      await db.insert(pricingRules).values({
        serviceId: await serviceIdOf(SERVICE_VOICE_OVER),
        artistId: await artistId('VO_F_DP0002'),
        minDurationMinutes: '5',
        minQuantity: 3,
        basePrice: '2000',
      });

      const inSlab = await calculate(admin, await voiceOverItem({ duration_id: null, duration_minutes: 6, quantity: 3 }));
      expect(inSlab.body.data.items[0].unit_price).toBe('2000.00');

      const belowMinimum = await calculate(admin, await voiceOverItem({ duration_id: null, duration_minutes: 6, quantity: 2 }));
      expect(belowMinimum.body.data.items[0].unit_price).toBe('2300.00');
    });

    it('ignores duration for per-unit rules', async () => {
      await db
        .update(pricingRules)
        .set({ unit: 'per_unit' })
        .where(eq(pricingRules.serviceId, await serviceIdOf(SERVICE_VOICE_OVER)));

      const { body } = await calculate(admin, await voiceOverItem({ quantity: 2 }));
      expect(body.data.items[0].line_total).toBe('4600.00');
    });

    it('breaks a tie in favour of the newest rule', async () => {
      const serviceId = await serviceIdOf(SERVICE_VOICE_OVER);
      const artist = await artistId('VO_F_DP0002');
      await db.insert(pricingRules).values({ serviceId, artistId: artist, basePrice: '2400', createdAt: new Date(Date.now() + 60_000) });

      const { body } = await calculate(admin, await voiceOverItem()).expect(200);
      expect(body.data.items[0].unit_price).toBe('2400.00');
    });
  });

  describe('reserved artist selection', () => {
    it('lets an employee choose the voice over artist', async () => {
      const employee = await actingAsRole(ROLE.EMPLOYEE);
      const { body } = await calculate(employee, await voiceOverItem()).expect(200);

      expect(body.data.items[0].unit_price).toBe('2300.00');
      expect(body.data.items[0].snapshot.artist.code).toBe('VO_F_DP0002');
    });

    it('drops a video editor sent by an employee and uses the standard rate', async () => {
      await standardVideoEditingRate(800);
      const employee = await actingAsRole(ROLE.EMPLOYEE);

      const { body } = await calculate(employee, await videoEditingItem()).expect(200);

      expect(body.data.items[0].unit_price).toBe('800.00');
      expect(body.data.items[0].snapshot.artist).toBeNull();
    });

    it('prices at the editor rate for a role holding artists.assign', async () => {
      await standardVideoEditingRate(800);

      const { body } = await calculate(admin, await videoEditingItem()).expect(200);

      expect(body.data.items[0].unit_price).toBe('1500.00');
      expect(body.data.items[0].snapshot.artist.code).toBe('VE_DEMO_001');
    });

    it('cannot quote a reserved service that has no standard rate', async () => {
      const employee = await actingAsRole(ROLE.EMPLOYEE);

      const { body } = await calculate(employee, await videoEditingItem()).expect(422);
      expect(body.errors['items.0.service_id']).toBeDefined();
    });
  });

  describe('video editing catalog', () => {
    /** A video editing line with no editor yet, for a real catalog video type */
    const editing = async (videoType: string, overrides: Line = {}) =>
      videoEditingItem({ artist_id: null, video_type_id: await videoTypeId(videoType), quantity: 1, ...overrides });

    it('prices a video type per performer', async () => {
      const kv = await calculate(admin, await editing('Green Screen Video', { performer_id: await performerId('KV') })).expect(200);
      expect(kv.body.data.items[0].unit_price).toBe('25000.00');
      expect(kv.body.data.items[0].line_total).toBe('50000.00');
      expect(kv.body.data.items[0].snapshot.performer.code).toBe('KV');

      const sh = await calculate(admin, await editing('Raw Shoot', { performer_id: await performerId('SH') })).expect(200);
      expect(sh.body.data.items[0].line_total).toBe('5000.00');
    });

    it('requires a performer where the video type needs one', async () => {
      const { body } = await calculate(admin, await editing('UGC Video')).expect(422);
      expect(body.errors['items.0.performer_id']).toBeDefined();
    });

    it('ignores a performer for a video type that does not take one', async () => {
      const { body } = await calculate(admin, await editing('Normal Graphics Video', { performer_id: await performerId('KV') })).expect(200);

      expect(body.data.items[0].line_total).toBe('5000.00');
      expect(body.data.items[0].performer_id).toBeNull();
      expect(body.data.items[0].snapshot.performer).toBeNull();
    });

    it('prices per second, counting whole seconds from the duration', async () => {
      // 10 seconds arrives as 0.17 minutes: 1500 × 10 s, not 1500 × 10.2 s
      const { body } = await calculate(admin, await editing('3D Animation', { duration_minutes: 0.17 })).expect(200);

      expect(body.data.items[0].unit).toBe('per_second');
      expect(body.data.items[0].line_total).toBe('15000.00');
      expect(body.data.items[0].snapshot.duration_label).toBe('10 Seconds');
    });

    it('takes the price from the quotation for a custom-price video type', async () => {
      const missing = await calculate(admin, await editing('Product Shoot')).expect(422);
      expect(missing.body.errors['items.0.custom_price']).toBeDefined();

      const { body } = await calculate(admin, await editing('Location Shoot', { custom_price: 40000, quantity: 2 })).expect(200);
      expect(body.data.items[0].unit).toBe('per_unit');
      expect(body.data.items[0].unit_price).toBe('40000.00');
      expect(body.data.items[0].custom_price).toBe('40000.00');
      expect(body.data.items[0].line_total).toBe('80000.00');
    });

    it('keeps the performer and entered price on a saved quotation', async () => {
      const { body } = await as(admin)
        .post('/api/v1/quotations')
        .send({
          client_name: 'Client',
          items: [await editing('Green Screen Video', { performer_id: await performerId('DH') }), await editing('Product Shoot', { custom_price: 12345.5 })],
        })
        .expect(201);

      expect(body.data.items[0].performer_id).toBe(await performerId('DH'));
      expect(body.data.items[0].custom_price).toBeNull();
      expect(body.data.items[1].custom_price).toBe('12345.50');
      expect(body.data.subtotal).toBe('18845.50');
    });
  });

  describe('custom prices', () => {
    it('lets any line replace the base price, keeping the rule unit', async () => {
      const { body } = await calculate(admin, await voiceOverItem({ custom_price: 2000 })).expect(200);

      expect(body.data.items[0].unit).toBe('per_minute');
      expect(body.data.items[0].unit_price).toBe('2000.00');
      expect(body.data.items[0].base_price).toBe('2300.00');
      expect(body.data.items[0].custom_price).toBe('2000.00');
      expect(body.data.items[0].line_total).toBe('6000.00');
    });

    it('uses the base price when no custom price is given', async () => {
      const { body } = await calculate(admin, await dubbingItem()).expect(200);

      expect(body.data.items[0].base_price).toBe('2000.00');
      expect(body.data.items[0].custom_price).toBeNull();
    });

    it('lets an employee set the price where no rule applies', async () => {
      const employee = await actingAsRole(ROLE.EMPLOYEE);

      const { body } = await calculate(employee, await videoEditingItem({ custom_price: 4000, quantity: 1 })).expect(200);
      expect(body.data.items[0].unit).toBe('per_unit');
      expect(body.data.items[0].base_price).toBeNull();
      expect(body.data.items[0].line_total).toBe('4000.00');
    });

    it('prices social media marketing and websites at the entered price', async () => {
      const { body } = await calculate(
        admin,
        { service_id: await serviceIdOf(SERVICE_WEBSITE), custom_price: 25000, quantity: 1 },
        { service_id: await serviceIdOf(SERVICE_SOCIAL_MEDIA_MARKETING), custom_price: 12000, quantity: 3 }
      ).expect(200);

      expect(body.data.subtotal).toBe('61000.00');
    });

    it('refuses a price of zero', async () => {
      const { body } = await calculate(admin, await voiceOverItem({ custom_price: 0 })).expect(422);
      expect(body.errors['items.0.custom_price']).toBeDefined();
    });

    it('keeps the custom and base price on a saved quotation', async () => {
      const { body } = await as(admin)
        .post('/api/v1/quotations')
        .send({ client_name: 'Client', items: [await voiceOverItem({ custom_price: 1999.5 })] })
        .expect(201);

      expect(body.data.items[0].custom_price).toBe('1999.50');
      expect(body.data.items[0].base_price).toBe('2300.00');
    });
  });

  describe('GST', () => {
    it('can be switched off in settings', async () => {
      await updateSettings({ 'tax.gst_enabled': false });

      const { body } = await calculate(admin, await voiceOverItem());
      expect(body.data.tax.amount).toBe('0.00');
      expect(body.data.grand_total).toBe('6900.00');
    });

    it('can be excluded from a single quotation', async () => {
      const { body } = await as(admin)
        .post('/api/v1/quotations/calculate')
        .send({ items: [await voiceOverItem()], include_gst: false })
        .expect(200);

      expect(body.data.tax.enabled).toBe(false);
      expect(body.data.tax.amount).toBe('0.00');
      expect(body.data.grand_total).toBe('6900.00');
    });
  });

  describe('validation', () => {
    it('rejects services that are coming soon', async () => {
      await db.update(services).set({ comingSoon: true }).where(eq(services.slug, SERVICE_WEBSITE));

      const { body } = await calculate(admin, { service_id: await serviceIdOf(SERVICE_WEBSITE), custom_price: 25000, quantity: 1 }).expect(422);
      expect(body.errors['items.0.service_id']).toBeDefined();
    });

    it('requires the fields a service asks for', async () => {
      const dubbing = await calculate(admin, await dubbingItem({ source_language_id: null })).expect(422);
      expect(dubbing.body.errors['items.0.source_language_id']).toBeDefined();

      const editing = await calculate(admin, await videoEditingItem({ video_type_id: null })).expect(422);
      expect(editing.body.errors['items.0.video_type_id']).toBeDefined();
    });

    it('requires the dubbing languages to differ', async () => {
      const { body } = await calculate(admin, await dubbingItem({ source_language_id: await languageId('Hindi') })).expect(422);
      expect(body.errors['items.0.language_id']).toBeDefined();
    });

    it('requires the artist to provide the selected service', async () => {
      const { body } = await calculate(admin, await voiceOverItem({ artist_id: await artistId('VE_DEMO_001') })).expect(422);
      expect(body.errors['items.0.artist_id']).toBeDefined();
    });

    it('requires a duration', async () => {
      const { body } = await calculate(admin, await voiceOverItem({ duration_id: null })).expect(422);
      expect(body.errors['items.0.duration_minutes']).toBeDefined();
    });

    it('reports shape errors on the offending line', async () => {
      const { body } = await calculate(admin, await voiceOverItem({ quantity: 0, service_id: 'nope' })).expect(422);
      expect(body.errors['items.0.quantity']).toBeDefined();
      expect(body.errors['items.0.service_id']).toBeDefined();
    });
  });
});
