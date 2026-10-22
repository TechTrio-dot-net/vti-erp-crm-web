import express, { Router, type Response } from 'express';
import { and, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index';
import { bdmIdleReasons, callLogs, callRecordings, leads, mobileDevices, users, type CallDirection } from '../db/schema';
import { authMiddleware, type AuthRequest } from '../lib/auth';
import { BDM_ROLE, bdmScope, dateRange, isCrmAdmin, localDate, normalizePhone, requireCrm, requireCrmAdmin } from '../lib/crm';
import { HttpError, optionalId, sendError, uuidParam } from '../lib/http';
import { linkCallsToLead, recordDeviceCalls, type IncomingCall } from '../services/calls';
import { exotelConfigured, exotelStatus, startExotelCall } from '../services/exotel';
import { intakeLead } from '../services/leadIntake';
import { awaitDialOutcome, claimDialRequest, createDialRequest, onlineDialer, POLL_MS, reportDialResult, touchDevice, waitAndClaim } from '../services/phoneDialer';
import { kickJobs } from '../jobs/runner';
import { lookupNumber, submitAfterCall } from '../services/afterCall';
import { completeRecordingUpload, finishIfArrived, RECORDING_MAX_BYTES, saveRecordingContent, startRecordingUpload, transcribeRecording } from '../services/recordings';
import { speechConfigured } from '../services/speech';
import { getObject, presignedGetUrl } from '../lib/storage';

const router = Router();
router.use(authMiddleware, requireCrm);
router.param('id', uuidParam);

const DIRECTIONS: CallDirection[] = ['outgoing', 'incoming', 'missed', 'rejected'];
const MAX_BATCH = 1000;

// ─── Phone app sync ─────────────────────────────────────────────────────────────────────────────────────────────

/** Called by the Android app with new entries from the phone's call log */
router.post('/device-sync', async (req: AuthRequest, res) => {
  try {
    const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.slice(0, 100) : '';
    if (!deviceId) throw new HttpError(400, 'deviceId is required');
    const raw: unknown[] = Array.isArray(req.body?.calls) ? req.body.calls.slice(0, MAX_BATCH) : [];
    const calls: IncomingCall[] = [];
    for (const c of raw as Array<Record<string, unknown>>) {
      const startedAt = new Date(Number(c.startedAt));
      const direction = String(c.direction) as CallDirection;
      if (typeof c.phone !== 'string' || !c.phone.trim() || Number.isNaN(startedAt.getTime()) || !DIRECTIONS.includes(direction)) continue;
      if (startedAt.getTime() > Date.now() + 3600_000) continue;
      calls.push({
        phone: c.phone.trim().slice(0, 30),
        direction,
        startedAt,
        durationSec: Math.max(0, Number(c.durationSec) || 0),
        contactName: typeof c.contactName === 'string' ? c.contactName.slice(0, 120) : null,
      });
    }
    const result = await recordDeviceCalls(req.user!.id, deviceId, calls, { leadsOnly: req.body?.leadsOnly === true });
    const lastCallAt = calls.reduce<Date | null>((m, c) => (!m || c.startedAt > m ? c.startedAt : m), null);
    await db
      .insert(mobileDevices)
      .values({
        userId: req.user!.id,
        deviceId,
        deviceName: typeof req.body?.deviceName === 'string' ? req.body.deviceName.slice(0, 100) : null,
        appVersion: typeof req.body?.appVersion === 'string' ? req.body.appVersion.slice(0, 20) : null,
        lastSyncAt: new Date(),
        lastCallAt,
        permissionGranted: req.body?.permissionGranted !== false,
      })
      .onConflictDoUpdate({
        target: [mobileDevices.userId, mobileDevices.deviceId],
        set: {
          deviceName: sql`coalesce(excluded.device_name, ${mobileDevices.deviceName})`,
          appVersion: sql`coalesce(excluded.app_version, ${mobileDevices.appVersion})`,
          lastSyncAt: new Date(),
          lastCallAt: sql`GREATEST(${mobileDevices.lastCallAt}, excluded.last_call_at)`,
          permissionGranted: sql`excluded.permission_granted`,
          updatedAt: new Date(),
        },
      });
    const [today] = await db
      .select({
        calls: count(),
        connected: sql<number>`count(*) filter (where ${callLogs.durationSec} > 0 and ${callLogs.direction} in ('outgoing','incoming'))::int`,
        talkSec: sql<number>`coalesce(sum(${callLogs.durationSec}), 0)::int`,
      })
      .from(callLogs)
      .where(and(eq(callLogs.userId, req.user!.id), sql`${localDate(callLogs.startedAt)} = ${localDate(sql`now()`)}`));
    res.json({ ...result, today });
  } catch (err) {
    sendError(res, err, 'Call sync failed');
  }
});

// ─── Phone app: after-call form ─────────────────────────────────────────────────────────────────────────────────

/** Who a number belongs to (shown on the form that opens when a call ends) */
router.post('/after-call/lookup', async (req: AuthRequest, res) => {
  try {
    res.json(await lookupNumber(req.user!, req.body?.phone));
  } catch (err) {
    sendError(res, err, 'Lookup failed');
  }
});

/** Saves the form: stores the call, creates/updates the lead and logs the follow-up in one go */
router.post('/after-call', async (req: AuthRequest, res) => {
  try {
    const result = await submitAfterCall(req.user!, req.body ?? {});
    res.status(result.saved || result.status === 'call-only' ? 201 : 200).json(result);
  } catch (err) {
    sendError(res, err, 'Failed to save the call');
  }
});

// ─── Phone app: call recordings ─────────────────────────────────────────────────────────────────────────────────

/**
 * The phone found the file its call recorder saved for a synced call. Answers where to upload it — a
 * direct R2 address, or null to send it to /recordings/:id/content — or that it isn't wanted.
 */
router.post('/recordings/start', async (req: AuthRequest, res) => {
  try {
    const b = req.body ?? {};
    const startedAt = new Date(Number(b.startedAt));
    const direction = String(b.direction) as CallDirection;
    if (typeof b.phone !== 'string' || !b.phone.trim() || Number.isNaN(startedAt.getTime()) || !DIRECTIONS.includes(direction)) {
      throw new HttpError(400, 'phone, direction and startedAt are required');
    }
    if (typeof b.fileName !== 'string' || !b.fileName.trim()) throw new HttpError(400, 'fileName is required');
    res.json(
      await startRecordingUpload(req.user!.id, {
        phone: b.phone.trim().slice(0, 30),
        direction,
        startedAt,
        durationSec: Math.max(0, Number(b.durationSec) || 0),
        fileName: b.fileName.trim(),
        sizeBytes: Number(b.sizeBytes) || 0,
      })
    );
  } catch (err) {
    sendError(res, err, 'Could not start the recording upload');
  }
});

/** The recording's bytes, when storage has no direct upload address (local development) */
router.put('/recordings/:id/content', express.raw({ type: () => true, limit: RECORDING_MAX_BYTES }), async (req: AuthRequest, res) => {
  try {
    await saveRecordingContent(req.user!.id, req.params.id as string, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Recording upload failed');
  }
});

router.post('/recordings/:id/complete', async (req: AuthRequest, res) => {
  try {
    res.json(await completeRecordingUpload(req.user!.id, req.params.id as string));
  } catch (err) {
    sendError(res, err, 'Could not finish the recording upload');
  }
});

// ─── Phone app: Call button requests ────────────────────────────────────────────────────────────────────────────

const deviceIdFrom = (body: Record<string, unknown> | undefined) => {
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.slice(0, 100) : '';
  if (!deviceId) throw new HttpError(400, 'deviceId is required');
  return deviceId;
};

/**
 * Long poll from the Android app: answers as soon as the user clicks Call on the website, or after
 * POLL_MS with no request (the app then asks again).
 */
router.post('/dialer/poll', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const deviceId = deviceIdFrom(req.body);
    const canDial = req.body?.canDial === true;
    await touchDevice(userId, deviceId, {
      deviceName: typeof req.body?.deviceName === 'string' ? req.body.deviceName.slice(0, 100) : null,
      appVersion: typeof req.body?.appVersion === 'string' ? req.body.appVersion.slice(0, 20) : null,
      canDial,
    });
    // Phones are online all day, so their polls also keep the background jobs (lead sync etc.) running
    kickJobs();
    let closed = false;
    res.on('close', () => { closed = true; });
    let request = canDial ? await claimDialRequest(userId, deviceId) : null;
    if (!request && canDial) request = await waitAndClaim(userId, deviceId, POLL_MS, () => closed);
    else if (!request) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    if (closed || res.writableEnded) return;
    res.json({ request: request && { id: request.id, phone: request.phone, name: request.contactName } });
  } catch (err) {
    sendError(res, err, 'Poll failed');
  }
});

