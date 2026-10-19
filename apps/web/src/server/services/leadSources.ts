import crypto from 'crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { leadImports, leadSourceBdms, leadSources, users, type LeadSourceConfig } from '../db/schema';
import { readSheetRows } from './googleSheets';
import { intakeLead } from './leadIntake';
import { notifyAssignees } from './leadAssignment';

type LeadSource = typeof leadSources.$inferSelect;

// ─── Field mapping shared by Google Sheets and Meta ──────────────────────────────────────────────────────────

const FIELD_ALIASES: Record<string, string[]> = {
  externalId: ['id', 'lead_id', 'leadgen_id'],
  name: ['full_name', 'name', 'customer_name', 'your_name', 'full name'],
  firstName: ['first_name'],
  lastName: ['last_name'],
  phone: ['phone_number', 'phone', 'mobile', 'mobile_number', 'contact_number', 'whatsapp_number', 'phone number'],
  email: ['email', 'email_address'],
  city: ['city', 'town_city', 'town', 'location', 'your_city'],
  campaign: ['campaign_name', 'campaign'],
  adName: ['ad_name'],
  formName: ['form_name'],
  platform: ['platform'],
  createdTime: ['created_time', 'created_at', 'date', 'timestamp'],
  service: ['service', 'services', 'what_services_are_you_looking_for', 'service_required', 'course', 'interested_in', 'program'],
};

const IGNORED_EXTRA = new Set(['ad_id', 'adset_id', 'adset_name', 'campaign_id', 'form_id', 'is_organic', 'lead_status']);

/** "Town/City", "what services are you looking for?" → town_city, what_services_are_you_looking_for */
const normalizeKey = (key: string) => key.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
/** Meta sheets prefix values like "p:+9198…" and "l:1234…" */
const clean = (value: unknown) => (value == null ? '' : String(value).trim().replace(/^[a-z]{1,2}:/i, ''));

