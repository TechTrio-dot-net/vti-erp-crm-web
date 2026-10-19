import express, { Router, type Request } from 'express';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { leadImports, leadSourceBdms, leadSources, leads, services, users, type LeadSourceConfig } from '../db/schema';
import { authMiddleware, type AuthRequest } from '../lib/auth';
import { BDM_ROLE, dateRange, isDateString, localDate, requireCrmAdmin } from '../lib/crm';
import { HttpError, isUuid, optionalId, sendError, uuidParam } from '../lib/http';
import { listSheetTabs, parseSheetUrl, readSheetRows } from '../services/googleSheets';
import { assignWaitingLeads } from '../services/leadAssignment';
import { applyExotelUpdate, exotelConfigured, exotelStatus } from '../services/exotel';
import { publicApiUrl } from '../lib/publicUrl';
import { deleteObject, getObject, putObject, r2Configured } from '../lib/storage';
import { jobStatus } from '../jobs/runner';
import { speechStatus } from '../services/speech';
import { aiConfigured, AI_MODEL } from '../lib/ai';
import {
  OLD_ROW_NOTE, handleMetaWebhook, importRow, mapLeadFields, metaConfigured, oldImportProgress, startOldLeadsImport, syncSource, verifyMetaSignature,
  type OldImportMode,
} from '../services/leadSources';

const router = Router();

// ─── Meta webhook (public; authenticated by verify token / request signature) ─────────────────────────────────

router.get('/meta/webhook', (req, res) => {
  const expected = process.env.META_VERIFY_TOKEN;
  if (expected && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === expected) {
    res.status(200).send(String(req.query['hub.challenge'] ?? ''));
    return;
  }
  res.sendStatus(403);
});

router.post('/meta/webhook', async (req: Request & { rawBody?: Buffer }, res) => {
  if (!verifyMetaSignature(req.rawBody, req.header('x-hub-signature-256'))) {
    res.sendStatus(401);
    return;
  }
  // Acknowledge immediately; Meta retries slow webhooks
  res.sendStatus(200);
  try {
    await handleMetaWebhook(req.body);
  } catch (err) {
    console.error('[Meta webhook] failed:', (err as Error).message);
  }
});

// ─── Exotel call status callback (public; authenticated by the token in the URL) ───────────────────────────────

router.post('/exotel/status', express.urlencoded({ extended: true }), async (req, res) => {
  const expected = process.env.EXOTEL_WEBHOOK_TOKEN;
  if (!expected || req.query.token !== expected) {
    res.sendStatus(401);
    return;
  }
  res.sendStatus(200);
  try {
    await applyExotelUpdate(req.body ?? {});
  } catch (err) {
    console.error('[Exotel webhook] failed:', (err as Error).message);
  }
});

// ─── Admin ──────────────────────────────────────────────────────────────────────────────────────────────────────

router.use(authMiddleware, requireCrmAdmin);
router.param('id', uuidParam);

function parseSourceBody(body: Record<string, unknown>, existing?: LeadSourceConfig) {
  const type = body.type === 'meta' ? 'meta' : 'google_sheet';
  const config: LeadSourceConfig = { ...existing };
  if (type === 'google_sheet') {
    if (typeof body.sheetUrl === 'string') config.sheetUrl = body.sheetUrl.trim();
    if (typeof body.sheetName === 'string') config.sheetName = body.sheetName.trim() || undefined;
    if (typeof body.importExisting === 'boolean') config.importExisting = body.importExisting;
    if (!config.sheetUrl) throw new HttpError(400, 'Paste the Google Sheet link');
  } else {
    if (Array.isArray(body.formIds)) config.formIds = body.formIds.map(String).map((f) => f.trim()).filter(Boolean);
    else if (typeof body.formIds === 'string') config.formIds = body.formIds.split(/[\s,]+/).filter(Boolean);
    if (typeof body.pageId === 'string') config.pageId = body.pageId.trim() || undefined;
  }
  return { type, config } as const;
}

/**
 * Stores the ticked tabs of a sheet (body.sheetTabGids), with their current titles. A source that was reading
 * its first tab already keeps that tab's history recorded, so ticking it does not start it over.
 */
