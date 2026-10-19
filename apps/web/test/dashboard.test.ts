import { beforeEach, describe, expect, it } from 'vitest';
import { clients, invoices, leads, projects, quotations, type QuotationStatus } from '../src/server/db/schema';
import { ROLE, actingAsRole, api, as, db, resetDb, seedTestCatalog, type Actor } from './harness';

describe('Quotation dashboard', () => {
  beforeEach(async () => {
    await resetDb();
    await seedTestCatalog();
  });

  /** A quotation written straight to the table, bypassing pricing */
  const makeQuotation = (creatorId: string, status: QuotationStatus, total: string) =>
    db.insert(quotations).values({ status, clientName: 'Client', subtotal: total, grandTotal: total, createdBy: creatorId });

  it('answers a request with no token as JSON', async () => {
    const { body } = await api().get('/api/v1/dashboard').expect(401);
    expect(body.message).toEqual(expect.any(String));
  });

  it('shows an admin company-wide figures', async () => {
    const other = await actingAsRole(ROLE.EMPLOYEE);
    await makeQuotation(other.userId, 'accepted', '1000.00');
    await makeQuotation(other.userId, 'sent', '500.00');
    // Cancelled quotations are excluded from the open value
    await makeQuotation(other.userId, 'cancelled', '900.00');

    const admin: Actor = await actingAsRole(ROLE.ADMIN);
    const { body } = await as(admin).get('/api/v1/dashboard').expect(200);

    expect(body.data.scope).toBe('company');
    expect(body.data.metrics.pending_quotations).toBe(1);
    expect(body.data.metrics.accepted_quotations).toBe(1);
    expect(body.data.metrics.todays_quotations).toBe(3);
    expect(body.data.metrics.total_quotation_value).toBe('1500.00');
    expect(body.data.daily_summary).toHaveLength(7);
    expect(body.data.daily_summary.at(-1).count).toBe(3);
  });

  it('shows an employee only their own quotations', async () => {
    const other = await actingAsRole(ROLE.ADMIN);
    await makeQuotation(other.userId, 'accepted', '1000.00');

    const employee = await actingAsRole(ROLE.EMPLOYEE);
    await makeQuotation(employee.userId, 'draft', '250.00');

    const { body } = await as(employee).get('/api/v1/dashboard').expect(200);
    expect(body.data.scope).toBe('personal');
    expect(body.data.metrics.accepted_quotations).toBe(0);
    expect(body.data.metrics.pending_quotations).toBe(1);
    expect(body.data.metrics.total_quotation_value).toBe('250.00');
  });

  it('refuses a role without dashboard.view', async () => {
    const superAdmin = await actingAsRole(ROLE.SUPER_ADMIN);
    const created = await as(superAdmin).post('/api/v1/admin/roles').send({ name: 'No Access', permissions: [] }).expect(201);

    const stranger = await actingAsRole(created.body.data.slug);
    await as(stranger).get('/api/v1/dashboard').expect(403);
  });

  it('breaks quotations down by status and by service', async () => {
    const admin = await actingAsRole(ROLE.ADMIN);
    await makeQuotation(admin.userId, 'draft', '100.00');

    const { body } = await as(admin).get('/api/v1/dashboard').expect(200);
    expect(body.data.quotations_by_status).toHaveLength(5);
    expect(body.data.quotations_by_status.find((row: { status: string }) => row.status === 'draft').count).toBe(1);
    // No lines were written, so nothing is attributed to a service yet
    expect(body.data.quotations_by_service).toEqual([]);
  });
});

describe('Main dashboard cards', () => {
  beforeEach(resetDb);

  it('lists exactly the records each card counts', async () => {
    const admin = await actingAsRole('SUPER_ADMIN');
    const [acme, beta] = await db
      .insert(clients)
      .values([
        { companyName: 'Acme', contactName: 'A', portalLogin: 'acme' },
        { companyName: 'Beta', contactName: 'B', portalLogin: 'beta' },
      ])
      .returning();
    await db.insert(projects).values([
      { projectName: 'Jingle', clientId: acme.id, clientName: 'Acme', projectStatus: 'ACTIVE' },
      { projectName: 'Dub', clientId: acme.id, clientName: 'Acme', projectStatus: 'ON_HOLD' },
      { projectName: 'Old ad', clientId: beta.id, clientName: 'Beta', projectStatus: 'COMPLETED' },
    ]);
    await db.insert(leads).values([
      { companyName: 'Open Co', stage: 'CONTACTED' },
      { companyName: 'Won Co', stage: 'WON' },
    ]);
    const now = new Date();
    await db.insert(invoices).values([
      { invoiceNumber: 'INV-1', clientId: acme.id, amount: 1000, grandTotal: 1180, status: 'paid', paidAt: now },
      { invoiceNumber: 'INV-2', clientId: beta.id, amount: 500, status: 'sent' },
    ]);

    const { body } = await as(admin).get('/api/dashboard').expect(200);
    const details = async (kind: string) => (await as(admin).get(`/api/dashboard/details/${kind}`).expect(200)).body.rows;

    const active = await details('projects');
    expect(active.map((p: { name: string }) => p.name).sort()).toEqual(['Dub', 'Jingle']);
    expect(active).toHaveLength(body.kpis.activeProjects);
    const open = await details('leads');
    expect(open.map((l: { company: string }) => l.company)).toEqual(['Open Co']);
    expect(open).toHaveLength(body.kpis.openLeads);
    // Beta's only project is completed, so only Acme counts
    const activeClients = await details('clients');
    expect(activeClients.map((c: { company: string }) => c.company)).toEqual(['Acme']);
    expect(activeClients[0].activeProjects).toBe(2);
    expect(body.kpis.activeClients).toBe(1);
    const paid = await details('revenue');
    expect(paid.map((r: { number: string }) => r.number)).toEqual(['INV-1']);
    expect(paid.reduce((s: number, r: { total: number }) => s + r.total, 0)).toBe(body.kpis.revenueMTD);

    // Staff outside management see no company-wide lists
    const member = await actingAsRole('TEAM_MEMBER');
    expect((await as(member).get('/api/dashboard/details/leads').expect(200)).body.rows).toEqual([]);
    await as(admin).get('/api/dashboard/details/nope').expect(404);
  });
});
