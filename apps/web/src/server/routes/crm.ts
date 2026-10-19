import { Router, type Response } from 'express';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index';
import {
  bdmLeaves,
  bdmSessions,
  callLogs,
  callRecordings,
  campaignBdmRules,
  divisions,
  leadAssignments,
  leadFollowups,
  leads,
  services,
  users,
  whatsappLogs,
  type LeadStage,
} from '../db/schema';
import { authMiddleware, invalidateAuthUser, type AuthRequest } from '../lib/auth';
import {
  APP_TIMEZONE,
  BDM_ROLE,
  CLOSED_STAGES,
  OPEN_STAGES,
  bdmScope,
  dateRange,
  isCrmAdmin,
  isDateString,
  localDate,
  normalizePhone,
  requireCrm,
  requireCrmAdmin,
  todayLocal,
} from '../lib/crm';
import { HttpError, isUuid, optionalId, pickColumns, sendError, uuidParam } from '../lib/http';
import { hashPassword } from '../utils/password';
import { isOpen, leadQuery, startOfTodayLocal } from '../services/leadQueries';
import { assignLead, assignWaitingLeads, isAssignableBdm, notifyAssignees, transferLeads } from '../services/leadAssignment';
import { intakeLead } from '../services/leadIntake';
import { STAGES, logFollowup } from '../services/followups';

const router = Router();
router.use(authMiddleware, requireCrm);
router.param('id', uuidParam);


/** Loads a lead the current user may act on (BDMs: only their own) */
async function loadLead(req: AuthRequest, res: Response, id: string) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!lead) {
    res.status(404).json({ message: 'Lead not found' });
    return null;
  }
  if (req.user!.role === BDM_ROLE && lead.assignedTo !== req.user!.id) {
    res.status(403).json({ message: 'This lead is assigned to someone else' });
    return null;
  }
  return lead;
}

// ─── Lead lists, search, detail ────────────────────────────────────────────────────────────────────────────────

/** Lead Filter + every lead list. Supports rich filters and pagination. */
router.get('/leads', async (req: AuthRequest, res) => {
  try {
    const q = req.query;
    const conditions: (SQL | undefined)[] = [];
    const bdm = bdmScope(req, q.bdm);
    if (bdm === 'unassigned') conditions.push(isNull(leads.assignedTo));
    else if (bdm) conditions.push(eq(leads.assignedTo, optionalId(bdm, 'bdm')!));

    const status = typeof q.status === 'string' ? q.status : 'open';
    const todayStart = startOfTodayLocal;
    const statusFilters: Record<string, SQL | undefined> = {
      all: undefined,
      open: isOpen,
      closed: inArray(leads.stage, [...CLOSED_STAGES]),
      won: eq(leads.stage, 'WON'),
      lost: eq(leads.stage, 'LOST'),
      pending: and(isOpen, isNull(leads.firstContactAt)),
      due: and(isOpen, isNotNull(leads.nextFollowupAt), lt(leads.nextFollowupAt, sql`${todayStart} + interval '1 day'`)),
      overdue: and(isOpen, lt(leads.nextFollowupAt, todayStart)),
      today: and(isOpen, gte(leads.nextFollowupAt, todayStart), lt(leads.nextFollowupAt, sql`${todayStart} + interval '1 day'`)),
    };
    if (STAGES.includes(status as LeadStage)) conditions.push(eq(leads.stage, status as LeadStage));
    else conditions.push(statusFilters[status] ?? isOpen);

    if (typeof q.q === 'string' && q.q.trim()) {
      const term = q.q.trim();
      const phone = normalizePhone(term);
      const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(or(ilike(leads.companyName, like), ilike(leads.contactName, like), ilike(leads.email, like), phone ? sql`${leads.phoneNormalized} LIKE ${`%${phone}%`}` : undefined));
    }
    if (typeof q.source === 'string' && q.source) conditions.push(eq(leads.source, q.source));
    if (typeof q.campaign === 'string' && q.campaign) conditions.push(eq(leads.campaign, q.campaign));
    if (typeof q.city === 'string' && q.city) conditions.push(ilike(leads.city, q.city));
    const serviceId = optionalId(q.serviceId, 'serviceId');
    if (serviceId) conditions.push(eq(leads.serviceId, serviceId));
    if (q.manual === 'only') conditions.push(eq(leads.isManual, true));
    if (q.manual === 'no') conditions.push(eq(leads.isManual, false));

    if (isDateString(q.from) || isDateString(q.to)) {
      const { from, to } = dateRange(q, 30);
      const column = { assigned: leads.assignedAt, followup: leads.nextFollowupAt, closed: leads.closedAt, contacted: leads.lastContactAt }[
        String(q.dateField)
      ] ?? leads.createdAt;
      conditions.push(sql`${localDate(column)} BETWEEN ${from} AND ${to}`);
    }

    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 500);
    const page = Math.max(Number(q.page) || 1, 1);
    const order =
      q.sort === 'followup'
        ? [sql`${leads.nextFollowupAt} ASC NULLS LAST`, desc(leads.createdAt)]
        : q.sort === 'value'
          ? [desc(leads.estimatedValue)]
          : [desc(leads.createdAt)];

    const where = and(...conditions);
    const [rows, [{ total }]] = await Promise.all([
      leadQuery().where(where).orderBy(...order).limit(limit).offset((page - 1) * limit),
      db.select({ total: count() }).from(leads).where(where),
    ]);
    res.json({ rows, total, page, limit });
  } catch (err) {
    sendError(res, err, 'Failed to fetch leads');
  }
});