async function applySheetTabs(config: LeadSourceConfig, body: Record<string, unknown>, existing?: LeadSourceConfig) {
  if (!Array.isArray(body.sheetTabGids)) return;
  const wanted = new Set(body.sheetTabGids.map(String));
  const all = await listSheetTabs(config.sheetUrl!);
  config.sheetTabs = all.filter((t) => wanted.has(t.gid));
  if (!config.sheetTabs.length) delete config.sheetTabs;
  if (existing?.baselineDone && !existing.sheetTabs?.length && !existing.baselinedTabs?.length) {
    const previous = all.find((t) => t.gid === parseSheetUrl(config.sheetUrl!).gid) ?? all.find((t) => t.title === existing.sheetName) ?? all[0];
    if (previous) config.baselinedTabs = [previous.gid];
  }
}

router.get('/sources', async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: leadSources.id,
        name: leadSources.name,
        type: leadSources.type,
        config: leadSources.config,
        active: leadSources.active,
        lastSyncedAt: leadSources.lastSyncedAt,
        lastError: leadSources.lastError,
        defaultServiceId: leadSources.defaultServiceId,
        defaultServiceName: services.name,
        createdAt: leadSources.createdAt,
        imported: sql<number>`(SELECT count(*)::int FROM lead_imports i WHERE i.source_id = "lead_sources"."id" AND i.status = 'imported')`,
        duplicates: sql<number>`(SELECT count(*)::int FROM lead_imports i WHERE i.source_id = "lead_sources"."id" AND i.status = 'duplicate')`,
        errors: sql<number>`(SELECT count(*)::int FROM lead_imports i WHERE i.source_id = "lead_sources"."id" AND i.status = 'error')`,
        lastReceivedAt: sql<Date | null>`(SELECT max(i.received_at) FROM lead_imports i WHERE i.source_id = "lead_sources"."id" AND i.status <> 'ignored')`,
        oldRows: sql<number>`(SELECT count(*)::int FROM lead_imports i WHERE i.source_id = "lead_sources"."id" AND i.status = 'ignored' AND i.error = ${OLD_ROW_NOTE})`,
      })
      .from(leadSources)
      .leftJoin(services, eq(services.id, leadSources.defaultServiceId))
      .orderBy(desc(leadSources.createdAt));
    const teams = await db
      .select({ sourceId: leadSourceBdms.sourceId, userId: users.id, name: users.name, inRotation: users.inRotation })
      .from(leadSourceBdms)
      .innerJoin(users, eq(users.id, leadSourceBdms.userId))
      .orderBy(users.name);
    res.json({
      sources: rows.map((r) => ({
        ...r,
        team: teams.filter((t) => t.sourceId === r.id).map(({ sourceId: _s, ...t }) => t),
        oldImport: oldImportProgress(r.id),
      })),
      meta: {
        accessToken: metaConfigured(),
        appSecret: !!process.env.META_APP_SECRET,
        verifyToken: !!process.env.META_VERIFY_TOKEN,
        webhookPath: '/api/integrations/meta/webhook',
      },
      googleServiceAccount: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
    });
  } catch (err) {
    sendError(res, err, 'Failed to fetch lead sources');
  }
});

/** The tabs of a sheet, to tick the ones leads should come from */
router.post('/sources/tabs', async (req, res) => {
  try {
    const { config } = parseSourceBody({ ...req.body, type: 'google_sheet' });
    res.json({ tabs: await listSheetTabs(config.sheetUrl!) });
  } catch (err) {
    sendError(res, err instanceof HttpError ? err : new HttpError(400, (err as Error).message), 'Could not read the sheet');
  }
});

/** Reads a sheet without saving anything, to confirm access and column mapping */
router.post('/sources/test', async (req, res) => {
  try {
    const { config } = parseSourceBody({ ...req.body, type: 'google_sheet' });
    const gid = typeof req.body?.gid === 'string' && /^\d+$/.test(req.body.gid) ? req.body.gid : undefined;
    const rows = await readSheetRows(config.sheetUrl!, config.sheetName, gid);
    res.json({
      totalRows: rows.length,
      headers: rows[0] ? Object.keys(rows[0]) : [],
      preview: rows.slice(-5).reverse().map((raw) => ({ raw, mapped: mapLeadFields(raw) })),
    });
  } catch (err) {
    sendError(res, err instanceof HttpError ? err : new HttpError(400, (err as Error).message), 'Could not read the sheet');
  }
});