router.post('/dialer/:id/result', async (req: AuthRequest, res) => {
  try {
    const status = req.body?.status;
    if (status !== 'dialing' && status !== 'failed') throw new HttpError(400, 'status must be dialing or failed');
    const error = typeof req.body?.error === 'string' ? req.body.error : null;
    const ok = await reportDialResult(req.user!.id, req.params.id as string, status, error);
    res.json({ ok });
  } catch (err) {
    sendError(res, err, 'Failed to save the call result');
  }
});

// ─── Call log ───────────────────────────────────────────────────────────────────────────────────────────────────

router.get('/', async (req: AuthRequest, res) => {
  try {
    const q = req.query;
    const { from, to } = dateRange(q, 7);
    const conditions: (SQL | undefined)[] = [sql`${localDate(callLogs.startedAt)} BETWEEN ${from} AND ${to}`];
    const bdm = bdmScope(req, q.bdm);
    if (bdm) conditions.push(eq(callLogs.userId, optionalId(bdm, 'bdm')!));
    const leadId = optionalId(q.leadId, 'leadId');
    if (leadId) conditions.push(eq(callLogs.leadId, leadId));
    if (typeof q.direction === 'string' && DIRECTIONS.includes(q.direction as CallDirection)) conditions.push(eq(callLogs.direction, q.direction as CallDirection));
    if (q.matched === 'no') conditions.push(isNull(callLogs.leadId));
    if (q.matched === 'yes') conditions.push(sql`${callLogs.leadId} IS NOT NULL`);
    if (q.connected === 'yes') conditions.push(sql`${callLogs.durationSec} > 0 AND ${callLogs.direction} IN ('outgoing','incoming')`);
    if (q.recording === 'yes') conditions.push(sql`${callRecordings.id} IS NOT NULL`);
    if (typeof q.q === 'string' && normalizePhone(q.q)) conditions.push(sql`${callLogs.phoneNormalized} LIKE ${`%${normalizePhone(q.q)}%`}`);
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 1000);
    const page = Math.max(Number(q.page) || 1, 1);
    const where = and(...conditions);

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          id: callLogs.id,
          source: callLogs.source,
          direction: callLogs.direction,
          status: callLogs.status,
          phone: callLogs.phone,
          contactName: callLogs.contactName,
          startedAt: callLogs.startedAt,
          durationSec: callLogs.durationSec,
          recordingUrl: callLogs.recordingUrl,
          recordingStatus: callRecordings.status,
          userId: callLogs.userId,
          userName: users.name,
          leadId: callLogs.leadId,
          leadName: sql<string>`coalesce(nullif(btrim(${leads.contactName}), ''), ${leads.companyName})`,
          leadStage: leads.stage,
          leadOwner: leads.assignedTo,
        })
        .from(callLogs)
        .leftJoin(users, eq(users.id, callLogs.userId))
        .leftJoin(leads, eq(leads.id, callLogs.leadId))
        .leftJoin(callRecordings, eq(callRecordings.callLogId, callLogs.id))
        .where(where)
        .orderBy(desc(callLogs.startedAt))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ total: count() }).from(callLogs).leftJoin(callRecordings, eq(callRecordings.callLogId, callLogs.id)).where(where),
    ]);
    // BDMs don't see which other BDM owns a lead they happened to call
    res.json({ rows: req.user!.role === BDM_ROLE ? rows.map((r) => ({ ...r, leadName: r.leadOwner === req.user!.id ? r.leadName : r.leadId ? 'Another BDM\'s lead' : null, leadId: r.leadOwner === req.user!.id ? r.leadId : null })) : rows, total, page, limit });
  } catch (err) {
    sendError(res, err, 'Failed to fetch calls');
  }
});