/** Top-bar search by mobile or name */
router.get('/search', async (req: AuthRequest, res) => {
  try {
    const term = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (term.length < 2) return res.json([]);
    const phone = normalizePhone(term);
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const bdm = bdmScope(req);
    const rows = await leadQuery()
      .where(
        and(
          bdm ? eq(leads.assignedTo, bdm) : undefined,
          or(ilike(leads.companyName, like), ilike(leads.contactName, like), phone ? sql`${leads.phoneNormalized} LIKE ${`%${phone}%`}` : undefined, ilike(leads.email, like))
        )
      )
      .orderBy(desc(leads.createdAt))
      .limit(10);
    res.json(rows);
  } catch (err) {
    sendError(res, err, 'Search failed');
  }
});

router.get('/leads/:id', async (req: AuthRequest, res) => {
  try {
    const lead = await loadLead(req, res, req.params.id as string);
    if (!lead) return;
    const [[detail], followups, assignments, whatsapp, calls] = await Promise.all([
      leadQuery().where(eq(leads.id, lead.id)),
      db
        .select({
          id: leadFollowups.id,
          outcome: leadFollowups.outcome,
          source: leadFollowups.source,
          note: leadFollowups.note,
          nextFollowupAt: leadFollowups.nextFollowupAt,
          callActivity: leadFollowups.callActivity,
          statusLabel: leadFollowups.statusLabel,
          callDurationSec: leadFollowups.callDurationSec,
          reason: leadFollowups.reason,
          connected: leadFollowups.connected,
          interested: leadFollowups.interested,
          sampleShared: leadFollowups.sampleShared,
          createdAt: leadFollowups.createdAt,
          userName: users.name,
        })
        .from(leadFollowups)
        .leftJoin(users, eq(users.id, leadFollowups.userId))
        .where(eq(leadFollowups.leadId, lead.id))
        .orderBy(desc(leadFollowups.createdAt)),
      db.query.leadAssignments.findMany({
        where: eq(leadAssignments.leadId, lead.id),
        with: { fromUser: { columns: { name: true } }, toUser: { columns: { name: true } }, byUser: { columns: { name: true } } },
        orderBy: [desc(leadAssignments.createdAt)],
      }),
      db.select().from(whatsappLogs).where(eq(whatsappLogs.leadId, lead.id)).orderBy(desc(whatsappLogs.createdAt)).limit(20),
      db
        .select({
          id: callLogs.id, source: callLogs.source, direction: callLogs.direction, status: callLogs.status, startedAt: callLogs.startedAt,
          durationSec: callLogs.durationSec, recordingUrl: callLogs.recordingUrl, userName: users.name,
          recordingStatus: callRecordings.status, summary: callRecordings.summary,
        })
        .from(callLogs)
        .leftJoin(users, eq(users.id, callLogs.userId))
        .leftJoin(callRecordings, eq(callRecordings.callLogId, callLogs.id))
        .where(eq(callLogs.leadId, lead.id))
        .orderBy(desc(callLogs.startedAt))
        .limit(100),
    ]);
    res.json({ ...detail, followups, assignments, whatsapp, calls });
  } catch (err) {
    sendError(res, err, 'Failed to fetch lead');
  }
});

