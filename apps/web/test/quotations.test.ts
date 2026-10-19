import { randomUUID } from 'crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import { activityLogs, artists, leads, quotationItems, quotations } from '../src/server/db/schema';
import { SERVICE_VOICE_OVER } from '../src/server/erp/catalog';
import {
  ROLE,
  actingAsRole,
  artistId,
  as,
  db,
  resetDb,
  seedTestCatalog,
  serviceIdOf,
  standardVideoEditingRate,
  videoEditingItem,
  voiceOverItem,
  type Actor,
  type Line,
} from './harness';

/** dd-mm-yyyy in India, the date portion of a quotation number */
function today(): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
  return parts.replace(/\//g, '-');
}

function isoDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

describe('Quotations', () => {
  beforeEach(async () => {
    await resetDb();
    await seedTestCatalog();
  });

  const payload = async (overrides: Record<string, unknown> = {}) => ({
    client_name: 'Asha Mehta',
    client_company: 'Acme Media',
    client_email: 'asha@example.com',
    items: [await voiceOverItem()],
    ...overrides,
  });

  const create = (actor: Actor, body: Record<string, unknown>) => as(actor).post('/api/v1/quotations').send(body);

  it('lets an employee create a quotation', async () => {
    const employee = await actingAsRole(ROLE.EMPLOYEE);
    const { body } = await create(employee, await payload()).expect(201);

    expect(body.data.status).toBe('draft');
    expect(body.data.grand_total).toBe('8142.00');
    expect(body.data.items[0].snapshot.artist.code).toBe('VO_F_DP0002');
    expect(body.data.created_by.id).toBe(employee.userId);
    expect(body.data.quotation_number).toBe(`QT-${today()}-0001`);
    expect(body.data.validity).toBe('15_days');
    expect(body.data.valid_until).toBe(isoDate(new Date(Date.now() + 15 * 86_400_000)));
    expect(body.data.prepared_by_name).toEqual(expect.any(String));

    const [{ n }] = await db.select({ n: count() }).from(quotationItems);
    expect(Number(n)).toBe(1);

    const [logged] = await db.select().from(activityLogs).where(and(eq(activityLogs.event, 'created'), eq(activityLogs.subjectType, 'Quotation')));
    expect(logged).toBeDefined();
  });

  it('numbers quotations per day', async () => {
    const employee = await actingAsRole(ROLE.EMPLOYEE);

    await create(employee, await payload()).expect(201);
    const second = await create(employee, await payload()).expect(201);

    expect(second.body.data.quotation_number).toBe(`QT-${today()}-0002`);
  });

  it('never hands two quotations saved at once the same number', async () => {
    const employee = await actingAsRole(ROLE.EMPLOYEE);
    const body = await payload();

    const results = await Promise.all(Array.from({ length: 5 }, () => create(employee, body)));
    const numbers = results.map((r) => r.body.data.quotation_number);
    expect(new Set(numbers).size).toBe(5);
  });

  it('saves the document fields and one-month validity', async () => {
    const employee = await actingAsRole(ROLE.EMPLOYEE);

    const { body } = await create(
      employee,
      await payload({
        subject: 'AI and Green Screen Video Development',
        details: 'Voice Tunes India is a premier multimedia production company.',
        scope: 'Complete development of AI videos.',
        included_services: 'AI Video Development\nVoice Over',
        terms: '50% advance',
        prepared_by_name: 'Hasti Thakkar',
        prepared_by_phone: '+91 70488 13189',
        validity: '1_month',
      })
    ).expect(201);

    expect(body.data.subject).toBe('AI and Green Screen Video Development');
    expect(body.data.details).toBe('Voice Tunes India is a premier multimedia production company.');
    expect(body.data.included_services).toBe('AI Video Development\nVoice Over');
    expect(body.data.prepared_by_phone).toBe('+91 70488 13189');
    expect(body.data.validity).toBe('1_month');
  });

  it('can be valid for a custom number of days', async () => {
    const employee = await actingAsRole(ROLE.EMPLOYEE);

    const oneDay = await create(employee, await payload({ validity: 'custom', validity_days: 1 })).expect(201);
    expect(oneDay.body.data.validity).toBe('custom');
    expect(oneDay.body.data.validity_days).toBe(1);
    expect(oneDay.body.data.valid_until).toBe(isoDate(new Date(Date.now() + 86_400_000)));

    // Switching back to a preset clears the custom days
    const preset = await as(employee)
      .put(`/api/v1/quotations/${oneDay.body.data.id}`)
      .send(await payload({ validity: '1_month', validity_days: 7 }))
      .expect(200);
    expect(preset.body.data.validity_days).toBeNull();

    for (const days of [undefined, 0, 366, 2.5]) {
      const { body } = await create(employee, await payload({ validity: 'custom', validity_days: days })).expect(422);
      expect(body.errors.validity_days).toBeDefined();
    }
  });

  it('can be issued without GST and switched back', async () => {
    const employee = await actingAsRole(ROLE.EMPLOYEE);

    const created = await create(employee, await payload({ include_gst: false })).expect(201);
    expect(created.body.data.include_gst).toBe(false);
    expect(created.body.data.tax_amount).toBe('0.00');
    expect(created.body.data.grand_total).toBe('6900.00');

    const updated = await as(employee)
      .put(`/api/v1/quotations/${created.body.data.id}`)
      .send(await payload({ include_gst: true }))
      .expect(200);
    expect(updated.body.data.include_gst).toBe(true);
    expect(updated.body.data.grand_total).toBe('8142.00');
  });

  it('requires only the client name, and limits validity', async () => {
    const employee = await actingAsRole(ROLE.EMPLOYEE);

    await create(employee, { client_name: 'Only Name', items: [await voiceOverItem()] }).expect(201);

    const { body } = await create(employee, await payload({ validity: '3_months' })).expect(422);
    expect(body.errors.validity).toBeDefined();
  });

  it('requires a client name and at least one line', async () => {
    const employee = await actingAsRole(ROLE.EMPLOYEE);

    const { body } = await create(employee, { items: [] }).expect(422);
    expect(body.errors.client_name).toBeDefined();
    expect(body.errors.items).toBeDefined();
  });

  it('validates client details', async () => {
    const employee = await actingAsRole(ROLE.EMPLOYEE);

    const { body } = await create(employee, await payload({ client_email: 'not-an-email', client_phone: 'call me', client_gstin: 'short' })).expect(422);
    expect(Object.keys(body.errors)).toEqual(expect.arrayContaining(['client_email', 'client_phone', 'client_gstin']));
  });

  it('saves nothing when only calculating', async () => {
    const employee = await actingAsRole(ROLE.EMPLOYEE);

    await as(employee).post('/api/v1/quotations/calculate').send({ items: [await voiceOverItem()] }).expect(200);

    const [{ n }] = await db.select({ n: count() }).from(quotations);
    expect(Number(n)).toBe(0);
  });

  describe('visibility', () => {
    it('shows an employee only their own quotations', async () => {
      const admin = await actingAsRole(ROLE.ADMIN);
      const theirs = await create(admin, await payload()).expect(201);

      const employee = await actingAsRole(ROLE.EMPLOYEE);
      const mine = await create(employee, await payload()).expect(201);

      const { body } = await as(employee).get('/api/v1/quotations').expect(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe(mine.body.data.id);

      await as(employee).get(`/api/v1/quotations/${theirs.body.data.id}`).expect(403);
    });

    it('shows an admin every quotation', async () => {
      const employee = await actingAsRole(ROLE.EMPLOYEE);
      await create(employee, await payload()).expect(201);

      const admin = await actingAsRole(ROLE.ADMIN);
      const { body } = await as(admin).get('/api/v1/quotations').expect(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].items_count).toBe(1);
    });

    it('answers an unknown or malformed id with 404', async () => {
      const admin = await actingAsRole(ROLE.ADMIN);
      await as(admin).get(`/api/v1/quotations/${randomUUID()}`).expect(404);
      await as(admin).get('/api/v1/quotations/not-an-id').expect(404);
    });
  });

  describe('lifecycle', () => {
    it('lets an employee edit their own draft, but not once it is sent', async () => {
      const employee = await actingAsRole(ROLE.EMPLOYEE);
      const created = await create(employee, await payload()).expect(201);
      const id = created.body.data.id;

      const updated = await as(employee)
        .put(`/api/v1/quotations/${id}`)
        .send(await payload({ items: [await voiceOverItem({ quantity: 2 })] }))
        .expect(200);
      expect(updated.body.data.subtotal).toBe('13800.00');

      await as(employee).patch(`/api/v1/quotations/${id}/status`).send({ status: 'sent' }).expect(200);
      await as(employee).put(`/api/v1/quotations/${id}`).send(await payload()).expect(403);
    });

    it('enforces the status transitions', async () => {
      const admin = await actingAsRole(ROLE.ADMIN);
      const created = await create(admin, await payload()).expect(201);
      const id = created.body.data.id;

      // A draft cannot jump straight to accepted
      const illegal = await as(admin).patch(`/api/v1/quotations/${id}/status`).send({ status: 'accepted' }).expect(422);
      expect(illegal.body.errors.status).toBeDefined();

      await as(admin).patch(`/api/v1/quotations/${id}/status`).send({ status: 'sent' }).expect(200);
      const accepted = await as(admin).patch(`/api/v1/quotations/${id}/status`).send({ status: 'accepted' }).expect(200);
      expect(accepted.body.data.next_statuses).toEqual(['cancelled']);

      // Accepted quotations are locked
      await as(admin).put(`/api/v1/quotations/${id}`).send(await payload()).expect(409);
    });

    it('only lets permitted roles delete', async () => {
      const employee = await actingAsRole(ROLE.EMPLOYEE);
      const created = await create(employee, await payload()).expect(201);
      const id = created.body.data.id;

      await as(employee).delete(`/api/v1/quotations/${id}`).expect(403);

      const admin = await actingAsRole(ROLE.ADMIN);
      await as(admin).delete(`/api/v1/quotations/${id}`).expect(204);

      // Soft-deleted: the row survives so the number is never reissued
      const [deleted] = await db.select().from(quotations).where(eq(quotations.id, id));
      expect(deleted).toBeDefined();
      expect(deleted.deletedAt).not.toBeNull();
      await as(admin).get(`/api/v1/quotations/${id}`).expect(404);
    });
  });

  it('re-prices when coordination assigns the video editor', async () => {
    await standardVideoEditingRate(800);

    const employee = await actingAsRole(ROLE.EMPLOYEE);
    const body = await payload({ items: [await videoEditingItem()] });

    // The editor the employee sent is ignored: 800 × 2 min × 2
    const created = await create(employee, body).expect(201);
    expect(created.body.data.items[0].snapshot.artist).toBeNull();
    expect(created.body.data.subtotal).toBe('3200.00');

    // A role with artists.assign opens the same draft and picks the editor
    const admin = await actingAsRole(ROLE.ADMIN);
    const updated = await as(admin).put(`/api/v1/quotations/${created.body.data.id}`).send(body).expect(200);
    expect(updated.body.data.items[0].snapshot.artist.code).toBe('VE_DEMO_001');
    expect(updated.body.data.subtotal).toBe('6000.00');
  });

  it('keeps historical names after master data changes', async () => {
    const admin = await actingAsRole(ROLE.ADMIN);
    const created = await create(admin, await payload()).expect(201);

    await db.update(artists).set({ name: 'Renamed Artist' }).where(eq(artists.code, 'VO_F_DP0002'));

    const { body } = await as(admin).get(`/api/v1/quotations/${created.body.data.id}`).expect(200);
    expect(body.data.items[0].snapshot.artist.name).toBe('Demo Voice Artist');
  });

  describe('lookups', () => {
    it('returns database-driven dropdowns, narrowed by permission', async () => {
      const employee = await actingAsRole(ROLE.EMPLOYEE);
      const { body } = await as(employee).get('/api/v1/lookups/quotation-form').expect(200);

      expect(body.data.services).toHaveLength(5);
      const services: Record<string, Record<string, unknown>> = Object.fromEntries(body.data.services.map((s: { slug: string }) => [s.slug, s]));

      // Voice over is open to employees...
      expect(services['voice-over'].fields).toEqual(['artist_id', 'language_id']);
      expect((services['voice-over'].artists as { code: string }[]).map((a) => a.code)).toContain('VO_F_DP0002');

      // ...while video editing reserves its editors, and doesn't ask for a language
      expect(services['video-editing'].artists).toEqual([]);
      expect(services['video-editing'].fields).toEqual(['video_type_id']);

      // Quoted at a price entered on the quotation
      expect(services['social-media-marketing'].is_quotable).toBe(true);
      expect(services['social-media-marketing'].fields).toEqual([]);
      expect(body.data.tax.rate).toBe(18);

      await as(employee).get('/api/v1/voice-artists').expect(200);
      await as(employee).get('/api/v1/video-editors').expect(403);
    });

    it('lists reserved artists for roles that may choose them', async () => {
      const admin = await actingAsRole(ROLE.ADMIN);
      const { body } = await as(admin).get('/api/v1/lookups/quotation-form').expect(200);

      const videoEditing = body.data.services.find((s: { slug: string }) => s.slug === 'video-editing');
      expect(videoEditing.fields).toContain('artist_id');
      expect((videoEditing.artists as { code: string }[]).map((a) => a.code)).toContain('VE_DEMO_001');

      await as(admin).get('/api/v1/video-editors').expect(200);
    });

    it('refuses to list every artist without the assign permission', async () => {
      const employee = await actingAsRole(ROLE.EMPLOYEE);
      await as(employee).get('/api/v1/artists').expect(403);
    });
  });

  describe('assigning the video editor', () => {
    /** An employee's draft with one video editing line at the 800/min standard rate: 800 × 2 min × 2 = 3,200 */
    const employeeDraft = async () => {
      await standardVideoEditingRate(800);
      const employee = await actingAsRole(ROLE.EMPLOYEE);
      const { body } = await create(employee, await payload({ items: [await videoEditingItem()] })).expect(201);
      return { employee, quotation: body.data };
    };

    const assign = (actor: Actor, quotation: { id: string; items: { id: string }[] }, artist: string | null) =>
      as(actor).patch(`/api/v1/quotations/${quotation.id}/items/${quotation.items[0].id}/artist`).send({ artist_id: artist });

    it('leaves the editor unassigned when an employee writes the quotation', async () => {
      const { quotation } = await employeeDraft();
      expect(quotation.items[0].artist_id).toBeNull();
      expect(quotation.subtotal).toBe('3200.00');
    });

    it('lists unassigned lines for coordination, and lets them assign without repricing', async () => {
      const { quotation } = await employeeDraft();
      const manager = await actingAsRole(ROLE.MANAGER);

      const pending = await as(manager).get('/api/v1/quotations/artist-assignments').expect(200);
      expect(pending.body.total).toBe(1);
      expect(pending.body.data[0].id).toBe(quotation.id);
      expect(pending.body.data[0].lines[0].id).toBe(quotation.items[0].id);

      // The demo editor's own rate is 1,500/min, but assigning never changes the quoted price
      const { body } = await assign(manager, quotation, await artistId('VE_DEMO_001')).expect(200);
      expect(body.data.items[0].snapshot.artist.code).toBe('VE_DEMO_001');
      expect(body.data.items[0].description).toContain('VE_DEMO_001');
      expect(body.data.subtotal).toBe('3200.00');

      const after = await as(manager).get('/api/v1/quotations/artist-assignments').expect(200);
      expect(after.body.total).toBe(0);
    });

    it('does not let an employee see or make assignments', async () => {
      const { employee, quotation } = await employeeDraft();

      await as(employee).get('/api/v1/quotations/artist-assignments').expect(403);
      await assign(employee, quotation, await artistId('VE_DEMO_001')).expect(403);
    });

    it('keeps the assigned editor when the employee re-saves, but ignores one they pick', async () => {
      const { employee, quotation } = await employeeDraft();
      const coordination = await actingAsRole(ROLE.ADMIN);
      const assigned = await artistId('VE_DEMO_001');

      await assign(coordination, quotation, assigned).expect(200);

      const line: Line = { ...(await videoEditingItem()), artist_id: assigned };
      const kept = await as(employee).put(`/api/v1/quotations/${quotation.id}`).send(await payload({ items: [line] })).expect(200);
      expect(kept.body.data.items[0].artist_id).toBe(assigned);

      const other = { ...line, artist_id: await artistId('TJ_10_VE') };
      const ignored = await as(employee).put(`/api/v1/quotations/${quotation.id}`).send(await payload({ items: [other] })).expect(200);
      expect(ignored.body.data.items[0].artist_id).toBeNull();
    });

    it('refuses an editor who does not do video editing, and cancelled quotations', async () => {
      const { quotation } = await employeeDraft();
      const admin = await actingAsRole(ROLE.ADMIN);

      const voiceArtist = await assign(admin, quotation, await artistId('VO_F_DP0002')).expect(422);
      expect(voiceArtist.body.errors.artist_id).toBeDefined();

      await as(admin).patch(`/api/v1/quotations/${quotation.id}/status`).send({ status: 'cancelled' }).expect(200);
      await assign(admin, quotation, await artistId('VE_DEMO_001')).expect(409);
    });
  });

  it('filters the list by status and search term', async () => {
    const admin = await actingAsRole(ROLE.ADMIN);

    const draft = await create(admin, await payload()).expect(201);
    await create(admin, await payload({ client_name: 'Different Client' })).expect(201);
    await as(admin).patch(`/api/v1/quotations/${draft.body.data.id}/status`).send({ status: 'sent' }).expect(200);

    const sent = await as(admin).get('/api/v1/quotations?status=sent').expect(200);
    expect(sent.body.data).toHaveLength(1);
    expect(sent.body.data[0].id).toBe(draft.body.data.id);

    const searched = await as(admin).get('/api/v1/quotations?search=Different').expect(200);
    expect(searched.body.data).toHaveLength(1);
    expect(searched.body.data[0].client_name).toBe('Different Client');
  });

  it('links a quotation to the CRM lead it was written for', async () => {
    const employee = await actingAsRole(ROLE.EMPLOYEE);
    const [lead] = await db.insert(leads).values({ companyName: 'Lead Co', phone: '9876543210' }).returning();

    const created = await create(employee, await payload({ client_name: 'Lead Co', lead_id: lead.id })).expect(201);
    expect(created.body.data.lead_id).toBe(lead.id);
    await create(employee, await payload()).expect(201);

    const forLead = await as(employee).get(`/api/v1/quotations?lead_id=${lead.id}`).expect(200);
    expect(forLead.body.data.map((q: { id: string }) => q.id)).toEqual([created.body.data.id]);

    // Editing without lead_id keeps the link
    const updated = await as(employee).put(`/api/v1/quotations/${created.body.data.id}`).send(await payload({ client_name: 'Lead Co' })).expect(200);
    expect(updated.body.data.lead_id).toBe(lead.id);

    const { body } = await create(employee, await payload({ lead_id: randomUUID() })).expect(422);
    expect(body.message).toEqual(expect.any(String));
  });

  it('re-saves a quotation with a fixed-price line exactly as it was sent back', async () => {
    const admin = await actingAsRole(ROLE.ADMIN);
    const website = { service_id: await serviceIdOf('website'), custom_price: 25000, quantity: 1 };
    const created = await create(admin, await payload({ items: [await voiceOverItem(), website] })).expect(201);

    // The edit screen sends each saved line back, including the per-unit line's 0.00 minutes
    const lines = created.body.data.items.map((i: Record<string, unknown>) => ({
      service_id: i.service_id, artist_id: i.artist_id, language_id: i.language_id, duration_id: i.duration_id,
      duration_minutes: i.duration_minutes, quantity: i.quantity, custom_price: i.custom_price,
    }));
    const updated = await as(admin).put(`/api/v1/quotations/${created.body.data.id}`).send(await payload({ items: lines })).expect(200);
    expect(updated.body.data.grand_total).toBe(created.body.data.grand_total);
  });

  it('treats search wildcards literally', async () => {
    const admin = await actingAsRole(ROLE.ADMIN);
    await create(admin, await payload()).expect(201);

    const { body } = await as(admin).get('/api/v1/quotations?search=%25').expect(200);
    expect(body.data).toHaveLength(0);
  });

  it('cannot be created by a role without quotations.create', async () => {
    const hr = await actingAsRole(ROLE.HR);
    await create(hr, await payload()).expect(403);
  });

  it('rejects a service the caller invented', async () => {
    const employee = await actingAsRole(ROLE.EMPLOYEE);
    const line: Line = { ...(await voiceOverItem()), service_id: randomUUID() };

    const { body } = await create(employee, await payload({ items: [line] })).expect(422);
    expect(body.errors['items.0.service_id']).toBeDefined();
  });

  it('records the service on each saved line', async () => {
    const admin = await actingAsRole(ROLE.ADMIN);
    const created = await create(admin, await payload()).expect(201);

    expect(created.body.data.items[0].service_id).toBe(await serviceIdOf(SERVICE_VOICE_OVER));
  });

  /** The dashboard cards link into this list, so each filter must select exactly the quotations its card counted */
  describe('filters the dashboard cards link to', () => {
    const backdate = (id: string, createdAt: Date) => db.update(quotations).set({ createdAt }).where(eq(quotations.id, id));

    it('accepts several statuses at once', async () => {
      const admin = await actingAsRole(ROLE.ADMIN);

      const draft = await create(admin, await payload({ client_name: 'Draft Co' })).expect(201);
      const sent = await create(admin, await payload({ client_name: 'Sent Co' })).expect(201);
      const cancelled = await create(admin, await payload({ client_name: 'Cancelled Co' })).expect(201);

      await as(admin).patch(`/api/v1/quotations/${sent.body.data.id}/status`).send({ status: 'sent' }).expect(200);
      await as(admin).patch(`/api/v1/quotations/${cancelled.body.data.id}/status`).send({ status: 'cancelled' }).expect(200);

      // "Pending quotations" — draft or sent
      const { body } = await as(admin).get('/api/v1/quotations?status=draft,sent').expect(200);
      const ids = body.data.map((q: { id: string }) => q.id).sort();
      expect(ids).toEqual([draft.body.data.id, sent.body.data.id].sort());

      const invalid = await as(admin).get('/api/v1/quotations?status=draft,nonsense').expect(422);
      expect(invalid.body.errors).toBeDefined();
    });

    it('filters dates by the calendar day in India, not UTC', async () => {
      const admin = await actingAsRole(ROLE.ADMIN);

      // 02:00 IST on 17 September is still 16 September in UTC
      const lateNight = await create(admin, await payload({ client_name: 'Late Night Co' })).expect(201);
      await backdate(lateNight.body.data.id, new Date('2026-09-16T20:30:00.000Z'));

      // 23:00 IST on 16 September
      const evening = await create(admin, await payload({ client_name: 'Evening Co' })).expect(201);
      await backdate(evening.body.data.id, new Date('2026-09-16T17:30:00.000Z'));

      const onThe17th = await as(admin).get('/api/v1/quotations?from=2026-09-17&to=2026-09-17').expect(200);
      expect(onThe17th.body.data.map((q: { client_name: string }) => q.client_name)).toEqual(['Late Night Co']);

      const onThe16th = await as(admin).get('/api/v1/quotations?from=2026-09-16&to=2026-09-16').expect(200);
      expect(onThe16th.body.data.map((q: { client_name: string }) => q.client_name)).toEqual(['Evening Co']);
    });

    it("shows the same quotations the dashboard counts as today's", async () => {
      const admin = await actingAsRole(ROLE.ADMIN);

      await create(admin, await payload({ client_name: 'Today Co' })).expect(201);
      const old = await create(admin, await payload({ client_name: 'Last Week Co' })).expect(201);
      await backdate(old.body.data.id, new Date(Date.now() - 8 * 86_400_000));

      const dashboard = await as(admin).get('/api/v1/dashboard').expect(200);
      const todayDay = dashboard.body.data.daily_summary.at(-1).date;

      const list = await as(admin).get(`/api/v1/quotations?from=${todayDay}&to=${todayDay}`).expect(200);
      expect(dashboard.body.data.metrics.todays_quotations).toBe(1);
      expect(list.body.meta.total).toBe(dashboard.body.data.metrics.todays_quotations);
      expect(list.body.data[0].client_name).toBe('Today Co');
    });
  });
});
