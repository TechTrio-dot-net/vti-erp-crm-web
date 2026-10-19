import { beforeEach, describe, expect, it } from 'vitest';
import { ROLE, actingAsRole, as, resetDb, seedTestCatalog, voiceOverItem, type Actor } from './harness';

/** The smallest valid PNG, as a stand-in for a payment screenshot */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('Payments', () => {
  beforeEach(async () => {
    await resetDb();
    await seedTestCatalog();
  });

  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

  /** A sent quotation for 8,142.00 (6,900 + 18% GST), created by `actor` */
  const sentQuotation = async (actor: Actor) => {
    const created = await as(actor)
      .post('/api/v1/quotations')
      .send({ client_name: 'Asha Mehta', items: [await voiceOverItem()] })
      .expect(201);
    const manager = await actingAsRole(ROLE.MANAGER);
    await as(manager).patch(`/api/v1/quotations/${created.body.data.id}/status`).send({ status: 'sent' }).expect(200);
    return created.body.data as { id: string; grand_total: string };
  };

  /** Records a payment, with a screenshot unless `attach` is null */
  const record = (actor: Actor, quotationId: string, fields: Record<string, string>, attach: Buffer | null = PNG) => {
    const req = as(actor).post(`/api/v1/quotations/${quotationId}/payments`);
    const values = { received_by: 'khushali', method: 'gpay', paid_on: today(), ...fields };
    for (const [key, value] of Object.entries(values)) req.field(key, value);
    if (attach) req.attach('attachment', attach, { filename: 'gpay.png', contentType: 'image/png' });
    return req;
  };

  it('lets an employee record part payments with a screenshot, then complete the payment', async () => {
    const employee = await actingAsRole(ROLE.EMPLOYEE);
    const quotation = await sentQuotation(employee);

    const first = await record(employee, quotation.id, { amount: '5000', reference: 'UPI 1234' }).expect(201);
    expect(first.body.data.summary).toMatchObject({ paid: '5000.00', pending: '3142.00', status: 'partial', can_record: true });
    expect(first.body.data.payments[0]).toMatchObject({ received_by_label: "Khushali Ma'am", method_label: 'G-Pay', reference: 'UPI 1234' });
    expect(first.body.data.payments[0].attachment.mime).toBe('image/png');

    const screenshot = await as(employee).get(`/api/v1/payments/${first.body.data.payments[0].id}/attachment`).expect(200);
    expect(screenshot.headers['content-type']).toBe('image/png');

    // More than is pending is refused
    const over = await record(employee, quotation.id, { amount: '4000', received_by: 'cash', method: 'cash' }).expect(422);
    expect(over.body.errors.amount[0]).toContain('3142.00');

    // Completing early is refused
    await as(employee).post(`/api/v1/quotations/${quotation.id}/payments/complete`).expect(409);

    const rest = await record(employee, quotation.id, { amount: '3142', received_by: 'alka', method: 'custom', method_detail: 'Paytm' }).expect(201);
    expect(rest.body.data.summary).toMatchObject({ paid: '8142.00', pending: '0.00', status: 'paid' });
    expect(rest.body.data.payments.map((p: { method_label: string }) => p.method_label)).toContain('Paytm');

    const done = await as(employee).post(`/api/v1/quotations/${quotation.id}/payments/complete`).expect(201);
    expect(done.body.data.summary.status).toBe('completed');
    expect(done.body.data.summary.can_record).toBe(false);

    // Closed: no more payments until it is reopened
    await record(employee, quotation.id, { amount: '1' }).expect(409);
    const reopened = await as(employee).delete(`/api/v1/quotations/${quotation.id}/payments/complete`).expect(200);
    expect(reopened.body.data.summary.status).toBe('paid');

    const shown = await as(employee).get(`/api/v1/quotations/${quotation.id}`).expect(200);
    expect(shown.body.data.payment.paid).toBe('8142.00');
  });

  it('lists quotations with their payment status and totals', async () => {
    const admin = await actingAsRole(ROLE.ADMIN);
    const unpaid = await sentQuotation(admin);
    const partial = await sentQuotation(admin);
    await record(admin, partial.id, { amount: '1000' }).expect(201);

    const all = await as(admin).get('/api/v1/payments').expect(200);
    expect(all.body.summary).toMatchObject({ quotations: 2, unpaid: 1, partial: 1, received: '1000.00', pending: '15284.00' });

    const pending = await as(admin).get('/api/v1/payments?status=partial').expect(200);
    expect(pending.body.data.map((row: { id: string }) => row.id)).toEqual([partial.id]);
    expect(pending.body.data[0].payment.status).toBe('partial');
    expect(unpaid.id).not.toBe(partial.id);
  });

  it('keeps employees to their own quotations', async () => {
    const owner = await actingAsRole(ROLE.EMPLOYEE);
    const other = await actingAsRole(ROLE.EMPLOYEE);
    const quotation = await sentQuotation(owner);

    await record(other, quotation.id, { amount: '100' }).expect(403);

    const listed = await as(other).get('/api/v1/payments').expect(200);
    expect(listed.body.data).toEqual([]);
  });

  it('validates the payment details and the screenshot', async () => {
    const admin = await actingAsRole(ROLE.ADMIN);
    const quotation = await sentQuotation(admin);

    const invalid = await record(admin, quotation.id, { amount: '0', received_by: 'someone', method: 'custom', paid_on: 'yesterday' }).expect(422);
    expect(Object.keys(invalid.body.errors)).toEqual(expect.arrayContaining(['amount', 'received_by', 'method_detail', 'paid_on']));

    const future = await record(admin, quotation.id, { amount: '10', paid_on: '2999-01-01' }).expect(422);
    expect(future.body.errors.paid_on).toBeDefined();

    const notAnImage = await record(admin, quotation.id, { amount: '10' }, Buffer.from('<svg onload="alert(1)"/>')).expect(422);
    expect(notAnImage.body.errors.attachment).toBeDefined();

    // The screenshot is required
    const missing = await record(admin, quotation.id, { amount: '10' }, null).expect(422);
    expect(missing.body.errors.attachment).toBeDefined();
    const shown = await as(admin).get(`/api/v1/quotations/${quotation.id}/payments`).expect(200);
    expect(shown.body.data.payments).toEqual([]);
  });

  it('lets the recorder remove a payment, and recalculates what is paid', async () => {
    const employee = await actingAsRole(ROLE.EMPLOYEE);
    const quotation = await sentQuotation(employee);
    const recorded = await record(employee, quotation.id, { amount: '2000' }).expect(201);

    const removed = await as(employee).delete(`/api/v1/payments/${recorded.body.data.payments[0].id}`).expect(200);
    expect(removed.body.data.summary).toMatchObject({ paid: '0.00', status: 'unpaid' });
    expect(removed.body.data.payments).toEqual([]);
  });

  it('refuses payments on cancelled quotations', async () => {
    const admin = await actingAsRole(ROLE.ADMIN);
    const quotation = await sentQuotation(admin);
    await as(admin).patch(`/api/v1/quotations/${quotation.id}/status`).send({ status: 'cancelled' }).expect(200);

    await record(admin, quotation.id, { amount: '100' }).expect(409);
  });
});