// ─── Create / update ───────────────────────────────────────────────────────────────────────────────────────────

/** "+ Add Inquiry": manual lead. BDMs keep what they enter; admins assign or let the rotation decide. */
router.post('/inquiries', async (req: AuthRequest, res) => {
  try {
    const body = req.body ?? {};
    const requested = optionalId(body.assignTo, 'assignTo');
    let assignTo: string | null = null;
    if (req.user!.role === BDM_ROLE) assignTo = req.user!.id;
    else if (requested) {
      if (!(await isAssignableBdm(requested))) throw new HttpError(400, 'That user cannot receive leads');
      assignTo = requested;
    }
    const result = await intakeLead({
      name: body.name,
      phone: body.phone,
      email: body.email,
      city: body.city,
      source: body.source || 'manual',
      campaign: body.campaign,
      serviceId: optionalId(body.serviceId, 'serviceId') ?? null,
      notes: body.notes,
      estimatedValue: body.estimatedValue ? Number(body.estimatedValue) : 0,
      isManual: true,
      assignTo,
      createdBy: req.user!.id,
    });
    const [lead] = await leadQuery().where(eq(leads.id, result.leadId));
    res.status(result.status === 'created' ? 201 : 200).json({ status: result.status, lead });
  } catch (err) {
    sendError(res, err, 'Failed to add inquiry');
  }
});

router.patch('/leads/:id', async (req: AuthRequest, res) => {
  try {
    const lead = await loadLead(req, res, req.params.id as string);
    if (!lead) return;
    const updates: Partial<typeof leads.$inferInsert> = pickColumns(leads, req.body, [
      'phone', 'email', 'city', 'source', 'campaign', 'serviceId', 'estimatedValue', 'notes', 'nextFollowupAt', 'stage', 'lostReason',
    ]);
    if (typeof req.body?.name === 'string' && req.body.name.trim()) {
      updates.companyName = req.body.name.trim();
      updates.contactName = req.body.name.trim();
    }
    if (updates.phone !== undefined) updates.phoneNormalized = normalizePhone(updates.phone);
    if (updates.stage && !STAGES.includes(updates.stage as LeadStage)) throw new HttpError(400, 'Invalid stage');
    if (updates.stage && updates.stage !== lead.stage) {
      updates.closedAt = CLOSED_STAGES.includes(updates.stage as (typeof CLOSED_STAGES)[number]) ? new Date() : null;
      updates.statusLabel = null; // the old CRM status no longer describes the lead
    }
    await db.update(leads).set({ ...updates, updatedBy: req.user!.id }).where(eq(leads.id, lead.id));
    const [row] = await leadQuery().where(eq(leads.id, lead.id));
    res.json(row);
  } catch (err) {
    sendError(res, err, 'Failed to update lead');
  }
});