export function mapLeadFields(raw: Record<string, unknown>) {
  const byKey = new Map(Object.entries(raw).map(([k, v]) => [normalizeKey(k), v]));
  const used = new Set<string>();
  const pick = (field: string) => {
    for (const alias of FIELD_ALIASES[field]) {
      const key = normalizeKey(alias);
      const value = clean(byKey.get(key));
      if (value) {
        used.add(key);
        return value;
      }
    }
    return '';
  };

  const first = pick('firstName');
  const last = pick('lastName');
  const readable = (v: string) => (/^[a-z0-9_,]+$/i.test(v) && v.includes('_') ? v.replace(/_/g, ' ').replace(/\s*,\s*/g, ', ') : v);
  const mapped = {
    externalId: pick('externalId'),
    name: pick('name') || [first, last].filter(Boolean).join(' '),
    phone: pick('phone'),
    email: pick('email'),
    city: pick('city'),
    campaign: pick('campaign'),
    adName: pick('adName'),
    formName: pick('formName'),
    platform: pick('platform'),
    createdTime: pick('createdTime'),
    service: readable(pick('service')),
  };
  // Custom form questions go into the lead notes so the BDM sees the answers
  const extras = [...byKey.entries()]
    .filter(([k, v]) => !used.has(k) && !IGNORED_EXTRA.has(k) && clean(v))
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${readable(clean(v))}`);
  return { ...mapped, notes: extras.join('\n') };
}

function fallbackExternalId(raw: Record<string, unknown>) {
  return 'row:' + crypto.createHash('sha1').update(JSON.stringify(raw)).digest('hex').slice(0, 24);
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 86_400_000 ? null : d;
}

// ─── Import pipeline ─────────────────────────────────────────────────────────────────────────────────────────

export type ImportOutcome = 'imported' | 'duplicate' | 'error' | 'skipped';

/** Records the raw row and turns it into a lead. Idempotent per (source, externalId). */
export async function importRow(
  source: LeadSource,
  raw: Record<string, unknown>,
  externalId?: string,
  options: { assignTo?: string | null; leaveUnassigned?: boolean; history?: boolean; onCreated?: (assignedTo: string | null) => void } = {}
): Promise<ImportOutcome> {
  const fields = mapLeadFields(raw);
  const extId = externalId || fields.externalId || fallbackExternalId(raw);

  // Claim the row first so concurrent syncs/webhooks can't import it twice
  const [claimed] = await db
    .insert(leadImports)
    .values({ sourceId: source.id, externalId: extId, status: 'error', error: 'Processing', raw, campaign: fields.campaign || null })
    .onConflictDoNothing()
    .returning({ id: leadImports.id });
  if (!claimed) return 'skipped';

  if (!fields.name && !fields.phone) {
    await db.update(leadImports).set({ status: 'error', error: 'Row has no name or phone number' }).where(eq(leadImports.id, claimed.id));
    return 'error';
  }

  try {
    const result = await intakeLead({
      name: fields.name || fields.phone,
      phone: fields.phone || null,
      email: fields.email || null,
      city: fields.city || null,
      campaign: fields.campaign || null,
      adName: fields.adName || null,
      formName: fields.formName || null,
      platform: fields.platform || null,
      service: fields.service || null,
      serviceId: source.defaultServiceId,
      notes: fields.notes || null,
      source: source.type === 'meta' ? 'Meta Ads' : 'Google Sheet',
      sourceId: source.id,
      externalId: extId,
      createdAt: parseDate(fields.createdTime),
      assignTo: options.assignTo ?? null,
      leaveUnassigned: options.leaveUnassigned,
      history: options.history,
    });
    await db
      .update(leadImports)
      .set({ status: result.status === 'created' ? 'imported' : 'duplicate', error: null, leadId: result.leadId })
      .where(eq(leadImports.id, claimed.id));
    if (result.status === 'created') options.onCreated?.(result.assignedTo);
    return result.status === 'created' ? 'imported' : 'duplicate';
  } catch (err) {
    await db.update(leadImports).set({ status: 'error', error: (err as Error).message }).where(eq(leadImports.id, claimed.id));
    return 'error';
  }
}

export interface SyncSummary {
  received: number;
  imported: number;
  duplicate: number;
  error: number;
  skipped: number;
  baseline?: number;
}

const syncing = new Set<string>();

/** Pulls new rows from a Google Sheet or Meta lead forms. Safe to call repeatedly. */
export async function syncSource(source: LeadSource): Promise<SyncSummary> {
  if (syncing.has(source.id)) return { received: 0, imported: 0, duplicate: 0, error: 0, skipped: 0 };
  syncing.add(source.id);
  const summary: SyncSummary = { received: 0, imported: 0, duplicate: 0, error: 0, skipped: 0 };
  try {
    if (source.type === 'google_sheet') return await syncSheet(source, summary);

    const rows = await metaRows(source);
    summary.received = rows.length;
    for (const row of await unseen(source, rows)) summary[await importRow(source, row.raw, row.externalId)]++;
    await db.update(leadSources).set({ lastSyncedAt: new Date(), lastError: null }).where(eq(leadSources.id, source.id));
    return summary;
  } catch (err) {
    await db.update(leadSources).set({ lastError: (err as Error).message, lastSyncedAt: new Date() }).where(eq(leadSources.id, source.id));
    throw err;
  } finally {
    syncing.delete(source.id);
  }
}

type SourceRow = { raw: Record<string, unknown>; externalId: string };

/** Rows not recorded yet, with one query per thousand instead of one per row */
async function unseen(source: LeadSource, rows: SourceRow[]): Promise<SourceRow[]> {
  const ids = rows.map((r) => r.externalId);
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i += 1000) {
    const found = await db
      .select({ externalId: leadImports.externalId })
      .from(leadImports)
      .where(and(eq(leadImports.sourceId, source.id), inArray(leadImports.externalId, ids.slice(i, i + 1000))));
    found.forEach((f) => seen.add(f.externalId));
  }
  return rows.filter((r) => !seen.has(r.externalId));
}

/**
 * Reads every ticked tab (or, with none ticked, the first tab). The first time a tab is read its rows are only
 * remembered, so a tab ticked later brings in its new rows and not its history — unless the source imports history.
 */
async function syncSheet(source: LeadSource, summary: SyncSummary): Promise<SyncSummary> {
  const config: LeadSourceConfig = source.config;
  if (!config.sheetUrl) throw new Error('No sheet link configured');
  const tabs: Array<{ gid: string; title: string } | null> = config.sheetTabs?.length ? config.sheetTabs : [null];
  const baselined = new Set(config.baselinedTabs ?? []);
  const failed: string[] = [];
  let baselineDone = !!config.baselineDone;

  for (const tab of tabs) {
    try {
      const read = await readSheetRows(config.sheetUrl, tab ? undefined : config.sheetName, tab?.gid);
      const rows = read.map((raw) => ({ raw: raw as Record<string, unknown>, externalId: mapLeadFields(raw).externalId || fallbackExternalId(raw) }));
      summary.received += rows.length;
      const fresh = await unseen(source, rows);
      const known = tab ? baselined.has(tab.gid) : baselineDone;
      if (!known && !config.importExisting) {
        for (let i = 0; i < fresh.length; i += 500) {
          await db
            .insert(leadImports)
            .values(
              fresh.slice(i, i + 500).map((r) => ({
                sourceId: source.id,
                externalId: r.externalId,
                status: 'ignored' as const,
                error: OLD_ROW_NOTE,
                raw: r.raw,
                campaign: mapLeadFields(r.raw).campaign || null,
              }))
            )
            .onConflictDoNothing();
        }
        summary.baseline = (summary.baseline ?? 0) + fresh.length;
      } else {
        for (const row of fresh) summary[await importRow(source, row.raw, row.externalId)]++;
      }
      if (tab) baselined.add(tab.gid);
      else baselineDone = true;
    } catch (err) {
      failed.push(tab ? `${tab.title}: ${(err as Error).message}` : (err as Error).message);
    }
  }

  // Tabs that were read stay recorded even when another tab failed
  await db
    .update(leadSources)
    .set({ config: sql`${leadSources.config} || ${JSON.stringify({ baselineDone, baselinedTabs: [...baselined] })}::jsonb` })
    .where(eq(leadSources.id, source.id));
  if (failed.length) throw new Error(failed.join('; '));
  await db.update(leadSources).set({ lastSyncedAt: new Date(), lastError: null }).where(eq(leadSources.id, source.id));
  return summary;
}

// ─── Meta Lead Ads ───────────────────────────────────────────────────────────────────────────────────────────

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v21.0'}`;
const LEAD_FIELDS = 'id,created_time,field_data,ad_name,adset_name,campaign_name,form_id,platform,is_organic';

export const metaConfigured = () => !!process.env.META_ACCESS_TOKEN;

type MetaLead = {
  id: string;
  created_time?: string;
  field_data?: Array<{ name: string; values: string[] }>;
  ad_name?: string;
  adset_name?: string;
  campaign_name?: string;
  form_id?: string;
  platform?: string;
};

/** Flattens a Graph API lead into the same shape a Meta→Google Sheet row has */
function flattenMetaLead(lead: MetaLead): Record<string, unknown> {
  const answers = Object.fromEntries((lead.field_data ?? []).map((f) => [f.name, f.values?.join(', ') ?? '']));
  return {
    id: lead.id,
    created_time: lead.created_time,
    campaign_name: lead.campaign_name,
    ad_name: lead.ad_name,
    adset_name: lead.adset_name,
    form_id: lead.form_id,
    platform: lead.platform,
    ...answers,
  };
}

async function graphGet<T>(path: string): Promise<T> {
  const url = path.startsWith('http') ? path : `${GRAPH}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(process.env.META_ACCESS_TOKEN!)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const data = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok || data.error) throw new Error(`Meta API: ${data.error?.message ?? res.status}`);
  return data;
}

async function metaRows(source: LeadSource, sinceDate?: Date) {
  if (!metaConfigured()) throw new Error('META_ACCESS_TOKEN is not set (Vercel environment variables, or apps/web/.env.local)');
  const formIds = source.config.formIds ?? [];
  if (!formIds.length) throw new Error('Add at least one lead form ID to poll (webhooks need no form IDs)');
  // Look back from the last sync (with overlap) or from when the source was added
  const since = Math.floor((sinceDate ? sinceDate.getTime() : (source.lastSyncedAt ?? source.createdAt).getTime() - 60 * 60 * 1000) / 1000);
  const rows: Array<{ raw: Record<string, unknown>; externalId: string }> = [];
  for (const formId of formIds) {
    const filtering = encodeURIComponent(JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: since }]));
    let next: string | undefined = `${formId}/leads?fields=${LEAD_FIELDS}&limit=100&filtering=${filtering}`;
    for (let page = 0; next && page < 50; page++) {
      const data: { data: MetaLead[]; paging?: { next?: string } } = await graphGet(next);
      for (const lead of data.data) rows.push({ raw: flattenMetaLead(lead), externalId: lead.id });
      next = data.paging?.next;
    }
  }
  // Oldest first so round-robin order follows arrival order
  return rows.reverse();
}

export function verifyMetaSignature(rawBody: Buffer | undefined, signatureHeader: string | undefined): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !rawBody || !signatureHeader?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const given = signatureHeader.slice(7);
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Finds (or creates) the Meta lead source for a page */
async function metaSourceFor(pageId?: string): Promise<LeadSource> {
  const sources = await db.select().from(leadSources).where(and(eq(leadSources.type, 'meta'), eq(leadSources.active, true)));
  const match = sources.find((s) => pageId && s.config.pageId === pageId) ?? sources.find((s) => !s.config.pageId) ?? sources[0];
  if (match) return match;
  const [created] = await db
    .insert(leadSources)
    .values({ name: 'Meta Lead Ads', type: 'meta', config: pageId ? { pageId } : {} })
    .returning();
  return created;
}

/** Handles a leadgen webhook payload: fetches each lead from the Graph API and imports it */
export async function handleMetaWebhook(payload: {
  entry?: Array<{ changes?: Array<{ field?: string; value?: { leadgen_id?: string; page_id?: string } }> }>;
}): Promise<number> {
  let processed = 0;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const leadId = change.field === 'leadgen' ? change.value?.leadgen_id : undefined;
      if (!leadId) continue;
      const source = await metaSourceFor(change.value?.page_id);
      try {
        const lead = await graphGet<MetaLead>(`${leadId}?fields=${LEAD_FIELDS}`);
        await importRow(source, flattenMetaLead(lead), lead.id);
      } catch (err) {
        await db
          .insert(leadImports)
          .values({ sourceId: source.id, externalId: leadId, status: 'error', error: (err as Error).message, raw: change.value ?? {} })
          .onConflictDoNothing();
      }
      processed++;
    }
  }
  return processed;
}

// ─── Old leads (rows that existed before the source was connected) ───────────────────────────────────────────

export const OLD_ROW_NOTE = 'Already in the sheet when it was connected';

export type OldImportMode = 'team' | 'rotation' | 'unassigned';

export interface OldImportProgress {
  status: 'running' | 'done' | 'failed';
  mode: OldImportMode;
  total: number;
  processed: number;
  imported: number;
  duplicate: number;
  error: number;
  byUser: Record<string, number>;
  startedAt: string;
  finishedAt?: string;
  message?: string;
}

const oldImports = new Map<string, OldImportProgress>();
export const oldImportProgress = (sourceId: string) => oldImports.get(sourceId) ?? null;

/**
 * Turns old rows into leads, oldest first.
 * - team: split evenly across the sheet's team (or every active BDM), online or not — people with fewer open leads first
 * - rotation: normal round-robin among BDMs online right now (leads wait if nobody is)
 * - unassigned: no owner; hand them out later from Lead Transfer / the lead window
 * Meta sources fetch history from the given date instead of reading stored rows.
 */
export async function startOldLeadsImport(source: LeadSource, opts: { mode: OldImportMode; from?: string; to?: string }): Promise<OldImportProgress> {
  const running = oldImports.get(source.id);
  if (running?.status === 'running') return running;
  const progress: OldImportProgress = {
    status: 'running', mode: opts.mode, total: 0, processed: 0, imported: 0, duplicate: 0, error: 0, byUser: {}, startedAt: new Date().toISOString(),
  };
  oldImports.set(source.id, progress);

  void (async () => {
    try {
      const inRange = (created: Date | null) =>
        (!opts.from || (created && created.toISOString().slice(0, 10) >= opts.from)) &&
        (!opts.to || (created && created.toISOString().slice(0, 10) <= opts.to));

      let rows: Array<{ raw: Record<string, unknown>; externalId: string; storedId?: string }>;
      if (source.type === 'meta') {
        rows = (await metaRows(source, opts.from ? new Date(`${opts.from}T00:00:00Z`) : new Date(Date.now() - 90 * 86_400_000)))
          .filter((r) => inRange(parseDate(mapLeadFields(r.raw).createdTime)));
        const known = new Set(
          (await db.select({ id: leadImports.externalId }).from(leadImports).where(and(eq(leadImports.sourceId, source.id), sql`${leadImports.status} <> 'ignored'`))).map((r) => r.id)
        );
        rows = rows.filter((r) => !known.has(r.externalId));
      } else {
        const stored = await db
          .select({ id: leadImports.id, raw: leadImports.raw, externalId: leadImports.externalId })
          .from(leadImports)
          .where(and(eq(leadImports.sourceId, source.id), eq(leadImports.status, 'ignored'), eq(leadImports.error, OLD_ROW_NOTE)));
        rows = stored.map((r) => ({ raw: r.raw, externalId: r.externalId, storedId: r.id })).filter((r) => inRange(parseDate(mapLeadFields(r.raw).createdTime)));
      }
      rows.sort((a, b) => (parseDate(mapLeadFields(a.raw).createdTime)?.getTime() ?? 0) - (parseDate(mapLeadFields(b.raw).createdTime)?.getTime() ?? 0));
      progress.total = rows.length;

      // Even split: team members (or all active BDMs), fewest open leads first
      let cycle: string[] = [];
      if (opts.mode === 'team') {
        const team = await db.select({ userId: leadSourceBdms.userId }).from(leadSourceBdms).where(eq(leadSourceBdms.sourceId, source.id));
        const members = await db
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.role, 'SALES'),
              eq(users.isActive, true),
              team.length ? inArray(users.id, team.map((t) => t.userId)) : undefined
            )
          )
          .orderBy(asc(sql`(SELECT count(*) FROM leads l WHERE l.assigned_to = "users"."id" AND l.stage NOT IN ('WON', 'LOST'))`), asc(users.rotationPosition));
        cycle = members.map((m) => m.id);
        if (!cycle.length) throw new Error('No active BDMs to share the old leads with — add BDMs or choose "keep unassigned"');
      }

      let turn = 0;
      for (const row of rows) {
        if (row.storedId) await db.delete(leadImports).where(eq(leadImports.id, row.storedId));
        const assignTo = opts.mode === 'team' ? cycle[turn % cycle.length] : null;
        const outcome = await importRow(source, row.raw, row.externalId, {
          history: true,
          leaveUnassigned: opts.mode === 'unassigned',
          assignTo,
          onCreated: (owner) => {
            if (owner) progress.byUser[owner] = (progress.byUser[owner] ?? 0) + 1;
          },
        });
        if (outcome === 'imported') {
          progress.imported++;
          if (assignTo) turn++;
        } else if (outcome === 'duplicate') progress.duplicate++;
        else if (outcome === 'error') progress.error++;
        progress.processed++;
      }

      // One summary notification per person instead of one per lead
      if (Object.keys(progress.byUser).length) {
        await notifyAssignees(Object.entries(progress.byUser).map(([userId, count]) => ({ userId, count, sample: `Old leads from ${source.name}` })));
      }
      progress.status = 'done';
    } catch (err) {
      progress.status = 'failed';
      progress.message = (err as Error).message;
    } finally {
      progress.finishedAt = new Date().toISOString();
    }
  })();

  return progress;
}