// ─── Why no calls ───────────────────────────────────────────────────────────────────────────────────────────────

/** The usual answers; a salesperson can also type their own */
export const IDLE_REASONS = ['In a meeting', 'On a shoot', 'Travelling', 'Lunch break', 'Office work', 'Not well'];

const todayOnly = (column: unknown) => sql`${localDate(column as SQL)} = ${localDate(sql`now()`)}`;

/** My calling day so far: when I last called and the reason I gave for the quiet since then */
router.get('/idle-reason', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const [[call], [latest]] = await Promise.all([
      db
        .select({ lastCallAt: sql<string | null>`max(${callLogs.startedAt})` })
        .from(callLogs)
        .where(and(eq(callLogs.userId, userId), todayOnly(callLogs.startedAt))),
      db
        .select()
        .from(bdmIdleReasons)
        .where(and(eq(bdmIdleReasons.userId, userId), todayOnly(bdmIdleReasons.createdAt)))
        .orderBy(desc(bdmIdleReasons.createdAt))
        .limit(1),
    ]);
    const lastCallAt = call?.lastCallAt ?? null;
    // Calling again answers the question, so a reason given before the last call is done with
    const current = latest && (!lastCallAt || latest.createdAt > new Date(lastCallAt)) ? latest : null;
    res.json({ lastCallAt, options: IDLE_REASONS, reason: current && { reason: current.reason, note: current.note, createdAt: current.createdAt } });
  } catch (err) {
    sendError(res, err, 'Failed to load your calling status');
  }
});

