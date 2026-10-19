/**
 * Imports the former PHP CRM (MySQL, phpMyAdmin dump "tornaawp_vti.sql") into this database: its BDMs as
 * sales logins, every lead with its full call / follow-up history, lead transfers and automatic
 * assignments, and the raw Meta lead-form rows.
 *
 *   pnpm import:legacy-crm --file "/path/to/tornaawp_vti.sql" [--dry-run] [--logins legacy-bdm-logins.csv]
 *
 * The dump is read directly; no MySQL is needed. Safe to re-run: leads are keyed by their old id, follow-ups
 * and assignments carry their old ids, and BDMs are matched by username or name, so nothing is duplicated.
 *
 * - BDMs: Khushbu (4) and Krishna (11) are merged into Khushbu_vti (12) and krishnavti (10). Each BDM keeps
 *   their old username (sign-in ignores case); an account that already exists here (same username, or a
 *   sales user with the same first name) is reused untouched. New accounts get a random password, written
 *   with the usernames to the --logins CSV. They start out of the lead rotation.
 * - Leads: the old CRM is the record. Each of its leads is its own lead here, and a re-run is a sync: a lead
 *   imported earlier is updated to match the old CRM as it is now (stage, BDM, follow-up date, remarks…),
 *   unless someone has since worked on it in this CRM. A lead made here that nobody has worked on is moved to
 *   the BDM who has that number in the old CRM. Old statuses map onto the CRM
 *   stages; the exact old status is kept as the lead's status label. Follow-ups keep their call activity,
 *   status, remarks, call time and reason. --skip-refresh leaves records imported earlier as they are.
 * - Campaign → BDM rules become this CRM's campaign rules (they apply only while those BDMs are Started).
 * - Times in the old database are India time.
 * - Archive: every row of every old table — also the ones this CRM has no screen for (payments ledger,
 *   bookings, menus, logs) — is kept as it was in legacy_archive (CRM Admin → Old CRM Archive), except
 *   plain-text passwords and API tokens.
 */
import '../env';
import { mergeIntoOldCrmLeads } from '../services/legacyMerge';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { randomInt } from 'crypto';
import { eq, like, sql } from 'drizzle-orm';
import { db, pool } from '../db/index';
import { runMigrations } from '../db/migrate';
import {
  campaignBdmRules,
  legacyArchive,
  leadAssignments,
  leadFollowups,
  leadImports,
  leadSources,
  leads,
  services,
  users,
  type FollowupOutcome,
  type LeadImportStatus,
  type LeadStage,
} from '../db/schema';
import { normalizePhone } from '../lib/crm';
import { hashPassword } from '../utils/password';

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY_RUN = args.includes('--dry-run');
/** Compare the dump with what is in the database, row by row, and change nothing */
const VERIFY = args.includes('--verify');
/** Leave records imported earlier as they are (only add what is missing) */
const SKIP_REFRESH = args.includes('--skip-refresh');
const FILE = arg('--file');
const LOGINS = arg('--logins') ?? 'legacy-bdm-logins.csv';
if (!FILE) {
  console.error('Usage: pnpm import:legacy-crm --file "/path/to/tornaawp_vti.sql" [--dry-run] [--skip-refresh] [--logins legacy-bdm-logins.csv]');
  process.exit(1);
}

const stats: Record<string, Record<string, number>> = {};
const tally = (table: string, kind: string, n = 1) => {
  stats[table] ??= {};
  stats[table][kind] = (stats[table][kind] ?? 0) + n;
};

// ─── Reading the phpMyAdmin dump ──────────────────────────────────────────────────────────────────────────────

type Row = Record<string, string | null>;

/** Every `INSERT INTO table (…) VALUES (…), (…);` in the dump, as rows keyed by column name */
function parseDump(text: string): Map<string, Row[]> {
  const tables = new Map<string, Row[]>();
  const head = /INSERT INTO `([^`]+)` \(([^)]*)\) VALUES\s*/g;
  let m: RegExpExecArray | null;
  while ((m = head.exec(text))) {
    const table = m[1];
    let i = head.lastIndex;
    const columns = m[2].split(',').map((c) => c.trim().replace(/`/g, ''));
    const rows = tables.get(table) ?? [];
    // Walk the value tuples up to the statement's closing semicolon (strings may hold ; and parentheses)
    while (i < text.length) {
      while (/\s|,/.test(text[i])) i++;
      if (text[i] === ';') break;
      if (text[i] !== '(') throw new Error(`Unexpected "${text.slice(i, i + 20)}" in ${table}`);
      i++;
      const values: (string | null)[] = [];
      for (;;) {
        while (text[i] === ' ' || text[i] === '\n' || text[i] === '\r' || text[i] === '\t') i++;
        if (text[i] === "'") {
          let s = '';
          i++;
          for (;;) {
            const c = text[i];
            if (c === '\\') {
              const n = text[i + 1];
              s += n === 'n' ? '\n' : n === 'r' ? '\r' : n === 't' ? '\t' : n === '0' ? '\0' : n === 'Z' ? '\x1a' : n === 'b' ? '\b' : n;
              i += 2;
            } else if (c === "'" && text[i + 1] === "'") {
              s += "'";
              i += 2;
            } else if (c === "'") {
              i++;
              break;
            } else {
              s += c;
              i++;
            }
          }
          values.push(s);
        } else {
          let j = i;
          while (text[j] !== ',' && text[j] !== ')') j++;
          const raw = text.slice(i, j).trim();
          values.push(raw.toUpperCase() === 'NULL' ? null : raw);
          i = j;
        }
        while (text[i] === ' ') i++;
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ')') { i++; break; }
        throw new Error(`Malformed row in ${table} near "${text.slice(i, i + 30)}"`);
      }
      const row: Row = {};
      columns.forEach((c, k) => (row[c] = values[k] ?? null));
      rows.push(row);
    }
    tables.set(table, rows);
    head.lastIndex = i;
  }
  return tables;
}