router.post('/sources', async (req: AuthRequest, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) throw new HttpError(400, 'Give the source a name');
    const { type, config } = parseSourceBody(req.body ?? {});
    if (type === 'google_sheet') await applySheetTabs(config, req.body ?? {});
    const [source] = await db
      .insert(leadSources)
      .values({ name, type, config, defaultServiceId: optionalId(req.body?.defaultServiceId, 'defaultServiceId') ?? null, active: req.body?.active !== false })
      .returning();
    res.status(201).json(source);
  } catch (err) {
    sendError(res, err, 'Failed to add lead source');
  }
});

router.patch('/sources/:id', async (req, res) => {
  try {
    const [existing] = await db.select().from(leadSources).where(eq(leadSources.id, req.params.id as string)).limit(1);
    if (!existing) return res.status(404).json({ message: 'Source not found' });
    const { config } = parseSourceBody({ ...req.body, type: existing.type }, existing.config);
    if (existing.type === 'google_sheet') await applySheetTabs(config, req.body ?? {}, existing.config);
    const updates: Partial<typeof leadSources.$inferInsert> = { config, updatedAt: new Date() };
    if (typeof req.body?.name === 'string' && req.body.name.trim()) updates.name = req.body.name.trim();
    if (typeof req.body?.active === 'boolean') updates.active = req.body.active;
    if (req.body?.defaultServiceId !== undefined) updates.defaultServiceId = optionalId(req.body.defaultServiceId, 'defaultServiceId') ?? null;
    const [source] = await db.update(leadSources).set(updates).where(eq(leadSources.id, existing.id)).returning();
    res.json(source);
  } catch (err) {
    sendError(res, err, 'Failed to update lead source');
  }
});

/** Sets the sales team for a source. An empty list means every online BDM (normal rotation). */
router.put('/sources/:id/team', async (req, res) => {
  try {
    const sourceId = req.params.id as string;
    const userIds: string[] = Array.isArray(req.body?.userIds) ? [...new Set<string>(req.body.userIds.filter(isUuid))] : [];
    const [source] = await db.select({ id: leadSources.id }).from(leadSources).where(eq(leadSources.id, sourceId)).limit(1);
    if (!source) return res.status(404).json({ message: 'Source not found' });
    if (userIds.length) {
      const valid = await db.select({ id: users.id }).from(users).where(and(eq(users.role, BDM_ROLE), sql`${users.id} IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})`));
      if (valid.length !== userIds.length) throw new HttpError(400, 'Only BDMs can be in a source team');
    }
    await db.transaction(async (tx) => {
      await tx.delete(leadSourceBdms).where(eq(leadSourceBdms.sourceId, sourceId));
      if (userIds.length) await tx.insert(leadSourceBdms).values(userIds.map((userId) => ({ sourceId, userId })));
    });
    // Leads that were waiting for this team may now have someone to go to
    const assignedWaiting = await assignWaitingLeads().catch(() => 0);
    res.json({ userIds, assignedWaiting });
  } catch (err) {
    sendError(res, err, 'Failed to save the source team');
  }
});

/** Imports rows that were in the sheet before it was connected (or Meta history from a date) */
router.post('/sources/:id/import-old', async (req, res) => {
  try {
    const [source] = await db.select().from(leadSources).where(eq(leadSources.id, req.params.id as string)).limit(1);
    if (!source) return res.status(404).json({ message: 'Source not found' });
    const mode = (['team', 'rotation', 'unassigned'] as const).includes(req.body?.mode) ? (req.body.mode as OldImportMode) : 'team';
    const from = isDateString(req.body?.from) ? req.body.from : undefined;
    const to = isDateString(req.body?.to) ? req.body.to : undefined;
    if (source.type === 'meta' && !metaConfigured()) throw new HttpError(400, 'Set META_ACCESS_TOKEN first to fetch old Meta leads');
    const progress = await startOldLeadsImport(source, { mode, from, to });
    res.status(202).json(progress);
  } catch (err) {
    sendError(res, err, 'Failed to start importing old leads');
  }
});

type Check = { key: string; name: string; status: 'ok' | 'warning' | 'error' | 'off'; detail: string; fix?: string };