/** The salesperson says why they have not been calling */
router.post('/idle-reason', async (req: AuthRequest, res) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 80) : '';
    if (!reason) throw new HttpError(400, 'Choose a reason or type your own');
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) || null : null;
    const [row] = await db.insert(bdmIdleReasons).values({ userId: req.user!.id, reason, note }).returning();
    res.status(201).json({ reason: row.reason, note: row.note, createdAt: row.createdAt });
  } catch (err) {
    sendError(res, err, 'Could not save your reason');
  }
});

// ─── Recording and transcript ───────────────────────────────────────────────────────────────────────────────────

/** The call with its recording, for someone allowed to hear it: BDMs only their own calls and calls with their leads */
async function recordingFor(req: AuthRequest) {
  const [row] = await db
    .select({ call: callLogs, recording: callRecordings, leadOwner: leads.assignedTo })
    .from(callLogs)
    .leftJoin(callRecordings, eq(callRecordings.callLogId, callLogs.id))
    .leftJoin(leads, eq(leads.id, callLogs.leadId))
    .where(eq(callLogs.id, req.params.id as string))
    .limit(1);
  if (!row) throw new HttpError(404, 'Call not found');
  if (req.user!.role === BDM_ROLE && row.call.userId !== req.user!.id && row.leadOwner !== req.user!.id) throw new HttpError(403, 'Forbidden');
  return row;
}

router.get('/:id/recording', async (req: AuthRequest, res) => {
  try {
    const { call, recording } = await recordingFor(req);
    let r = recording;
    // The phone sent the file but its "complete" never arrived
    if (r?.status === 'uploading' && (await finishIfArrived(r))) r = { ...r, status: 'uploaded' };
    const hasAudio = !!r?.storageKey && r.status !== 'uploading';
    res.json({
      callId: call.id,
      recording: r && {
        id: r.id,
        status: r.status,
        hasAudio,
        fileName: r.fileName,
        sizeBytes: r.sizeBytes,
        transcript: r.transcript,
        language: r.language,
        summary: r.summary,
        error: r.error,
        transcribedAt: r.transcribedAt,
      },
      // Exotel recording that hasn't been copied over yet
      externalUrl: !r?.storageKey ? call.recordingUrl : null,
      // Played straight from R2; null means fetch it from /recording/audio
      audioUrl: hasAudio && r?.storageKey ? await presignedGetUrl(r.storageKey, 3600, r.mimeType ?? undefined) : null,
      transcriptionEnabled: speechConfigured(),
    });
  } catch (err) {
    sendError(res, err, 'Failed to load the recording');
  }
});