/** Log a call/follow-up. Moves the lead forward and schedules the next follow-up. */
router.post('/leads/:id/followups', async (req: AuthRequest, res) => {
  try {
    const lead = await loadLead(req, res, req.params.id as string);
    if (!lead) return;
    await logFollowup(lead, req.user!.id, req.body ?? {}, { source: 'web' });
    const [row] = await leadQuery().where(eq(leads.id, lead.id));
    res.status(201).json(row);
  } catch (err) {
    sendError(res, err, 'Failed to save follow-up');
  }
});

/** Logs a WhatsApp click-to-chat and returns the wa.me link to open */
router.post('/leads/:id/whatsapp', async (req: AuthRequest, res) => {
  try {
    const lead = await loadLead(req, res, req.params.id as string);
    if (!lead) return;
    if (!lead.phoneNormalized) throw new HttpError(400, 'This lead has no mobile number');
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const digits = (lead.phone ?? '').replace(/\D/g, '');
    const waNumber = digits.length === 10 ? `91${digits}` : digits.replace(/^0+/, '');
    await db.insert(whatsappLogs).values({ leadId: lead.id, userId: req.user!.id, phone: waNumber, message: message || null });
    res.status(201).json({ url: `https://wa.me/${waNumber}${message ? `?text=${encodeURIComponent(message)}` : ''}` });
  } catch (err) {
    sendError(res, err, 'Failed to log WhatsApp message');
  }
});

router.post('/leads/:id/assign', requireCrmAdmin, async (req: AuthRequest, res) => {
  try {
    const toUserId = optionalId(req.body?.toUserId, 'toUserId') ?? null;
    if (toUserId && !(await isAssignableBdm(toUserId))) throw new HttpError(400, 'That user cannot receive leads');
    const [lead] = await db.select({ id: leads.id, assignedTo: leads.assignedTo, name: leads.companyName }).from(leads).where(eq(leads.id, req.params.id as string)).limit(1);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    if (lead.assignedTo === toUserId) return res.json({ ok: true });
    await db.transaction((tx) =>
      assignLead(tx, { leadId: lead.id, fromUserId: lead.assignedTo, toUserId, reason: 'manual', byUserId: req.user!.id, note: req.body?.note })
    );
    if (toUserId) void notifyAssignees([{ userId: toUserId, count: 1, sample: lead.name }]);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to assign lead');
  }
});

router.delete('/leads/:id', requireCrmAdmin, async (req, res) => {
  try {
    const [deleted] = await db.delete(leads).where(eq(leads.id, req.params.id as string)).returning({ id: leads.id });
    if (!deleted) return res.status(404).json({ message: 'Lead not found' });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to delete lead');
  }
});

// ─── Transfers ─────────────────────────────────────────────────────────────────────────────────────────────────

router.post('/transfer', requireCrmAdmin, async (req: AuthRequest, res) => {
  try {
    const fromUserId = optionalId(req.body?.fromUserId, 'fromUserId');
    if (!fromUserId) throw new HttpError(400, 'Choose who to transfer leads from');
    const target = req.body?.toUserId === 'rotation' ? 'rotation' : optionalId(req.body?.toUserId, 'toUserId');
    if (!target) throw new HttpError(400, 'Choose who receives the leads');
    if (target === fromUserId) throw new HttpError(400, 'Pick a different person to receive the leads');
    if (target !== 'rotation' && !(await isAssignableBdm(target))) throw new HttpError(400, 'That user cannot receive leads');
    const leadIds = Array.isArray(req.body?.leadIds) ? req.body.leadIds.filter(isUuid) : undefined;
    const result = await transferLeads({
      fromUserId,
      toUserId: target,
      leadIds,
      onlyPending: !!req.body?.onlyPending,
      reason: 'transfer',
      byUserId: req.user!.id,
      note: typeof req.body?.note === 'string' ? req.body.note : undefined,
    });
    res.json(result);
  } catch (err) {
    sendError(res, err, 'Failed to transfer leads');
  }
});