/** One place to see whether every communication channel actually works */
router.get('/health', async (_req, res) => {
  try {
    const checks: Check[] = [];
    const timeout = AbortSignal.timeout(10_000);

    // Email (Resend)
    const emailFrom = process.env.EMAIL_FROM ?? '';
    const fromDomain = emailFrom.match(/@([^>\s]+)/)?.[1]?.toLowerCase();
    const [emailStats] = await db.execute<{ sent: number; failed: number; last_error: string | null }>(sql`
      SELECT count(*) FILTER (WHERE status = 'sent')::int AS sent, count(*) FILTER (WHERE status = 'failed')::int AS failed,
        (SELECT error FROM email_logs WHERE status = 'failed' ORDER BY created_at DESC LIMIT 1) AS last_error
      FROM email_logs WHERE created_at > now() - interval '7 days'`).then((r) => r.rows);
    if (!process.env.RESEND_API_KEY) {
      checks.push({ key: 'email', name: 'Email (Resend)', status: 'error', detail: 'RESEND_API_KEY is not set — no emails are sent', fix: 'Add RESEND_API_KEY in Vercel → Project → Settings → Environment Variables' });
    } else {
      try {
        const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, signal: timeout });
        const body = (await r.json()) as { data?: Array<{ name: string; status: string }>; message?: string; name?: string };
        if (!r.ok) {
          const restricted = body.name === 'restricted_api_key';
          checks.push({
            key: 'email', name: 'Email (Resend)', status: restricted ? 'warning' : 'error',
            detail: restricted ? 'API key can only send (domain status not readable)' : `Resend rejected the API key: ${body.message ?? r.status}`,
            fix: restricted ? undefined : 'Create a new API key in Resend and update RESEND_API_KEY',
          });
        } else {
          const domain = body.data?.find((d) => d.name.toLowerCase() === fromDomain);
          checks.push(
            domain?.status === 'verified'
              ? { key: 'email', name: 'Email (Resend)', status: 'ok', detail: `Sending from ${emailFrom} — ${fromDomain} verified` }
              : {
                  key: 'email', name: 'Email (Resend)', status: 'error',
                  detail: domain ? `Domain ${fromDomain} is "${domain.status}" in Resend — emails will fail` : `Domain ${fromDomain ?? '(none)'} is not added in Resend — emails will fail`,
                  fix: `In Resend → Domains, add ${fromDomain} and the DNS records it shows, or change EMAIL_FROM to a verified domain`,
                }
          );
        }
      } catch (err) {
        checks.push({ key: 'email', name: 'Email (Resend)', status: 'warning', detail: `Could not reach Resend: ${(err as Error).message}` });
      }
    }
    if (emailStats && (emailStats.sent || emailStats.failed)) {
      const last = checks[checks.length - 1];
      last.detail += ` · last 7 days: ${emailStats.sent} sent, ${emailStats.failed} failed`;
      if (emailStats.failed && !emailStats.sent && last.status === 'ok') {
        last.status = 'warning';
        last.detail += ` (last error: ${emailStats.last_error})`;
      }
    }

    // Live updates and background jobs (serverless: the website polls, jobs run on a schedule)
    const jobs = await jobStatus();
    const lateJobs = jobs.filter((j) => j.late);
    checks.push(
      lateJobs.length
        ? { key: 'realtime', name: 'Background jobs', status: 'warning', detail: `Not run recently: ${lateJobs.map((j) => j.label).join(', ')}`, fix: 'Jobs run while someone has the CRM or the phone app open. For 24/7 runs, call GET /api/cron/tick every minute (Vercel Cron on the Pro plan, or a free service like cron-job.org) with Authorization: Bearer CRON_SECRET' }
        : { key: 'realtime', name: 'Background jobs', status: 'ok', detail: jobs.map((j) => `${j.label}: ${j.lastRun ? `${Math.round((Date.now() - j.lastRun.getTime()) / 60_000)} min ago` : 'never'}`).join(' · ') }
    );

    // Google Sheets
    const sources = await db.select().from(leadSources);
    const sheets = sources.filter((s) => s.type === 'google_sheet' && s.active);
    const broken = sheets.filter((s) => s.lastError);
    const stale = sheets.filter((s) => !s.lastError && (!s.lastSyncedAt || Date.now() - s.lastSyncedAt.getTime() > 10 * 60_000));
    checks.push(
      !sheets.length
        ? { key: 'sheets', name: 'Google Sheets lead sync', status: 'off', detail: 'No sheet connected' }
        : broken.length
          ? { key: 'sheets', name: 'Google Sheets lead sync', status: 'error', detail: `${broken.map((s) => `${s.name}: ${s.lastError}`).join('; ')}` }
          : stale.length
            ? { key: 'sheets', name: 'Google Sheets lead sync', status: 'warning', detail: `${stale.map((s) => s.name).join(', ')} not checked in the last 10 minutes — see Background jobs` }
            : { key: 'sheets', name: 'Google Sheets lead sync', status: 'ok', detail: `${sheets.length} sheet${sheets.length === 1 ? '' : 's'} syncing every 2 minutes` }
    );

    // Meta Lead Ads
    if (!process.env.META_ACCESS_TOKEN) {
      checks.push({ key: 'meta', name: 'Meta Lead Ads (direct)', status: 'off', detail: 'Not connected — leads arrive through the Google Sheet instead', fix: 'Optional: set META_ACCESS_TOKEN, META_APP_SECRET, META_VERIFY_TOKEN for instant leads' });
    } else {
      try {
        const r = await fetch(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v21.0'}/me?fields=id,name&access_token=${encodeURIComponent(process.env.META_ACCESS_TOKEN)}`, { signal: timeout });
        const body = (await r.json()) as { name?: string; error?: { message: string } };
        const webhookReady = !!(process.env.META_APP_SECRET && process.env.META_VERIFY_TOKEN && publicApiUrl());
        checks.push(r.ok
          ? { key: 'meta', name: 'Meta Lead Ads (direct)', status: webhookReady ? 'ok' : 'warning', detail: `Token valid for "${body.name}"${webhookReady ? ' · webhook ready' : ' · polling only (no public webhook URL / app secret)'}` }
          : { key: 'meta', name: 'Meta Lead Ads (direct)', status: 'error', detail: `Meta rejected the token: ${body.error?.message}`, fix: 'Generate a new long-lived Page access token with leads_retrieval' });
      } catch (err) {
        checks.push({ key: 'meta', name: 'Meta Lead Ads (direct)', status: 'warning', detail: `Could not reach Meta: ${(err as Error).message}` });
      }
    }

    // Calling service
    const tel = exotelStatus();
    if (!exotelConfigured()) {
      checks.push({ key: 'telephony', name: 'Calling service (Exotel)', status: 'off', detail: 'Not connected — the Call button opens the phone dialler; the Android app logs the call', fix: 'Optional: set EXOTEL_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN, EXOTEL_CALLER_ID for recorded company-number calls' });
    } else {
      try {
        const sub = process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com';
        const r = await fetch(`https://${sub}/v1/Accounts/${process.env.EXOTEL_SID}.json`, {
          headers: { Authorization: `Basic ${Buffer.from(`${process.env.EXOTEL_API_KEY}:${process.env.EXOTEL_API_TOKEN}`).toString('base64')}` },
          signal: timeout,
        });
        checks.push(r.ok
          ? { key: 'telephony', name: 'Calling service (Exotel)', status: 'ok', detail: `Connected · caller ID ${tel.callerId} · ${tel.webhook ? 'instant status webhook' : 'status checked every minute'}${tel.recording ? ' · recording on' : ''}` }
          : { key: 'telephony', name: 'Calling service (Exotel)', status: 'error', detail: `Exotel rejected the credentials (${r.status})`, fix: 'Check EXOTEL_SID / API key / token and EXOTEL_SUBDOMAIN (api.exotel.com or api.in.exotel.com)' });
      } catch (err) {
        checks.push({ key: 'telephony', name: 'Calling service (Exotel)', status: 'warning', detail: `Could not reach Exotel: ${(err as Error).message}` });
      }
    }

    // File storage (payment screenshots, project files): a real write, read and delete
    if (!r2Configured()) {
      checks.push(process.env.VERCEL
        ? { key: 'storage', name: 'File storage (Cloudflare R2)', status: 'error', detail: 'Not configured — uploads will fail on Vercel', fix: 'Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET, then redeploy' }
        : { key: 'storage', name: 'File storage', status: 'ok', detail: 'Local disk (development) — set the R2_* variables to use Cloudflare R2' });
    } else {
      const probe = `health/${Date.now()}.txt`;
      try {
        await putObject(probe, Buffer.from('ok'), 'text/plain');
        const read = await getObject(probe);
        read?.stream.resume();
        await deleteObject(probe);
        checks.push(read
          ? { key: 'storage', name: 'File storage (Cloudflare R2)', status: 'ok', detail: `Bucket ${process.env.R2_BUCKET} — upload, download and delete work` }
          : { key: 'storage', name: 'File storage (Cloudflare R2)', status: 'error', detail: 'A test file was uploaded but could not be read back' });
      } catch (err) {
        checks.push({ key: 'storage', name: 'File storage (Cloudflare R2)', status: 'error', detail: (err as Error).message, fix: 'Check the R2 token has Object Read & Write on the bucket, and the account ID and bucket name' });
      }
    }

    // Phone call-sync app
    const [devices] = await db.execute<{ total: number; recent: number; bdms: number; no_permission: number; ready_to_dial: number }>(sql`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE last_sync_at > now() - interval '1 hour')::int AS recent,
        (SELECT count(*)::int FROM users WHERE role = 'SALES' AND is_active) AS bdms,
        count(*) FILTER (WHERE NOT permission_granted)::int AS no_permission,
        count(*) FILTER (WHERE can_dial AND last_seen_at > now() - interval '75 seconds')::int AS ready_to_dial
      FROM mobile_devices`).then((r) => r.rows);
    checks.push(
      !devices.total
        ? { key: 'phones', name: 'Phone call tracking (Android app)', status: 'off', detail: `No phones connected yet (${devices.bdms} BDMs)`, fix: 'Install the Voice Tunes India app on each BDM phone and sign in' }
        : { key: 'phones', name: 'Phone call tracking (Android app)', status: devices.no_permission ? 'warning' : 'ok', detail: `${devices.total} phone${devices.total === 1 ? '' : 's'} connected, ${devices.recent} synced in the last hour · ${devices.ready_to_dial} ready for the Call button${devices.no_permission ? ` · ${devices.no_permission} without call-log permission` : ''}` }
    );

    // Call recordings → text, and the super admin's assistant
    const [rec] = await db.execute<{ total: number; transcribed: number; waiting: number; failed: number; last_error: string | null }>(sql`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'transcribed')::int AS transcribed,
        count(*) FILTER (WHERE status IN ('uploaded', 'transcribing'))::int AS waiting, count(*) FILTER (WHERE status = 'failed')::int AS failed,
        (SELECT error FROM call_recordings WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 1) AS last_error
      FROM call_recordings WHERE created_at > now() - interval '7 days'`).then((r) => r.rows);
    const speech = speechStatus();
    const recDetail = `last 7 days: ${rec.total} recording${rec.total === 1 ? '' : 's'}, ${rec.transcribed} transcribed, ${rec.waiting} waiting, ${rec.failed} failed`;
    checks.push(
      !speech.configured
        ? { key: 'transcripts', name: 'Call recording transcripts', status: rec.total ? 'warning' : 'off', detail: `Speech to text not set up — recordings are kept but not converted to text · ${recDetail}`, fix: 'Set TRANSCRIBE_API_KEY (OpenAI key, or Groq with TRANSCRIBE_BASE_URL=https://api.groq.com/openai/v1 and TRANSCRIBE_MODEL=whisper-large-v3)' }
        : { key: 'transcripts', name: 'Call recording transcripts', status: rec.failed && !rec.transcribed ? 'error' : rec.failed ? 'warning' : 'ok', detail: `${speech.model} on ${speech.host} · ${recDetail}${rec.failed ? ` (last error: ${rec.last_error})` : ''}${aiConfigured() ? ' · summaries on' : ''}` }
    );
    checks.push(
      aiConfigured()
        ? { key: 'assistant', name: 'AI Assistant (Claude)', status: 'ok', detail: `${AI_MODEL} — super admin chat and call summaries` }
        : { key: 'assistant', name: 'AI Assistant (Claude)', status: 'off', detail: 'Not set up — the AI Assistant page and call summaries are unavailable', fix: 'Set ANTHROPIC_API_KEY (console.anthropic.com → API keys)' }
    );

    // WhatsApp
    checks.push(
      process.env.WHATSAPP_ACCESS_TOKEN
        ? { key: 'whatsapp', name: 'WhatsApp', status: 'ok', detail: 'WhatsApp Cloud API token set' }
        : { key: 'whatsapp', name: 'WhatsApp', status: 'warning', detail: 'Click-to-chat only: BDMs open WhatsApp with the customer, and the CRM logs that the chat was opened (not the messages)', fix: 'For automatic messages and a message log, connect the WhatsApp Business Cloud API (Meta) or a BSP like Interakt / AiSensy / Gupshup' }
    );

    // Webhooks need a public address
    checks.push(
      publicApiUrl()
        ? { key: 'public', name: 'Public API address (webhooks)', status: 'ok', detail: publicApiUrl()! }
        : { key: 'public', name: 'Public API address (webhooks)', status: 'warning', detail: 'Running on localhost — Meta and Exotel cannot push events instantly, so the app polls instead', fix: 'For instant webhooks run a tunnel (ngrok / Cloudflare Tunnel) and set PUBLIC_API_URL' }
    );

    res.json({ checkedAt: new Date(), checks, telephony: tel });
  } catch (err) {
    sendError(res, err, 'Health check failed');
  }
});