// ─── Mapping helpers ──────────────────────────────────────────────────────────────────────────────────────────

const clean = (v: string | null | undefined) => {
  const s = (v ?? '').replace(/\r/g, '').trim();
  return s || null;
};
const int = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);
/** Old datetimes are India time with no zone; zero dates mean "none" */
const ist = (v: string | null | undefined): Date | null => {
  if (!v || v.startsWith('0000')) return null;
  const d = new Date(`${v.trim().replace(' ', 'T')}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** The archive row holding a table's column order */
const COLUMNS_KEY = '__columns';

/** Columns whose values are never copied into the archive: old plain-text passwords and API tokens */
const SECRET_COLUMN = /password|token|secret|api_key/i;

/** Old BDM ids that are the same person as another id */
const MERGED_BDMS: Record<number, number> = { 4: 12, 11: 10 };
const bdmOf = (id: string | null | undefined) => {
  const n = int(id);
  return n > 0 ? (MERGED_BDMS[n] ?? n) : null;
};
const displayName = (name: string) => {
  const base = name.replace(/[_\s]*(vti|voice)$/i, '').trim() || name;
  return base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
};

const WON = new Set(['Closed', 'Booked', 'Token Amount Received']);
const LOST = new Set(['Lost', 'Not Interested', 'Invalid', 'Disqualified', 'Just Curious', 'Event Planner', 'Travel Agent', 'Voucher Inquiry', 'Investor (Real Estate)']);
const FRESH = new Set(['Fresh', 'New', 'Proposal Call(Fresh)']);
const HOT = new Set(['Interested', 'Hot', 'Medium', 'Proposal Call', 'Office Visit Fixed', 'Office Visit Done', 'Office Visit Scheduled', 'Site Visit Fixed', 'Site Visit Done', 'Site Visit Scheduled', 'Follow Up Done for Office Visit']);

function stageOf(status: string | null): LeadStage {
  const s = (status ?? '').trim();
  if (WON.has(s)) return 'WON';
  if (LOST.has(s)) return 'LOST';
  if (FRESH.has(s)) return 'AWARENESS';
  if (s === 'Hot Closing') return 'NEGOTIATION';
  if (HOT.has(s)) return 'PROPOSAL';
  return 'CONTACTED';
}

const NOT_CONNECTED = new Set(['Not connected', 'Call Not Received', 'Number Switched off']);

/** An old follow-up's call activity and resulting status as the CRM's outcome and answers */
function outcomeOf(activity: string | null, status: string | null) {
  const a = (activity ?? '').trim();
  const s = (status ?? '').trim();
  if (NOT_CONNECTED.has(a)) return { outcome: 'NOT_REACHABLE' as FollowupOutcome, connected: false, interested: null, sampleShared: null };
  if (a === 'Not interested') return { outcome: 'NOT_INTERESTED' as FollowupOutcome, connected: true, interested: false, sampleShared: null };
  if (a === 'Sample Shared') return { outcome: 'INTERESTED' as FollowupOutcome, connected: true, interested: true, sampleShared: true };
  if (a === 'Interested') return { outcome: 'INTERESTED' as FollowupOutcome, connected: true, interested: true, sampleShared: null };
  if (a === 'Closing Done' || a === 'Token Amount Received') return { outcome: 'CONVERTED' as FollowupOutcome, connected: true, interested: true, sampleShared: null };
  if (a === 'Call Back (Follow Up)') return { outcome: 'CALL_BACK' as FollowupOutcome, connected: true, interested: null, sampleShared: null };
  // Connected, Call Conversation, office visits and "Only Update Entry": the status says how it went
  const connected = a === 'Only Update Entry' ? null : true;
  const stage = stageOf(s);
  if (stage === 'WON') return { outcome: 'CONVERTED' as FollowupOutcome, connected, interested: true, sampleShared: null };
  if (stage === 'LOST') return { outcome: (s === 'Not Interested' ? 'NOT_INTERESTED' : 'LOST') as FollowupOutcome, connected, interested: false, sampleShared: null };
  if (stage === 'PROPOSAL' || stage === 'NEGOTIATION') return { outcome: 'INTERESTED' as FollowupOutcome, connected, interested: true, sampleShared: null };
  return { outcome: 'CONNECTED' as FollowupOutcome, connected, interested: null, sampleShared: null };
}

/** The old call timing "1:18" (or "1:02:03") in seconds; null for calls that didn't connect */
const durationSec = (v: string | null | undefined) => {
  const parts = (v ?? '').trim().split(':').map(Number);
  if (!parts.length || parts.some((n) => Number.isNaN(n))) return null;
  const sec = parts.reduce((total, n) => total * 60 + n, 0);
  return sec > 0 ? sec : null;
};

const lines = (...parts: (string | null | undefined | false)[]) => parts.filter((p): p is string => !!p && !!p.trim()).join('\n') || null;

function password() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

/**
 * The phone number in a raw Meta row. Each sheet put its columns in its own order, so this takes the first
 * field that is a phone number (digits, maybe "p:+91…"), skipping Meta ids (l:, ag:, as:, c:, f:) and dates.
 */
function rawPhone(r: Row): string | null {
  for (let k = 1; k <= 20; k++) {
    const v = (r[`field_${k}`] ?? '').trim();
    if (!/^(p:)?\+?[\d][\d\s-]{8,15}$/.test(v)) continue;
    const digits = v.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 13) return normalizePhone(digits);
  }
  return null;
}

/** Sheets whose rows follow Meta's own column order (they start with the lead id "l:…") */
const isMetaLayout = (r: Row) => (r.field_1 ?? '').startsWith('l:');

async function insertBatches<T>(rows: T[], size: number, insert: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

// ─── Import ───────────────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Reading ${FILE}${DRY_RUN ? ' (dry run: nothing will be written)' : ''}`);
  const dump = parseDump(await readFile(FILE!, 'utf8'));
  if (VERIFY) return verify(dump);
  const t = (name: string) => dump.get(name) ?? [];
  console.log(
    ['re_leads', 're_leads_fups', 'lead_transferhistory', 'lead_log_data', 'goold_api_media', 'bdm_master', 'user_master'].map((n) => `${n}: ${t(n).length}`).join(' · ')
  );

  // A dry run changes nothing, not even the schema (it only reads columns that predate this import)
  if (!DRY_RUN) await runMigrations();

  // ── BDMs ──────────────────────────────────────────────────────────────────────────────────────────────────
  const loginByBdm = new Map<number, Row>();
  for (const u of t('user_master')) if (int(u.bdm_id) > 0) loginByBdm.set(int(u.bdm_id), u);
  const existingUsers = await db.select({ id: users.id, username: users.username, name: users.name, role: users.role }).from(users);
  const userIdByBdm = new Map<number, string>();
  const userIdByUsername = new Map(existingUsers.map((u) => [u.username.toLowerCase(), u.id]));
  const logins: string[] = ['name,username,password,status'];
  const accountSummary: string[] = [];

  for (const b of t('bdm_master')) {
    const legacyId = int(b.id);
    if (MERGED_BDMS[legacyId]) continue; // the merged account is created from the one it merges into
    const name = displayName(b.bdm_name ?? `BDM ${legacyId}`);
    const username = (loginByBdm.get(legacyId)?.user_name ?? b.bdm_name ?? `bdm${legacyId}`).trim().toLowerCase();
    const active = int(b.is_active) === 1;
    const sameName = existingUsers.filter((u) => u.role === 'SALES' && u.name.split(/\s+/)[0].toLowerCase() === name.toLowerCase());
    const match = existingUsers.find((u) => u.username.toLowerCase() === username) ?? (sameName.length === 1 ? sameName[0] : undefined);
    if (match) {
      userIdByBdm.set(legacyId, match.id);
      tally('BDM accounts', 'already in the CRM');
      accountSummary.push(`  ${name.padEnd(9)} → existing account "${match.username}" (${match.name}) — password unchanged`);
      logins.push(`${match.name},${match.username},(unchanged — already had an account),existing`);
      continue;
    }
    const pass = password();
    let id = `dry-run-${username}`;
    if (!DRY_RUN) {
      const [created] = await db
        .insert(users)
        .values({
          username,
          name,
          role: 'SALES',
          passwordHash: await hashPassword(pass),
          initials: name.slice(0, 2).toUpperCase(),
          phone: clean(b.contact_no),
          isActive: active,
          inRotation: false,
        })
        .returning({ id: users.id });
      id = created.id;
    }
    userIdByBdm.set(legacyId, id);
    userIdByUsername.set(username, id);
    tally('BDM accounts', 'created');
    accountSummary.push(`  ${name.padEnd(9)} → new account "${username}"${active ? '' : ' (inactive, as in the old CRM)'}`);
    logins.push(`${name},${username},${pass},${active ? 'active' : 'inactive'}`);
  }
  for (const [from, to] of Object.entries(MERGED_BDMS)) userIdByBdm.set(Number(from), userIdByBdm.get(to)!);
  const userOf = (bdm: string | null | undefined) => {
    const id = bdmOf(bdm);
    const user = id ? userIdByBdm.get(id) : undefined;
    return user && !user.startsWith('dry-run') ? user : null;
  };
  // Old logins named in the history ("updated by"): BDM usernames, plus the admin login, which isn't recreated
  const userByLogin = new Map<string, string | null>();
  for (const u of t('user_master')) userByLogin.set((u.user_name ?? '').toLowerCase(), int(u.bdm_id) > 0 ? userOf(u.bdm_id) : null);

  // ── Services named on old follow-ups ─────────────────────────────────────────────────────────────────────
  const ourServices = await db.select({ id: services.id, name: services.name }).from(services);
  const serviceByLegacy = new Map<number, { id: string | null; name: string }>();
  for (const s of t('service_master')) {
    const name = clean(s.service_name) ?? '';
    const match = ourServices.find((o) => o.name.toLowerCase() === name.toLowerCase());
    serviceByLegacy.set(int(s.id), { id: match?.id ?? null, name });
  }

  // ── Raw Meta rows, used to fill in ad / form details and to find leads for automatic assignments ──────────
  const raw = t('goold_api_media');
  const rawByPhone = new Map<string, Row>();
  const rawById = new Map<number, Row>();
  for (const r of raw) {
    rawById.set(int(r.id), r);
    const p = rawPhone(r);
    if (p && !rawByPhone.has(p)) rawByPhone.set(p, r);
  }

  // ── Leads ─────────────────────────────────────────────────────────────────────────────────────────────────
  const fupsByLead = new Map<number, Row[]>();
  for (const f of t('re_leads_fups')) {
    const list = fupsByLead.get(int(f.lead_id)) ?? [];
    list.push(f);
    fupsByLead.set(int(f.lead_id), list);
  }
  for (const list of fupsByLead.values()) list.sort((a, b) => (ist(a.fup_date)?.getTime() ?? 0) - (ist(b.fup_date)?.getTime() ?? 0) || int(a.id) - int(b.id));
  const lastTransferTo = new Map<number, Date>();
  for (const tr of t('lead_transferhistory')) {
    const at = ist(tr.entrydate);
    if (at) lastTransferTo.set(int(tr.lead_id), at);
  }

  const already = new Map(
    (await db.select({ id: leads.id, externalId: leads.externalId }).from(leads).where(like(leads.externalId, 'legacy-crm:%'))).map((l) => [l.externalId!, l.id])
  );
  const leadIdByLegacy = new Map<number, string>();
  type LeadValues = typeof leads.$inferInsert;
  const syncLeads: Array<{ id: string; values: LeadValues }> = [];
  // Leads someone has worked on in this CRM (a follow-up or a hand-over made here): their stage, owner and
  // follow-up date are this CRM's from then on, so a sync leaves those alone
  const touched = new Set(
    (
      await db.execute<{ id: string }>(sql`
        SELECT DISTINCT lead_id AS id FROM lead_followups WHERE client_ref IS NULL OR client_ref NOT LIKE 'legacy-crm-fup:%'
        UNION
        SELECT DISTINCT lead_id FROM lead_assignments
        WHERE (note IS NULL OR (note NOT LIKE 'Old CRM %' AND note NOT IN ('Waiting lead', 'Unassigned, as it was in the old CRM'))) AND reason IN ('manual', 'transfer', 'leave')`)
    ).rows.map((r) => r.id)
  );
  /** The lead's own remarks and details; call-by-call remarks live on its follow-ups */
  const leadNotes = (l: Row, hasFollowups: boolean) => {
    const remarks = clean(l.remarks);
    const lastRemarks = clean(l.last_remarks);
    return lines(
      remarks,
      !hasFollowups && lastRemarks && lastRemarks !== remarks ? `Last remark: ${lastRemarks}` : null,
      clean(l.contact_no2) && `Alternate number: ${clean(l.contact_no2)}`,
      clean(l.job_title) && `Job title: ${clean(l.job_title)}`,
      clean(l.state_name) && `State: ${clean(l.state_name)}`,
      clean(l.url) && `URL: ${clean(l.url)}`
    );
  };
  const bdmByLegacyLead = new Map(t('re_leads').map((l) => [int(l.id), bdmOf(l.bdm_id)]));
  const legacyIdsByPhone = new Map<string, number[]>();
  const newLeads: (typeof leads.$inferInsert)[] = [];
  const sampleAt = new Map<number, Date>();

  for (const l of t('re_leads')) {
    const legacyId = int(l.id);
    const externalId = `legacy-crm:${legacyId}`;
    const phone = clean(l.contact_no);
    const phoneNormalized = normalizePhone(phone);
    if (phoneNormalized) legacyIdsByPhone.set(phoneNormalized, [...(legacyIdsByPhone.get(phoneNormalized) ?? []), legacyId]);
    const fups = fupsByLead.get(legacyId) ?? [];
    const sample = fups.find((f) => (f.call_activity ?? '').trim() === 'Sample Shared');
    if (sample) sampleAt.set(legacyId, ist(sample.fup_date)!);

    const status = clean(l.status);
    const stage = stageOf(status);
    const created = ist(l.entry_date) ?? new Date();
    const first = fups[0] ? ist(fups[0].fup_date) : null;
    const last = fups.length ? ist(fups[fups.length - 1].fup_date) : null;
    const closed = stage === 'WON' || stage === 'LOST';
    const reason = [...fups].reverse().map((f) => clean(f.reasons)).find(Boolean);
    const amount = Math.max(0, ...fups.map((f) => int(f.final_amount)));
    const serviceFup = [...fups].reverse().find((f) => int(f.service_id) > 0);
    const service = serviceFup ? serviceByLegacy.get(int(serviceFup.service_id)) : undefined;
    const manual = (l.source ?? '').trim().toLowerCase() === 'manual entry';
    const meta = phoneNormalized ? rawByPhone.get(phoneNormalized) : undefined;

    const values: LeadValues = {
      companyName: clean(l.company_name) ?? clean(l.client_name) ?? phone ?? `Old CRM lead ${legacyId}`,
      contactName: clean(l.client_name),
      email: clean(l.email),
      phone,
      phoneNormalized,
      city: clean(l.city_name),
      source: manual ? 'manual' : 'meta',
      isManual: manual,
      campaign: manual ? null : clean(l.source),
      formName: meta && isMetaLayout(meta) ? clean(meta.field_10) : null,
      adName: meta && isMetaLayout(meta) ? clean(meta.field_4) : null,
      platform: meta && isMetaLayout(meta) ? clean(meta.field_12) : null,
      stage,
      assignedTo: userOf(l.bdm_id),
      assignedAt: userOf(l.bdm_id) ? (lastTransferTo.get(legacyId) ?? created) : null,
      firstContactAt: first,
      lastContactAt: last,
      nextFollowupAt: closed ? null : ist(l.next_fup_date),
      closedAt: closed ? (last ?? created) : null,
      lostReason: stage === 'LOST' ? (reason ?? status) : null,
      estimatedValue: amount > 0 ? amount : null,
      serviceId: service?.id ?? null,
      service: service?.name ?? null,
      sampleSharedAt: sampleAt.get(legacyId) ?? null,
      notes: leadNotes(l, fups.length > 0),
      statusLabel: status,
      externalId,
      createdAt: created,
      updatedAt: last && last > created ? last : created,
    };

    const importedId = already.get(externalId);
    if (!importedId) {
      // The old CRM is the record: each of its leads is its own lead here, never folded into another one
      newLeads.push(values);
      continue;
    }
    leadIdByLegacy.set(legacyId, importedId);
    if (SKIP_REFRESH) tally('Leads', 'already imported');
    else if (touched.has(importedId)) {
      // Worked on here: only the old CRM's own remarks and status label are refreshed
      syncLeads.push({ id: importedId, values: { companyName: values.companyName, notes: values.notes, statusLabel: values.statusLabel } as LeadValues });
      tally('Leads', 'worked on in this CRM (stage, BDM and follow-up kept)');
    } else syncLeads.push({ id: importedId, values });
  }
  tally('Leads', 'imported', newLeads.length);
  if (DRY_RUN && syncLeads.length) tally('Leads', 'already imported (to be synced with the old CRM)', syncLeads.length);
  if (!DRY_RUN) {
    // Sync: every lead imported earlier is brought in line with the old CRM as it is now
    const full = syncLeads.filter((r) => r.values.stage !== undefined);
    const light = syncLeads.filter((r) => r.values.stage === undefined);
    const ts = (d: Date | null | undefined) => (d ? d.toISOString() : null);
    let changed = 0;
    await insertBatches(full, 400, async (batch) => {
      const rows = batch.map(({ id, values: v }) => sql`(
        ${id}::uuid, ${v.companyName}::text, ${v.contactName ?? null}::text, ${v.email ?? null}::text, ${v.phone ?? null}::text, ${v.phoneNormalized ?? null}::text,
        ${v.city ?? null}::text, ${v.source ?? null}::text, ${!!v.isManual}::boolean, ${v.campaign ?? null}::text, ${v.formName ?? null}::text, ${v.adName ?? null}::text,
        ${v.platform ?? null}::text, ${v.stage}::text, ${v.assignedTo ?? null}::uuid, ${ts(v.assignedAt)}::timestamptz, ${ts(v.firstContactAt)}::timestamptz,
        ${ts(v.lastContactAt)}::timestamptz, ${ts(v.nextFollowupAt)}::timestamptz, ${ts(v.closedAt)}::timestamptz, ${v.lostReason ?? null}::text,
        ${v.estimatedValue ?? null}::float8, ${v.serviceId ?? null}::uuid, ${v.service ?? null}::text, ${ts(v.sampleSharedAt)}::timestamptz, ${v.notes ?? null}::text,
        ${v.statusLabel ?? null}::text, ${ts(v.createdAt as Date)}::timestamptz, ${ts(v.updatedAt as Date)}::timestamptz)`);
      const result = await db.execute(sql`
        UPDATE leads l SET
          company_name = v.company_name, contact_name = v.contact_name, email = v.email, phone = v.phone, phone_normalized = v.phone_normalized, city = v.city,
          source = v.source, is_manual = v.is_manual, campaign = v.campaign, form_name = v.form_name, ad_name = v.ad_name, platform = v.platform,
          stage = v.stage, assigned_to = v.assigned_to, assigned_at = v.assigned_at, first_contact_at = v.first_contact_at, last_contact_at = v.last_contact_at,
          next_followup_at = v.next_followup_at, closed_at = v.closed_at, lost_reason = v.lost_reason, estimated_value = v.estimated_value,
          service_id = v.service_id, service = v.service, sample_shared_at = v.sample_shared_at, notes = v.notes, status_label = v.status_label,
          created_at = v.created_at, updated_at = v.updated_at
        FROM (VALUES ${sql.join(rows, sql`, `)}) AS v(id, company_name, contact_name, email, phone, phone_normalized, city, source, is_manual, campaign, form_name,
          ad_name, platform, stage, assigned_to, assigned_at, first_contact_at, last_contact_at, next_followup_at, closed_at, lost_reason, estimated_value,
          service_id, service, sample_shared_at, notes, status_label, created_at, updated_at)
        WHERE l.id = v.id AND (
          (l.company_name, l.contact_name, l.email, l.phone, l.city, l.source, l.is_manual, l.campaign, l.stage, l.assigned_to, l.first_contact_at, l.last_contact_at,
           l.next_followup_at, l.closed_at, l.lost_reason, l.estimated_value, l.service, l.sample_shared_at, l.notes, l.status_label, l.created_at)
          IS DISTINCT FROM
          (v.company_name, v.contact_name, v.email, v.phone, v.city, v.source, v.is_manual, v.campaign, v.stage, v.assigned_to, v.first_contact_at, v.last_contact_at,
           v.next_followup_at, v.closed_at, v.lost_reason, v.estimated_value, v.service, v.sample_shared_at, v.notes, v.status_label, v.created_at))
        RETURNING l.id`);
      changed += result.rows.length;
    });
    await insertBatches(light, 500, (batch) =>
      db.execute(sql`
        UPDATE leads SET notes = v.notes, status_label = v.status_label
        FROM (VALUES ${sql.join(batch.map((r) => sql`(${r.id}::uuid, ${r.values.notes ?? null}::text, ${r.values.statusLabel ?? null}::text)`), sql`, `)}) AS v(id, notes, status_label)
        WHERE leads.id = v.id`)
    );
    if (full.length) {
      tally('Leads', 'already imported, changed in the old CRM since (now updated)', changed);
      tally('Leads', 'already imported, unchanged', full.length - changed);
    }
    await insertBatches(newLeads, 500, async (batch) => {
      const rows = await db.insert(leads).values(batch).returning({ id: leads.id, externalId: leads.externalId });
      for (const r of rows) leadIdByLegacy.set(Number(r.externalId!.slice('legacy-crm:'.length)), r.id);
    });
  }
  if (!DRY_RUN) {
    // Old leads with no BDM stay that way: without a hand-over on record this CRM would give them out as
    // "waiting" leads the moment someone presses Start
    const marked = await db.execute(sql`
      INSERT INTO lead_assignments (lead_id, from_user_id, to_user_id, reason, note)
      SELECT l.id, NULL, NULL, 'manual', 'Old CRM lead with no BDM' FROM leads l
      WHERE l.external_id LIKE 'legacy-crm:%' AND l.assigned_to IS NULL AND NOT EXISTS (SELECT 1 FROM lead_assignments a WHERE a.lead_id = l.id)
      RETURNING lead_id`);
    if (marked.rows.length) tally('Leads', 'with no BDM in the old CRM (kept unassigned)', marked.rows.length);

    const merged = await mergeIntoOldCrmLeads();
    if (merged) tally('Leads', 'made in this CRM for an enquiry the old CRM also has: merged into the old CRM lead (its BDM)', merged);
  }
  const leadOf = (legacyLeadId: string | null | undefined) => {
    const id = leadIdByLegacy.get(int(legacyLeadId));
    return id ?? (DRY_RUN && newLeads.some((n) => n.externalId === `legacy-crm:${int(legacyLeadId)}`) ? 'dry-run' : undefined);
  };

  // ── Follow-ups (calls, notes, next follow-ups) ───────────────────────────────────────────────────────────
  const followups: (typeof leadFollowups.$inferInsert)[] = [];
  // "Closed" stayed a lead's status while its payment was chased: only the first such call is the win
  const won = new Set<number>();
  for (const f of [...fupsByLead.values()].flat()) {
    const leadId = leadOf(f.lead_id);
    if (!leadId) {
      tally('Follow-ups', 'skipped: lead missing in the old CRM');
      continue;
    }
    const activity = clean(f.call_activity);
    const status = clean(f.status);
    const answers = outcomeOf(activity, status);
    if (answers.outcome === 'CONVERTED') {
      if (won.has(int(f.lead_id))) answers.outcome = 'CONNECTED';
      won.add(int(f.lead_id));
    }
    const service = int(f.service_id) > 0 ? serviceByLegacy.get(int(f.service_id))?.name : null;
    const timing = clean(f.call_timing);
    followups.push({
      leadId,
      userId: userOf(f.bdm_id),
      ...answers,
      note: lines(
        clean(f.remarks),
        service && `Service: ${service}`,
        int(f.final_amount) > 0 && `Final amount: ₹${int(f.final_amount).toLocaleString('en-IN')}`
      ),
      callActivity: activity,
      statusLabel: status,
      callDurationSec: durationSec(timing),
      reason: clean(f.reasons),
      nextFollowupAt: ist(f.next_fup_date),
      source: 'web',
      clientRef: `legacy-crm-fup:${int(f.id)}`,
      createdAt: ist(f.fup_date) ?? new Date(0),
    });
  }
  if (!DRY_RUN) {
    // Already imported: rewritten with the current mapping (remark, activity, status, call time, reason)
    const before = new Set(
      (await db.select({ ref: leadFollowups.clientRef }).from(leadFollowups).where(like(leadFollowups.clientRef, 'legacy-crm-fup:%'))).map((r) => r.ref)
    );
    const fresh = (column: string) => sql.raw(`excluded.${column}`);
    await insertBatches(followups, 1000, (batch) =>
      SKIP_REFRESH
        ? db.insert(leadFollowups).values(batch).onConflictDoNothing()
        : db
        .insert(leadFollowups)
        .values(batch)
        .onConflictDoUpdate({
          target: leadFollowups.clientRef,
          set: {
            outcome: fresh('outcome'), note: fresh('note'), nextFollowupAt: fresh('next_followup_at'), userId: fresh('user_id'),
            callActivity: fresh('call_activity'), statusLabel: fresh('status_label'), callDurationSec: fresh('call_duration_sec'), reason: fresh('reason'),
            connected: fresh('connected'), interested: fresh('interested'), sampleShared: fresh('sample_shared'),
          },
        })
    );
    const refreshed = followups.filter((f) => before.has(f.clientRef!)).length;
    tally('Follow-ups', 'imported', followups.length - refreshed);
    tally('Follow-ups', SKIP_REFRESH ? 'already imported' : 'already imported (refreshed)', refreshed);
  } else tally('Follow-ups', 'to import', followups.length);

  // ── Assignments: transfers between BDMs, and the automatic hand-out of Meta leads ─────────────────────────
  const done = new Set(
    (await db.select({ note: leadAssignments.note }).from(leadAssignments).where(like(leadAssignments.note, 'Old CRM %'))).map((a) => a.note!.split(' · ')[0])
  );
  const assignments: (typeof leadAssignments.$inferInsert)[] = [];
  for (const tr of t('lead_transferhistory')) {
    const marker = `Old CRM transfer #${int(tr.id)}`;
    const leadId = leadOf(tr.lead_id);
    if (done.has(marker)) { tally('Assignments', 'already imported'); continue; }
    if (!leadId) { tally('Assignments', 'skipped: lead missing'); continue; }
    const by = clean(tr.updated_by);
    assignments.push({
      leadId,
      fromUserId: userOf(tr.old_bdm_id),
      toUserId: userOf(tr.new_bdm_id),
      reason: 'transfer',
      note: `${marker} · by ${by ?? 'unknown'}`,
      byUserId: by ? (userByLogin.get(by.toLowerCase()) ?? null) : null,
      createdAt: ist(tr.entrydate) ?? new Date(0),
    });
  }
  for (const a of t('lead_log_data')) {
    const marker = `Old CRM auto-assignment #${int(a.id)}`;
    if (done.has(marker)) { tally('Assignments', 'already imported'); continue; }
    // The log names the raw Meta row; its phone number finds the lead it became
    const metaRow = rawById.get(int(a.google_id));
    const phone = metaRow ? rawPhone(metaRow) : null;
    const candidates = phone ? (legacyIdsByPhone.get(phone) ?? []) : [];
    const legacyLead = candidates.find((id) => bdmByLegacyLead.get(id) === bdmOf(a.bdm_id)) ?? candidates[0];
    const leadId = legacyLead ? leadOf(String(legacyLead)) : undefined;
    if (!leadId) { tally('Assignments', 'skipped: automatic assignment with no matching lead'); continue; }
    assignments.push({
      leadId,
      fromUserId: null,
      toUserId: userOf(a.bdm_id),
      reason: 'auto',
      note: `${marker} · ${clean(a.category) ?? ''}`.trim(),
      createdAt: ist(a.entrydate) ?? new Date(0),
    });
  }
  tally('Assignments', DRY_RUN ? 'to import' : 'imported', assignments.length);
  if (!DRY_RUN) await insertBatches(assignments, 1000, (batch) => db.insert(leadAssignments).values(batch));

  // ── Raw Meta lead-form rows, kept under an archived (inactive) source ────────────────────────────────────
  const SOURCE_NAME = 'Old CRM — Meta lead forms (archive)';
  let [archive] = await db.select({ id: leadSources.id }).from(leadSources).where(eq(leadSources.name, SOURCE_NAME)).limit(1);
  if (!archive && !DRY_RUN) [archive] = await db.insert(leadSources).values({ name: SOURCE_NAME, type: 'meta', config: {}, active: false }).returning({ id: leadSources.id });
  const LABELS = ['meta_lead_id', 'created_time', 'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name', 'form_id', 'form_name', 'is_organic', 'platform', 'service_wanted', 'timeline', 'city', 'full_name', 'email', 'phone_number', 'company_name', 'field_20'];
  const imports: (typeof leadImports.$inferInsert)[] = [];
  for (const r of raw) {
    const phone = rawPhone(r);
    const record: Record<string, unknown> = { old_crm_id: int(r.id), sheet: clean(r.category), status: clean(r.status), phone };
    // Meta's own column order gets names; other sheets keep their columns as they were
    for (let k = 1; k <= 20; k++) record[isMetaLayout(r) ? LABELS[k - 1] : `field_${k}`] = clean(r[`field_${k}`] ?? null);
    const legacyLead = phone ? legacyIdsByPhone.get(phone)?.[0] : undefined;
    const leadId = legacyLead ? leadOf(String(legacyLead)) : undefined;
    const received = clean(r.field_2) ? new Date(r.field_2!) : null;
    imports.push({
      sourceId: archive?.id ?? 'dry-run',
      externalId: clean(r.field_1) ?? `old-crm-row:${int(r.id)}`,
      status: ((r.status ?? '').trim() === 'Duplicate' ? 'duplicate' : 'imported') as LeadImportStatus,
      raw: record,
      leadId: leadId && leadId !== 'dry-run' ? leadId : null,
      campaign: clean(r.category),
      receivedAt: received && !Number.isNaN(received.getTime()) ? received : (ist(r.entrydate) ?? new Date(0)),
    });
  }
  if (!DRY_RUN) {
    let inserted = 0;
    await insertBatches(imports, 1000, async (batch) => {
      inserted += (await db.insert(leadImports).values(batch).onConflictDoNothing().returning({ id: leadImports.id })).length;
    });
    tally('Raw Meta rows', 'imported', inserted);
    tally('Raw Meta rows', 'already imported / repeated lead id', imports.length - inserted);
  } else tally('Raw Meta rows', 'to import', imports.length);

  // ── Campaign → BDM rules: a lead from one of these campaigns goes to its BDMs while they are Started ──────
  const campaignName = new Map(t('campaign_master').map((c) => [int(c.id), clean(c.campaign)]));
  const rules = new Map<string, { campaign: string; userId: string }>();
  for (const r of t('campaign_wise_bdm')) {
    const campaign = campaignName.get(int(r.campaign_id));
    const userId = userOf(r.bdm_id);
    if (!campaign || !userId || int(r.is_active) !== 1) { tally('Campaign rules', 'skipped: unknown campaign or BDM'); continue; }
    rules.set(`${campaign}|${userId}`, { campaign, userId });
  }
  tally('Campaign rules', 'old rows', t('campaign_wise_bdm').length);
  if (!DRY_RUN && rules.size) {
    const added = await db.insert(campaignBdmRules).values([...rules.values()]).onConflictDoNothing().returning({ campaign: campaignBdmRules.campaign });
    tally('Campaign rules', 'imported (after merging duplicate BDMs)', added.length);
    tally('Campaign rules', 'already there', rules.size - added.length);
  } else tally('Campaign rules', 'to import', rules.size);

  // ── Archive: every row of every old table, exactly as it was ─────────────────────────────────────────────
  for (const [table, rows] of dump) {
    const keyColumn = rows[0] && 'id' in rows[0] ? 'id' : rows[0] && 'l_id' in rows[0] ? 'l_id' : null;
    const seen = new Set<string>();
    const archived = rows.map((row, i) => {
      let rowKey = keyColumn && row[keyColumn] !== null ? String(row[keyColumn]) : `#${i + 1}`;
      if (seen.has(rowKey)) rowKey = `${rowKey}#${i + 1}`;
      seen.add(rowKey);
      // Passwords (stored in plain text) and API tokens are the only values not kept
      const data: Row = {};
      for (const [k, v] of Object.entries(row)) data[k] = SECRET_COLUMN.test(k) && v ? '(removed)' : v;
      return { tableName: table, rowKey, data };
    });
    if (DRY_RUN) { tally('Archive', `${table}`, archived.length); continue; }
    // The table's column order, which the stored rows don't keep
    await db
      .insert(legacyArchive)
      .values({ tableName: table, rowKey: COLUMNS_KEY, data: { columns: Object.keys(rows[0] ?? {}).join(',') } })
      .onConflictDoUpdate({ target: [legacyArchive.tableName, legacyArchive.rowKey], set: { data: sql.raw('excluded.data') } });
    // New rows are added and rows the old CRM has changed since are brought up to date
    let written = 0;
    await insertBatches(archived, 1000, async (batch) => {
      written += (
        await db
          .insert(legacyArchive)
          .values(batch)
          .onConflictDoUpdate({
            target: [legacyArchive.tableName, legacyArchive.rowKey],
            set: { data: sql.raw('excluded.data') },
            setWhere: sql`${legacyArchive.data} IS DISTINCT FROM excluded.data`,
          })
          .returning({ id: legacyArchive.id })
      ).length;
    });
    tally('Archive', table, archived.length);
    if (written && written < archived.length) tally('Archive', `${table} (new or changed)`, written);
  }

  // ── Summary ───────────────────────────────────────────────────────────────────────────────────────────────
  console.log('\nBDM accounts:');
  console.log(accountSummary.join('\n'));
  console.log('\nResult:');
  for (const [table, kinds] of Object.entries(stats)) console.log(`  ${table}: ${Object.entries(kinds).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  const total = [...dump.values()].reduce((n, rows) => n + rows.length, 0);
  console.log(`\nArchive: all ${total} rows of the ${dump.size} old tables that hold data are kept as they were (CRM Admin → Old CRM Archive).`);
  if (!DRY_RUN) {
    // Never overwrite an earlier logins file: it may hold passwords that exist nowhere else
    const target = existsSync(LOGINS) ? LOGINS.replace(/(\.csv)?$/, `-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`) : LOGINS;
    await writeFile(target, logins.join('\n') + '\n', { mode: 0o600 });
    console.log(`\nLogins written to ${target} — hand them out, then delete the file.`);
  } else {
    console.log(`\nDry run: ${logins.length - 1} BDM logins would be written to ${LOGINS}.`);
  }
}

/**
 * Every old table against the archive, value by value (secrets excepted, as the import blanks them), and the
 * imported leads, follow-ups, transfers and Meta rows against their old rows.
 */
async function verify(dump: Map<string, Row[]>) {
  console.log('\nVerifying every old table against the database (nothing is written)…\n');
  let allGood = true;
  const report: string[] = [];
  for (const [table, rows] of [...dump].sort(([a], [b]) => a.localeCompare(b))) {
    const stored = await db
      .select({ rowKey: legacyArchive.rowKey, data: legacyArchive.data })
      .from(legacyArchive)
      .where(eq(legacyArchive.tableName, table));
    const byKey = new Map(stored.filter((r) => r.rowKey !== COLUMNS_KEY).map((r) => [r.rowKey, r.data]));
    const keyColumn = rows[0] && 'id' in rows[0] ? 'id' : rows[0] && 'l_id' in rows[0] ? 'l_id' : null;
    const seen = new Set<string>();
    let same = 0;
    let missing = 0;
    let different = 0;
    rows.forEach((row, i) => {
      let rowKey = keyColumn && row[keyColumn] !== null ? String(row[keyColumn]) : `#${i + 1}`;
      if (seen.has(rowKey)) rowKey = `${rowKey}#${i + 1}`;
      seen.add(rowKey);
      const got = byKey.get(rowKey);
      if (!got) { missing++; return; }
      const differs = Object.entries(row).some(([k, v]) => (SECRET_COLUMN.test(k) && v ? '(removed)' : v) !== (got[k] ?? null));
      if (differs) different++; else same++;
    });
    const extra = byKey.size - (same + different);
    const ok = missing === 0 && different === 0;
    allGood &&= ok;
    report.push(`  ${ok ? '✓' : '✗'} ${table.padEnd(26)} old ${String(rows.length).padStart(7)} · identical ${String(same).padStart(7)}${missing ? ` · MISSING ${missing}` : ''}${different ? ` · DIFFERENT ${different}` : ''}${extra > 0 ? ` · extra ${extra}` : ''}`);
  }
  console.log('Archive (every old table, every value):');
  console.log(report.join('\n'));

  const count = async (query: ReturnType<typeof sql>) => Number(((await db.execute(query)).rows[0] as { n: number | string }).n);
  const leadsIn = await count(sql`SELECT count(*) AS n FROM leads WHERE external_id LIKE 'legacy-crm:%'`);
  const fupsIn = await count(sql`SELECT count(*) AS n FROM lead_followups WHERE client_ref LIKE 'legacy-crm-fup:%'`);
  const transfersIn = await count(sql`SELECT count(*) AS n FROM lead_assignments WHERE note LIKE 'Old CRM transfer #%'`);
  const autoIn = await count(sql`SELECT count(*) AS n FROM lead_assignments WHERE note LIKE 'Old CRM auto-assignment #%'`);
  const metaIn = await count(sql`SELECT count(*) AS n FROM lead_imports i JOIN lead_sources s ON s.id = i.source_id WHERE s.name = 'Old CRM — Meta lead forms (archive)'`);
  const leadIds = new Set((dump.get('re_leads') ?? []).map((l) => int(l.id)));
  const fupsWithLead = (dump.get('re_leads_fups') ?? []).filter((f) => leadIds.has(int(f.lead_id))).length;
  const transfersWithLead = (dump.get('lead_transferhistory') ?? []).filter((r) => leadIds.has(int(r.lead_id))).length;
  console.log('\nAs working CRM records (leads, history, assignments):');
  console.log(`  Leads         old ${(dump.get('re_leads') ?? []).length} · in the CRM ${leadsIn}`);
  console.log(`  Follow-ups    old ${(dump.get('re_leads_fups') ?? []).length} · with an existing lead ${fupsWithLead} · in the CRM ${fupsIn}`);
  console.log(`  Transfers     old ${(dump.get('lead_transferhistory') ?? []).length} · with an existing lead ${transfersWithLead} · in the CRM ${transfersIn}`);
  console.log(`  Auto-assign   old ${(dump.get('lead_log_data') ?? []).length} · in the CRM ${autoIn}`);
  console.log(`  Meta rows     old ${(dump.get('goold_api_media') ?? []).length} · in the CRM ${metaIn} (2 rows repeat a Meta lead id)`);
  console.log(`\n${allGood ? '✓ Every row of every old table is in the database with identical values.' : '✗ Some rows are missing or different — see above.'}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