/** Assignment log — the "LogFile BDM Sequence" and transfer history */
router.get('/assignments', async (req: AuthRequest, res) => {
  try {
    const { from, to } = dateRange(req.query, 7);
    const bdm = bdmScope(req, req.query.bdm);
    const reason = typeof req.query.reason === 'string' && req.query.reason ? req.query.reason : undefined;
    const rows = await db.query.leadAssignments.findMany({
      where: and(
        sql`${localDate(leadAssignments.createdAt)} BETWEEN ${from} AND ${to}`,
        bdm ? or(eq(leadAssignments.toUserId, bdm), eq(leadAssignments.fromUserId, bdm)) : undefined,
        reason ? eq(leadAssignments.reason, reason as 'auto') : undefined
      ),
      with: {
        lead: { columns: { id: true, companyName: true, phone: true, campaign: true, source: true } },
        fromUser: { columns: { name: true } },
        toUser: { columns: { name: true } },
        byUser: { columns: { name: true } },
      },
      orderBy: [desc(leadAssignments.createdAt)],
      limit: 1000,
    });
    res.json(rows);
  } catch (err) {
    sendError(res, err, 'Failed to fetch assignment log');
  }
});

// ─── BDMs: rotation, sessions, settings ────────────────────────────────────────────────────────────────────────

router.get('/bdms', async (req: AuthRequest, res) => {
  try {
    const today = todayLocal();
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        email: users.email,
        phone: users.phone,
        isActive: users.isActive,
        inRotation: users.inRotation,
        rotationPosition: users.rotationPosition,
        lastAssignedAt: users.lastAssignedAt,
        weeklyLeadTarget: users.weeklyLeadTarget,
        weeklyRevenueTarget: users.weeklyRevenueTarget,
        divisionId: users.divisionId,
        divisionName: divisions.name,
        onLeave: sql<boolean>`EXISTS (SELECT 1 FROM bdm_leaves l WHERE l.user_id = "users"."id" AND ${today}::date BETWEEN l.from_date AND l.to_date)`,
        sessionStartedAt: sql<Date | null>`(SELECT s.started_at FROM bdm_sessions s WHERE s.user_id = "users"."id" AND s.ended_at IS NULL ORDER BY s.started_at DESC LIMIT 1)`,
        openLeads: sql<number>`(SELECT count(*)::int FROM leads l WHERE l.assigned_to = "users"."id" AND l.stage NOT IN ('WON', 'LOST'))`,
        pendingLeads: sql<number>`(SELECT count(*)::int FROM leads l WHERE l.assigned_to = "users"."id" AND l.stage NOT IN ('WON', 'LOST') AND l.first_contact_at IS NULL)`,
      })
      .from(users)
      .leftJoin(divisions, eq(divisions.id, users.divisionId))
      .where(and(eq(users.role, BDM_ROLE), req.query.includeInactive === 'true' ? undefined : eq(users.isActive, true)))
      .orderBy(asc(users.rotationPosition), asc(users.name));
    res.json(req.user!.role === BDM_ROLE ? rows.map(({ email, phone, ...rest }) => rest) : rows);
  } catch (err) {
    sendError(res, err, 'Failed to fetch BDMs');
  }
});