router.delete('/sources/:id', async (req, res) => {
  try {
    const [deleted] = await db.delete(leadSources).where(eq(leadSources.id, req.params.id as string)).returning({ id: leadSources.id });
    if (!deleted) return res.status(404).json({ message: 'Source not found' });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to delete lead source');
  }
});

router.post('/sources/:id/sync', async (req, res) => {
  try {
    const [source] = await db.select().from(leadSources).where(eq(leadSources.id, req.params.id as string)).limit(1);
    if (!source) return res.status(404).json({ message: 'Source not found' });
    const summary = await syncSource(source);
    res.json(summary);
  } catch (err) {
    sendError(res, new HttpError(400, (err as Error).message), 'Sync failed');
  }
});

// ─── Imported rows: Real Time Data & Verify Data ───────────────────────────────────────────────────────────────

router.get('/imports', async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
    const sourceId = optionalId(req.query.sourceId, 'sourceId');
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const range = isDateString(req.query.from) || isDateString(req.query.to) ? dateRange(req.query, 7) : null;
    const where = and(
      status ? eq(leadImports.status, status as 'imported') : sql`${leadImports.status} <> 'ignored'`,
      sourceId ? eq(leadImports.sourceId, sourceId) : undefined,
      range ? sql`${localDate(leadImports.receivedAt)} BETWEEN ${range.from} AND ${range.to}` : undefined
    );
    const [rows, [{ total }], statusCounts] = await Promise.all([
      db
        .select({
          id: leadImports.id,
          status: leadImports.status,
          error: leadImports.error,
          raw: leadImports.raw,
          campaign: leadImports.campaign,
          receivedAt: leadImports.receivedAt,
          externalId: leadImports.externalId,
          sourceName: leadSources.name,
          sourceType: leadSources.type,
          leadId: leadImports.leadId,
          leadName: leads.companyName,
          leadStage: leads.stage,
        })
        .from(leadImports)
        .innerJoin(leadSources, eq(leadSources.id, leadImports.sourceId))
        .leftJoin(leads, eq(leads.id, leadImports.leadId))
        .where(where)
        .orderBy(desc(leadImports.receivedAt))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ total: count() }).from(leadImports).where(where),
      db.select({ status: leadImports.status, count: count() }).from(leadImports).groupBy(leadImports.status),
    ]);
    res.json({ rows: rows.map((r) => ({ ...r, mapped: mapLeadFields(r.raw) })), total, page, limit, statusCounts });
  } catch (err) {
    sendError(res, err, 'Failed to fetch imported rows');
  }
});

