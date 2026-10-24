import { Router } from 'express';
import { and, count, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index';
import { clients, leads } from '../db/schema';
import { authMiddleware, requirePermission, AuthRequest } from '../lib/auth';
import { HttpError, pickColumns, sendError, uuidParam } from '../lib/http';
import { pick } from '../lib/scopes';
import { toApi } from '../lib/serialize';

const router = Router();
router.use(authMiddleware);
router.param('id', uuidParam);

const STAGES = ['AWARENESS', 'CONTACTED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'];
const OPEN_STAGES = STAGES.filter((s) => s !== 'WON' && s !== 'LOST');
const CLOSED_STAGES = ['WON', 'LOST'];
const FOLLOW_UP_AFTER_DAYS = 7;
const EDITABLE_FIELDS = [
  'companyName',
  'contactName',
  'email',
  'phone',
  'source',
  'service',
  'stage',
  'assignedTo',
  'estimatedValue',
  'notes',
  'clientId',
] as const;

function validateStage(stage: unknown) {
  if (stage !== undefined && !STAGES.includes(stage as string)) throw new HttpError(400, 'Invalid stage');
}

type LeadRow = typeof leads.$inferSelect & { assignee: { id: string; name: string; initials: string | null } | null };

function toLeadResponse(l: LeadRow) {
  const lastTouch = l.lastContactAt ?? l.createdAt;
  return {
    ...toApi(l),
    // Fields the pipeline table has always used
    company: l.companyName,
    service: l.service || '—',
    estimatedValue: l.estimatedValue || 0,
    owner: toApi(l.assignee),
    needsFollowUp:
      OPEN_STAGES.includes(l.stage) && Date.now() - lastTouch.getTime() > FOLLOW_UP_AFTER_DAYS * 86_400_000,
  };
}

router.get('/', requirePermission('clients', 'read'), async (req: AuthRequest, res) => {
  try {
    const scope: SQL[] = req.user?.role === 'SALES' ? [eq(leads.assignedTo, req.user!.id)] : [];
    const view = req.query.view === 'closed' ? 'closed' : req.query.view === 'all' ? 'all' : 'open';
    const stageFilter =
      view === 'open' ? [inArray(leads.stage, OPEN_STAGES)] : view === 'closed' ? [inArray(leads.stage, CLOSED_STAGES)] : [];

    const now = new Date();
    const [rows, counts, [won]] = await Promise.all([
      db.query.leads.findMany({
        where: and(...scope, ...stageFilter),
        with: { assignee: pick.userName },
        orderBy: [desc(leads.updatedAt)],
      }),
      db
        .select({ stage: leads.stage, count: count(), value: sql<number>`coalesce(sum(${leads.estimatedValue}), 0)::float8` })
        .from(leads)
        .where(and(...scope))
        .groupBy(leads.stage),
      db
        .select({ count: count() })
        .from(leads)
        .where(
          and(
            ...scope,
            eq(leads.stage, 'WON'),
            gte(leads.updatedAt, new Date(now.getFullYear(), now.getMonth(), 1)),
            lt(leads.updatedAt, new Date(now.getFullYear(), now.getMonth() + 1, 1))
          )
        ),
    ]);

    const byStage = new Map(counts.map((c) => [c.stage, c]));

    res.json({
      leads: rows.map(toLeadResponse),
      // `counts` keeps its original shape (open stages only); `stages` covers the whole pipeline
      counts: OPEN_STAGES.map((s) => ({ _id: s, count: byStage.get(s)?.count ?? 0 })),
      stages: STAGES.map((s) => ({ stage: s, count: byStage.get(s)?.count ?? 0, value: byStage.get(s)?.value ?? 0 })),
      wonMTD: won?.count ?? 0,
    });
  } catch (err) {
    sendError(res, err, 'Failed to fetch leads');
  }
});

async function findLead(id: string) {
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, id), with: { assignee: pick.userName } });
  return lead ? toLeadResponse(lead) : null;
}

router.post('/', requirePermission('clients', 'create'), async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const values = pickColumns(leads, req.body, EDITABLE_FIELDS);
    validateStage(values.stage);
    const [lead] = await db
      .insert(leads)
      .values({
        ...values,
        companyName: values.companyName || 'Unknown',
        source: values.source || 'website',
        service: values.service || 'General',
        stage: values.stage || 'AWARENESS',
        assignedTo: values.assignedTo || authReq.user!.id,
        estimatedValue: values.estimatedValue || 0,
        createdBy: authReq.user!.id,
      })
      .returning({ id: leads.id });
    res.status(201).json(await findLead(lead.id));
  } catch (err) {
    sendError(res, err, 'Failed to create lead');
  }
});

router.patch('/:id', requirePermission('clients', 'update'), async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const updates = pickColumns(leads, req.body, EDITABLE_FIELDS);
    validateStage(updates.stage);
    const [updated] = await db
      .update(leads)
      .set({ ...updates, updatedBy: authReq.user!.id, lastContactAt: new Date() })
      .where(eq(leads.id, req.params.id as string))
      .returning({ id: leads.id });
    if (!updated) return res.status(404).json({ message: 'Lead not found' });
    res.json(await findLead(updated.id));
  } catch (err) {
    sendError(res, err, 'Failed to update lead');
  }
});

/** Won deal → client record. Links the lead to the (new or existing) client and marks it WON. */
router.post('/:id/convert', requirePermission('clients', 'create'), async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const id = req.params.id as string;
    const result = await db.transaction(async (tx) => {
      const [lead] = await tx.select().from(leads).where(eq(leads.id, id)).limit(1).for('update');
      if (!lead) throw new HttpError(404, 'Lead not found');
      if (lead.clientId) throw new HttpError(409, 'This lead has already been converted');

      const contactEmail = (req.body?.contactEmail || lead.email || '').trim().toLowerCase();
      if (!contactEmail) throw new HttpError(400, 'An email address is needed to create the client');

      // Reuse an existing client with the same email instead of failing on the unique constraint
      let [client] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.contactEmail, contactEmail)).limit(1);
      if (!client) {
        const base = contactEmail.split('@')[0].replace(/[^a-z0-9._-]/g, '') || 'client';
        const [{ taken }] = await tx
          .select({ taken: count() })
          .from(clients)
          .where(sql`${clients.portalLogin} = ${base} OR ${clients.portalLogin} LIKE ${base + '-%'}`);
        [client] = await tx
          .insert(clients)
          .values({
            companyName: lead.companyName,
            contactName: req.body?.contactName || lead.contactName || lead.companyName,
            contactEmail,
            phone: lead.phone,
            portalLogin: taken ? `${base}-${taken + 1}` : base,
          })
          .returning({ id: clients.id });
      }

      await tx
        .update(leads)
        // closed_at is what the reports date a win by, so stamp it here too (keeping it if the deal was already closed)
        .set({ stage: 'WON', clientId: client.id, email: contactEmail, updatedBy: authReq.user!.id, lastContactAt: new Date(), closedAt: lead.closedAt ?? new Date() })
        .where(eq(leads.id, id));
      return client.id;
    });

    const [client] = await db.select().from(clients).where(eq(clients.id, result)).limit(1);
    res.status(201).json({ lead: await findLead(id), client: toApi(client) });
  } catch (err) {
    sendError(res, err, 'Failed to convert lead');
  }
});

router.delete('/:id', requirePermission('clients', 'delete'), async (req, res) => {
  try {
    const [deleted] = await db.delete(leads).where(eq(leads.id, req.params.id as string)).returning({ id: leads.id });
    if (!deleted) return res.status(404).json({ message: 'Lead not found' });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to delete lead');
  }
});

export default router;