/** BDM Master: create a salesperson with their own login */
router.post('/bdms', requireCrmAdmin, async (req: AuthRequest, res) => {
  try {
    const { name, username, email, password, phone } = req.body ?? {};
    if (!name?.trim() || !email?.trim()) throw new HttpError(400, 'Name and email are required');
    const finalUsername = String(username || email.split('@')[0]).trim().toLowerCase();
    if (!password || String(password).length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
    const settings = pickColumns(users, req.body, ['divisionId', 'weeklyLeadTarget', 'weeklyRevenueTarget', 'rotationPosition']);
    const [user] = await db
      .insert(users)
      .values({
        name: name.trim(),
        username: finalUsername,
        email: email.trim().toLowerCase(),
        phone: phone?.trim() || null,
        passwordHash: await hashPassword(String(password)),
        role: BDM_ROLE,
        initials: name.trim().split(/\s+/).map((n: string) => n[0]).join('').slice(0, 2).toUpperCase(),
        ...settings,
      })
      .returning({ id: users.id, name: users.name, username: users.username });
    res.status(201).json(user);
  } catch (err) {
    sendError(res, err, 'Failed to create BDM');
  }
});

router.patch('/bdms/:id', requireCrmAdmin, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const updates: Partial<typeof users.$inferInsert> = pickColumns(users, req.body, [
      'name', 'email', 'phone', 'divisionId', 'weeklyLeadTarget', 'weeklyRevenueTarget', 'rotationPosition', 'isActive',
    ]);
    if (req.body?.password) {
      if (String(req.body.password).length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
      updates.passwordHash = await hashPassword(String(req.body.password));
    }
    if (updates.isActive === false) updates.inRotation = false;
    const [user] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(users.id, id), eq(users.role, BDM_ROLE)))
      .returning({ id: users.id });
    if (!user) return res.status(404).json({ message: 'BDM not found' });
    invalidateAuthUser(id);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to update BDM');
  }
});

async function setRotation(req: AuthRequest, res: Response, start: boolean) {
  const id = req.params.id as string;
  if (!isCrmAdmin(req.user!.role) && req.user!.id !== id) {
    return res.status(403).json({ message: 'You can only start or stop yourself' });
  }
  const [bdm] = await db.select({ id: users.id, isActive: users.isActive }).from(users).where(and(eq(users.id, id), eq(users.role, BDM_ROLE))).limit(1);
  if (!bdm) return res.status(404).json({ message: 'BDM not found' });
  if (start && !bdm.isActive) throw new HttpError(400, 'This BDM is deactivated');

  await db.transaction(async (tx) => {
    await tx.update(users).set({ inRotation: start }).where(eq(users.id, id));
    const [open] = await tx.select({ id: bdmSessions.id }).from(bdmSessions).where(and(eq(bdmSessions.userId, id), isNull(bdmSessions.endedAt))).limit(1).for('update');
    if (start && !open) await tx.insert(bdmSessions).values({ userId: id, startedBy: req.user!.id });
    if (!start && open) await tx.update(bdmSessions).set({ endedAt: new Date(), endedBy: req.user!.id }).where(eq(bdmSessions.id, open.id));
  });
  // Someone just came online — hand them any leads that were waiting for their team
  const assignedWaiting = start ? await assignWaitingLeads().catch(() => 0) : 0;
  res.json({ ok: true, inRotation: start, assignedWaiting });
}

router.post('/bdms/:id/start', async (req: AuthRequest, res) => {
  try {
    await setRotation(req, res, true);
  } catch (err) {
    sendError(res, err, 'Failed to start');
  }
});

router.post('/bdms/:id/stop', async (req: AuthRequest, res) => {
  try {
    await setRotation(req, res, false);
  } catch (err) {
    sendError(res, err, 'Failed to stop');
  }
});

// ─── Leave ─────────────────────────────────────────────────────────────────────────────────────────────────────

router.get('/leaves', async (req: AuthRequest, res) => {
  try {
    const bdm = bdmScope(req, req.query.bdm);
    const rows = await db
      .select({
        id: bdmLeaves.id,
        userId: bdmLeaves.userId,
        userName: users.name,
        fromDate: bdmLeaves.fromDate,
        toDate: bdmLeaves.toDate,
        reason: bdmLeaves.reason,
        transferredTo: bdmLeaves.transferredTo,
        transferredCount: bdmLeaves.transferredCount,
        createdAt: bdmLeaves.createdAt,
      })
      .from(bdmLeaves)
      .innerJoin(users, eq(users.id, bdmLeaves.userId))
      .where(and(bdm ? eq(bdmLeaves.userId, bdm) : undefined, gte(bdmLeaves.toDate, sql`(${todayLocal()}::date - 60)`)))
      .orderBy(desc(bdmLeaves.fromDate));
    res.json(rows);
  } catch (err) {
    sendError(res, err, 'Failed to fetch leaves');
  }
});