/** Re-runs a failed row (e.g. after fixing a missing phone number in the sheet or adding a BDM) */
router.post('/imports/:id/retry', async (req, res) => {
  try {
    const [row] = await db.select().from(leadImports).where(eq(leadImports.id, req.params.id as string)).limit(1);
    if (!row) return res.status(404).json({ message: 'Row not found' });
    if (row.status === 'imported') throw new HttpError(400, 'This row already created a lead');
    const [source] = await db.select().from(leadSources).where(eq(leadSources.id, row.sourceId)).limit(1);
    const raw = { ...row.raw, ...(req.body?.overrides && typeof req.body.overrides === 'object' ? req.body.overrides : {}) };
    await db.delete(leadImports).where(eq(leadImports.id, row.id));
    const outcome = await importRow(source, raw, row.externalId);
    res.json({ outcome });
  } catch (err) {
    sendError(res, err, 'Retry failed');
  }
});

router.post('/imports/:id/ignore', async (req: AuthRequest, res) => {
  try {
    const [row] = await db
      .update(leadImports)
      .set({ status: 'ignored', resolvedBy: req.user!.id, error: typeof req.body?.reason === 'string' ? req.body.reason : 'Ignored by admin' })
      .where(and(eq(leadImports.id, req.params.id as string), sql`${leadImports.status} <> 'imported'`))
      .returning({ id: leadImports.id });
    if (!row) return res.status(404).json({ message: 'Row not found or already imported' });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to ignore row');
  }
});

export default router;
