import { Router } from 'express';
import { count, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { clients, leads } from '../db/schema';
import { authMiddleware, requirePermission, AuthRequest } from '../lib/auth';
import { pickColumns, sendError, uuidParam } from '../lib/http';
import { toApi } from '../lib/serialize';

const router = Router();
router.use(authMiddleware);
router.param('id', uuidParam);

const EDITABLE_FIELDS = ['companyName', 'contactName', 'contactEmail', 'phone', 'address', 'portalLogin'] as const;

/** Portal login from an email or phone; adds a numeric suffix when another client already uses it */
async function uniquePortalLogin(seed: string): Promise<string> {
  const base = seed.toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'client';
  const [{ taken }] = await db
    .select({ taken: count() })
    .from(clients)
    .where(sql`${clients.portalLogin} = ${base} OR ${clients.portalLogin} LIKE ${base + '-%'}`);
  return taken ? `${base}-${taken + 1}` : base;
}

/**
 * Every won (closed) CRM lead becomes a client, so it shows in Sales → Clients. A lead whose email or
 * phone matches an existing client is linked to that client instead of creating a duplicate.
 */
export async function syncWonLeadClients(): Promise<void> {
  const pending = await db
    .select({ id: leads.id, companyName: leads.companyName, contactName: leads.contactName, email: leads.email, phone: leads.phone, city: leads.city })
    .from(leads)
    .where(sql`${leads.stage} = 'WON' AND ${leads.clientId} IS NULL`)
    .limit(500);

  for (const lead of pending) {
    try {
      const email = lead.email?.trim().toLowerCase() || null;
      const digits = lead.phone?.replace(/\D/g, '').slice(-10) || null;
      const [existing] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(
          email || digits
            ? sql`(${email}::text IS NOT NULL AND lower(${clients.contactEmail}) = ${email})
                OR (${digits}::text IS NOT NULL AND right(regexp_replace(coalesce(${clients.phone}, ''), '[^0-9]', '', 'g'), 10) = ${digits})`
            : sql`false`
        )
        .limit(1);

      let clientId = existing?.id;
      if (!clientId) {
        const name = lead.companyName.trim() || lead.contactName?.trim() || 'Client';
        const [created] = await db
          .insert(clients)
          .values({
            companyName: name,
            contactName: lead.contactName?.trim() || name,
            contactEmail: email,
            phone: lead.phone?.trim() || null,
            address: lead.city?.trim() || null,
            portalLogin: await uniquePortalLogin(email?.split('@')[0] || digits || name),
          })
          .returning({ id: clients.id });
        clientId = created.id;
      }
      await db.update(leads).set({ clientId }).where(eq(leads.id, lead.id));
    } catch (err) {
      console.error('[Clients] Could not create a client from won lead', lead.id, (err as Error).message);
    }
  }
}

router.get('/', requirePermission('clients', 'read'), async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    if (authReq.user?.role !== 'CLIENT') await syncWonLeadClients();
    let where;
    if (authReq.user?.role === 'CLIENT') {
      where = authReq.user.clientId ? eq(clients.id, authReq.user.clientId) : sql`false`;
    }
    // Per-client CRM stats computed in the same query (correlated subqueries use the FK indexes).
    // Written with explicit aliases: Drizzle renders ${column} unqualified here, which would bind to the inner table.
    const rows = await db
      .select({
        ...getTableColumns(clients),
        projectCount: sql<number>`(select count(*)::int from projects p where p.client_id = "clients"."id")`,
        activeProjectCount: sql<number>`(select count(*)::int from projects p where p.client_id = "clients"."id" and p.project_status = 'ACTIVE')`,
        // Won CRM deals behind this client
        fromCrm: sql<boolean>`exists(select 1 from leads l where l.client_id = "clients"."id" and l.stage = 'WON')`,
        dealValue: sql<number>`(select coalesce(sum(l.estimated_value), 0)::float8 from leads l where l.client_id = "clients"."id" and l.stage = 'WON')`,
        wonAt: sql<string | null>`(select max(l.closed_at) from leads l where l.client_id = "clients"."id" and l.stage = 'WON')`,
        bdmName: sql<string | null>`(select u.name from leads l join users u on u.id = l.assigned_to where l.client_id = "clients"."id" and l.stage = 'WON' order by l.closed_at desc nulls last limit 1)`,
        // Production follow-ups still open across this client's projects
        openSteps: sql<number>`(select count(*)::int from projects p, jsonb_array_elements(p.workflow) w where p.client_id = "clients"."id" and w->>'status' <> 'DONE')`,
      })
      .from(clients)
      .where(where)
      .orderBy(desc(clients.createdAt));
    res.json(toApi(rows));
  } catch (err) {
    sendError(res, err, 'Failed to fetch clients');
  }
});

router.get('/:id', requirePermission('clients', 'read'), async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const [client] = await db.select().from(clients).where(eq(clients.id, req.params.id as string)).limit(1);
    if (!client) return res.status(404).json({ message: 'Client not found' });
    if (authReq.user?.role === 'CLIENT' && authReq.user.clientId !== client.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    res.json(toApi(client));
  } catch (err) {
    sendError(res, err, 'Failed to fetch client');
  }
});

router.post('/', requirePermission('clients', 'create'), async (req, res) => {
  try {
    const values = pickColumns(clients, req.body, ['companyName', 'contactName', 'contactEmail', 'phone', 'address']);
    if (!values.companyName?.trim() || !(values.contactEmail?.trim() || values.phone?.trim())) {
      return res.status(400).json({ message: 'Company name and an email or phone number are required' });
    }
    const contactEmail = values.contactEmail?.trim().toLowerCase() || null;
    const [client] = await db
      .insert(clients)
      .values({
        ...values,
        companyName: values.companyName.trim(),
        contactName: values.contactName?.trim() || values.companyName.trim(),
        contactEmail,
        portalLogin: await uniquePortalLogin(contactEmail?.split('@')[0] || values.phone!.replace(/\D/g, '')),
      })
      .returning();
    res.status(201).json(toApi(client));
  } catch (err) {
    sendError(res, err, 'Failed to create client');
  }
});

router.delete('/:id', requirePermission('clients', 'delete'), async (req, res) => {
  try {
    const [deleted] = await db.delete(clients).where(eq(clients.id, req.params.id as string)).returning({ id: clients.id });
    if (!deleted) return res.status(404).json({ message: 'Client not found' });
    res.json({ ok: true });
  } catch (err) {
    // Projects and invoices reference clients with ON DELETE RESTRICT
    if ((err as { cause?: { code?: string } })?.cause?.code === '23503') {
      return res.status(409).json({ message: 'This client still has projects. Remove those first.' });
    }
    sendError(res, err, 'Failed to delete client');
  }
});

router.put('/:id', requirePermission('clients', 'update'), async (req, res) => {
  try {
    const updates = pickColumns(clients, req.body, EDITABLE_FIELDS);
    const [client] = await db
      .update(clients)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(clients.id, req.params.id as string))
      .returning();
    if (!client) return res.status(404).json({ message: 'Client not found' });
    res.json(toApi(client));
  } catch (err) {
    sendError(res, err, 'Failed to update client');
  }
});

export default router;