/**
 * Marks leave for a BDM. If the leave covers today they are stopped immediately, and their open leads can be
 * handed to another BDM or back through the rotation.
 */
router.post('/leaves', requireCrmAdmin, async (req: AuthRequest, res) => {
  try {
    const userId = optionalId(req.body?.userId, 'userId');
    const { fromDate, toDate } = req.body ?? {};
    if (!userId) throw new HttpError(400, 'Choose the BDM');
    if (!isDateString(fromDate) || !isDateString(toDate) || fromDate > toDate) throw new HttpError(400, 'Enter a valid date range');
    const transferTo = req.body?.transferTo === 'rotation' ? 'rotation' : optionalId(req.body?.transferTo, 'transferTo');
    if (transferTo && transferTo === userId) throw new HttpError(400, 'Leads cannot be transferred to the same person');
    if (transferTo && transferTo !== 'rotation' && !(await isAssignableBdm(transferTo))) throw new HttpError(400, 'That user cannot receive leads');

    const [leave] = await db
      .insert(bdmLeaves)
      .values({ userId, fromDate, toDate, reason: req.body?.reason || null, createdBy: req.user!.id, transferredTo: transferTo === 'rotation' ? null : transferTo ?? null })
      .returning();

    const today = todayLocal();
    if (fromDate <= today && today <= toDate) {
      await db.update(users).set({ inRotation: false }).where(eq(users.id, userId));
      await db.update(bdmSessions).set({ endedAt: new Date(), endedBy: req.user!.id }).where(and(eq(bdmSessions.userId, userId), isNull(bdmSessions.endedAt)));
    }

    let transferred = 0;
    if (transferTo) {
      const result = await transferLeads({
        fromUserId: userId,
        toUserId: transferTo,
        onlyPending: !!req.body?.onlyPending,
        reason: 'leave',
        byUserId: req.user!.id,
        note: `Leave ${fromDate} to ${toDate}`,
      });
      transferred = result.moved;
      await db.update(bdmLeaves).set({ transferredCount: transferred }).where(eq(bdmLeaves.id, leave.id));
    }
    res.status(201).json({ ...leave, transferredCount: transferred });
  } catch (err) {
    sendError(res, err, 'Failed to save leave');
  }
});

router.delete('/leaves/:id', requireCrmAdmin, async (req, res) => {
  try {
    const [deleted] = await db.delete(bdmLeaves).where(eq(bdmLeaves.id, req.params.id as string)).returning({ id: bdmLeaves.id });
    if (!deleted) return res.status(404).json({ message: 'Leave not found' });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to delete leave');
  }
});

// ─── Campaign → BDM adjustment ─────────────────────────────────────────────────────────────────────────────────