router.get('/:id/recording/audio', async (req: AuthRequest, res) => {
  try {
    const { recording } = await recordingFor(req);
    if (!recording?.storageKey || recording.status === 'uploading') return res.status(404).json({ message: 'No recording for this call' });
    const stored = await getObject(recording.storageKey);
    if (!stored) return res.status(404).json({ message: 'Recording file not found' });
    res.set({
      'Content-Type': recording.mimeType || stored.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
      ...(stored.size && { 'Content-Length': String(stored.size) }),
    });
    stored.stream.pipe(res);
  } catch (err) {
    sendError(res, err, 'Failed to load the recording');
  }
});

/** Transcribes (again) now, e.g. after a failure or once speech to text has been set up */
router.post('/:id/recording/transcribe', requireCrmAdmin, async (req: AuthRequest, res) => {
  try {
    if (!speechConfigured()) throw new HttpError(400, 'Speech to text is not set up — add TRANSCRIBE_API_KEY (or OPENAI_API_KEY)');
    const { recording } = await recordingFor(req);
    if (!recording || recording.status === 'uploading') throw new HttpError(404, 'No recording for this call');
    if (recording.status === 'transcribing') throw new HttpError(409, 'Already being transcribed');
    // A transcribed recording is claimed again by resetting it; a failed one via retry
    if (recording.status === 'transcribed') await db.update(callRecordings).set({ status: 'uploaded', attempts: 0 }).where(eq(callRecordings.id, recording.id));
    const ok = await transcribeRecording(recording.id, { retry: true });
    const [fresh] = await db.select({ status: callRecordings.status, error: callRecordings.error }).from(callRecordings).where(eq(callRecordings.id, recording.id));
    res.json({ ok, ...fresh });
  } catch (err) {
    sendError(res, err, 'Transcription failed');
  }
});

/** Turns a call from an unknown number into a lead (and links all calls from that number) */
router.post('/:id/create-lead', async (req: AuthRequest, res) => {
  try {
    const [call] = await db.select().from(callLogs).where(eq(callLogs.id, req.params.id as string)).limit(1);
    if (!call) return res.status(404).json({ message: 'Call not found' });
    if (req.user!.role === BDM_ROLE && call.userId !== req.user!.id) return res.status(403).json({ message: 'Forbidden' });
    if (call.leadId) throw new HttpError(409, 'This call is already linked to a lead');
    const result = await intakeLead({
      name: (typeof req.body?.name === 'string' && req.body.name.trim()) || call.contactName || call.phone,
      phone: call.phone,
      source: 'phone call',
      notes: typeof req.body?.notes === 'string' ? req.body.notes : null,
      serviceId: optionalId(req.body?.serviceId, 'serviceId') ?? null,
      isManual: true,
      assignTo: call.userId,
      createdBy: req.user!.id,
      createdAt: call.startedAt,
    });
    const linked = await linkCallsToLead(result.leadId, call.phoneNormalized);
    res.status(201).json({ ...result, linkedCalls: linked });
  } catch (err) {
    sendError(res, err, 'Failed to create lead from call');
  }
});

// ─── Click to call ──────────────────────────────────────────────────────────────────────────────────────────────

router.get('/telephony', async (req: AuthRequest, res) => {
  try {
    const [me] = await db.select({ phone: users.phone }).from(users).where(eq(users.id, req.user!.id)).limit(1);
    const phone = await onlineDialer(req.user!.id);
    res.json({ ...exotelStatus(), myPhone: me?.phone ?? null, phoneApp: phone ? { connected: true, deviceName: phone.deviceName } : { connected: false } });
  } catch (err) {
    sendError(res, err, 'Failed to load telephony status');
  }
});

async function leadForCall(req: AuthRequest, res: Response) {
  const leadId = optionalId(req.body?.leadId, 'leadId');
  if (!leadId) throw new HttpError(400, 'leadId is required');
  const [lead] = await db.select({ id: leads.id, phone: leads.phone, assignedTo: leads.assignedTo, name: sql<string>`coalesce(${leads.contactName}, ${leads.companyName})` }).from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) {
    res.status(404).json({ message: 'Lead not found' });
    return null;
  }
  if (req.user!.role === BDM_ROLE && lead.assignedTo !== req.user!.id) {
    res.status(403).json({ message: 'This lead is assigned to someone else' });
    return null;
  }
  if (!lead.phone) throw new HttpError(400, 'This lead has no mobile number');
  return lead;
}

const NO_PHONE_MESSAGE = 'Your phone isn\'t connected. Open the Voice Tunes India app on your phone, sign in and allow the Phone permission.';

/**
 * Order of preference:
 * 1. The user's phone app is connected → the phone dials the lead itself (calls are logged by the app).
 * 2. Exotel is configured → rings the BDM's phone first, then connects the customer from the company number.
 * 3. Neither → the website can only open a dialler when it is itself running on a phone.
 */
router.post('/click-to-call', async (req: AuthRequest, res) => {
  try {
    const lead = await leadForCall(req, res);
    if (!lead) return;
    const userId = req.user!.id;
    const mode = req.body?.mode;
    const tel = `tel:${lead.phone!.replace(/[^\d+]/g, '')}`;

    if (mode !== 'telephony') {
      const device = await onlineDialer(userId);
      if (device) {
        const request = await createDialRequest({ userId, leadId: lead.id, phone: lead.phone!, contactName: lead.name });
        const outcome = await awaitDialOutcome(request.id, 12_000);
        const phoneName = device.deviceName || 'your phone';
        if (outcome.status === 'dialing') return res.status(201).json({ mode: 'phone', status: outcome.status, requestId: request.id, message: `Calling ${lead.name} on ${phoneName}` });
        if (outcome.status === 'sent') return res.status(201).json({ mode: 'phone', status: outcome.status, requestId: request.id, message: `Sent to ${phoneName} — it should start dialling now` });
        if (outcome.status === 'failed') throw new HttpError(502, `${phoneName} couldn't place the call: ${outcome.error || 'unknown error'}`);
        throw new HttpError(504, `${phoneName} didn't respond. Open the Voice Tunes India app on the phone and check it shows "Ready for calls".`);
      }
      if (mode === 'phone') throw new HttpError(409, NO_PHONE_MESSAGE);
    }

    if (exotelConfigured()) {
      const [me] = await db.select({ phone: users.phone }).from(users).where(eq(users.id, userId)).limit(1);
      if (!me?.phone) throw new HttpError(400, 'Add your mobile number in BDM Master / User Master so the call can ring you first');
      const call = await startExotelCall({ userId, agentPhone: me.phone, leadId: lead.id, leadPhone: lead.phone! });
      return res.status(201).json({ mode: 'telephony', ...call, message: 'Your phone will ring in a few seconds — pick up to connect the customer' });
    }
    res.json({ mode: 'unavailable', tel, message: NO_PHONE_MESSAGE });
  } catch (err) {
    sendError(res, err, 'Could not start the call');
  }
});

// ─── Devices ────────────────────────────────────────────────────────────────────────────────────────────────────

router.get('/devices', async (req: AuthRequest, res) => {
  try {
    const rows = await db
      .select({
        id: mobileDevices.id,
        userId: mobileDevices.userId,
        userName: users.name,
        deviceName: mobileDevices.deviceName,
        appVersion: mobileDevices.appVersion,
        lastSyncAt: mobileDevices.lastSyncAt,
        lastCallAt: mobileDevices.lastCallAt,
        permissionGranted: mobileDevices.permissionGranted,
        canDial: mobileDevices.canDial,
        lastSeenAt: mobileDevices.lastSeenAt,
      })
      .from(mobileDevices)
      .innerJoin(users, eq(users.id, mobileDevices.userId))
      .where(isCrmAdmin(req.user!.role) ? undefined : eq(mobileDevices.userId, req.user!.id))
      .orderBy(desc(mobileDevices.lastSyncAt));
    res.json(rows);
  } catch (err) {
    sendError(res, err, 'Failed to fetch devices');
  }
});

router.delete('/devices/:id', requireCrmAdmin, async (req, res) => {
  try {
    const [row] = await db.delete(mobileDevices).where(eq(mobileDevices.id, req.params.id as string)).returning({ id: mobileDevices.id });
    if (!row) return res.status(404).json({ message: 'Device not found' });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to remove device');
  }
});

export default router;