router.get('/campaigns', requireCrmAdmin, async (req, res) => {
  try {
    const { from, to } = dateRange(req.query, 90);
    const [stats, perBdm, rules] = await Promise.all([
      db
        .select({
          campaign: leads.campaign,
          total: count(),
          open: sql<number>`count(*) filter (where ${isOpen})::int`,
          pending: sql<number>`count(*) filter (where ${isOpen} and ${leads.firstContactAt} is null)::int`,
          won: sql<number>`count(*) filter (where ${leads.stage} = 'WON')::int`,
          lastLeadAt: sql<Date>`max(${leads.createdAt})`,
        })
        .from(leads)
        .where(and(isNotNull(leads.campaign), sql`${localDate(leads.createdAt)} BETWEEN ${from} AND ${to}`))
        .groupBy(leads.campaign)
        .orderBy(sql`max(${leads.createdAt}) desc`),
      db
        .select({ campaign: leads.campaign, userId: leads.assignedTo, name: users.name, count: count() })
        .from(leads)
        .leftJoin(users, eq(users.id, leads.assignedTo))
        .where(and(isNotNull(leads.campaign), sql`${localDate(leads.createdAt)} BETWEEN ${from} AND ${to}`))
        .groupBy(leads.campaign, leads.assignedTo, users.name),
      db.select({ campaign: campaignBdmRules.campaign, userId: campaignBdmRules.userId, name: users.name }).from(campaignBdmRules).innerJoin(users, eq(users.id, campaignBdmRules.userId)),
    ]);
    const ruleCampaigns = new Set(rules.map((r) => r.campaign));
    const rows = stats.map((s) => ({
      ...s,
      byBdm: perBdm.filter((p) => p.campaign === s.campaign).map(({ userId, name, count: c }) => ({ userId, name: name ?? 'Unassigned', count: c })),
      bdms: rules.filter((r) => r.campaign === s.campaign).map(({ userId, name }) => ({ userId, name })),
    }));
    // Campaigns that have rules but no leads in range yet
    for (const campaign of ruleCampaigns) {
      if (!rows.some((r) => r.campaign === campaign)) {
        rows.push({ campaign, total: 0, open: 0, pending: 0, won: 0, lastLeadAt: null as unknown as Date, byBdm: [], bdms: rules.filter((r) => r.campaign === campaign).map(({ userId, name }) => ({ userId, name })) });
      }
    }
    res.json(rows);
  } catch (err) {
    sendError(res, err, 'Failed to fetch campaigns');
  }
});

router.put('/campaigns/rules', requireCrmAdmin, async (req, res) => {
  try {
    const campaign = typeof req.body?.campaign === 'string' ? req.body.campaign.trim() : '';
    if (!campaign) throw new HttpError(400, 'Campaign name is required');
    const userIds: string[] = Array.isArray(req.body?.userIds) ? [...new Set<string>(req.body.userIds.filter(isUuid))] : [];
    await db.transaction(async (tx) => {
      await tx.delete(campaignBdmRules).where(eq(campaignBdmRules.campaign, campaign));
      if (userIds.length) await tx.insert(campaignBdmRules).values(userIds.map((userId) => ({ campaign, userId })));
    });
    res.json({ campaign, userIds });
  } catch (err) {
    sendError(res, err, 'Failed to save campaign BDMs');
  }
});

/** Re-distributes a campaign's open leads (e.g. after changing its BDMs) */
router.post('/campaigns/reassign', requireCrmAdmin, async (req: AuthRequest, res) => {
  try {
    const campaign = typeof req.body?.campaign === 'string' ? req.body.campaign.trim() : '';
    if (!campaign) throw new HttpError(400, 'Campaign name is required');
    const fromUserId = optionalId(req.body?.fromUserId, 'fromUserId');
    const target = req.body?.toUserId === 'rotation' ? 'rotation' : optionalId(req.body?.toUserId, 'toUserId');
    if (!target) throw new HttpError(400, 'Choose who receives the leads');

    const owners = await db
      .selectDistinct({ userId: leads.assignedTo })
      .from(leads)
      .where(
        and(
          eq(leads.campaign, campaign),
          isOpen,
          isNotNull(leads.assignedTo),
          fromUserId ? eq(leads.assignedTo, fromUserId) : undefined,
          target !== 'rotation' ? ne(leads.assignedTo, target) : undefined,
          req.body?.onlyPending ? isNull(leads.firstContactAt) : undefined
        )
      );
    let moved = 0;
    for (const { userId } of owners) {
      const ids = await db
        .select({ id: leads.id })
        .from(leads)
        .where(and(eq(leads.campaign, campaign), eq(leads.assignedTo, userId!), isOpen, req.body?.onlyPending ? isNull(leads.firstContactAt) : undefined));
      const result = await transferLeads({
        fromUserId: userId!,
        toUserId: target,
        leadIds: ids.map((i) => i.id),
        reason: 'campaign',
        byUserId: req.user!.id,
        note: `Campaign adjustment: ${campaign}`,
      });
      moved += result.moved;
    }
    res.json({ moved });
  } catch (err) {
    sendError(res, err, 'Failed to reassign campaign leads');
  }
});

export default router;
