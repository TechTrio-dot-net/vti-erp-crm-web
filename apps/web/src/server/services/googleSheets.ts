import crypto from 'crypto';
import { HttpError } from '../lib/http';

/**
 * Reads a Google Sheet as rows of { header: value }.
 * - With GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY set, uses the Sheets API (works for private sheets
 *   shared with the service account).
 * - Otherwise downloads the CSV export, which requires "Anyone with the link can view".
 */
export async function readSheetRows(sheetUrl: string, sheetName?: string, tabGid?: string): Promise<Record<string, string>[]> {
  const { spreadsheetId, gid } = parseSheetUrl(sheetUrl);
  if (tabGid && hasServiceAccount()) {
    // The API reads a tab by its title; the id stays the same when the tab is renamed
    const tab = (await listSheetTabs(sheetUrl)).find((t) => t.gid === tabGid);
    if (!tab) throw new Error('This tab is no longer in the sheet');
    return toObjects(await readViaApi(spreadsheetId, tab.title));
  }
  const table = tabGid
    ? await readViaCsv(spreadsheetId, tabGid)
    : hasServiceAccount()
      ? await readViaApi(spreadsheetId, sheetName)
      : await readViaCsv(spreadsheetId, gid, sheetName);
  return toObjects(table);
}

export interface SheetTab {
  gid: string;
  title: string;
}

/** Every tab of a spreadsheet, in sheet order */
export async function listSheetTabs(sheetUrl: string): Promise<SheetTab[]> {
  const { spreadsheetId } = parseSheetUrl(sheetUrl);
  if (hasServiceAccount()) {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`, {
      headers: { Authorization: `Bearer ${await serviceAccountToken()}` },
      signal: AbortSignal.timeout(15_000),
    });
    const info = (await res.json()) as { sheets?: Array<{ properties: { sheetId: number; title: string } }>; error?: { message: string } };
    if (!res.ok) throw new Error(`Google Sheets: ${info.error?.message ?? res.status}`);
    return (info.sheets ?? []).map((t) => ({ gid: String(t.properties.sheetId), title: t.properties.title }));
  }
  // A sheet shared by link lists its tabs on its plain web view
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/htmlview`, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  const tabs = res.ok ? parseHtmlViewTabs(await res.text()) : [];
  if (!tabs.length) {
    throw new Error('Could not read the sheet\'s tabs. Share it as "Anyone with the link can view", or configure a Google service account.');
  }
  return tabs;
}

export function parseHtmlViewTabs(html: string): SheetTab[] {
  const tabs: SheetTab[] = [];
  for (const m of html.matchAll(/items\.push\(\{name: "((?:[^"\\]|\\.)*)",[^}]*?gid: "(\d+)"/g)) {
    let title = m[1];
    try {
      // The name is a JavaScript string: \/ and \x3d style escapes
      title = JSON.parse(`"${m[1].replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1').replace(/\\'/g, "'")}"`);
    } catch { /* keep the raw text */ }
    if (!tabs.some((t) => t.gid === m[2])) tabs.push({ gid: m[2], title });
  }
  return tabs;
}

export function parseSheetUrl(sheetUrl: string): { spreadsheetId: string; gid?: string } {
  const trimmed = sheetUrl.trim();
  const idMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const spreadsheetId = idMatch?.[1] ?? (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed) ? trimmed : null);
  if (!spreadsheetId) throw new HttpError(400, 'That does not look like a Google Sheets link');
  const gid = trimmed.match(/[#&?]gid=(\d+)/)?.[1];
  return { spreadsheetId, gid };
}

function hasServiceAccount() {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

async function readViaCsv(spreadsheetId: string, gid?: string, sheetName?: string): Promise<string[][]> {
  const url = sheetName
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`
    : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok || text.trimStart().startsWith('<')) {
    throw new Error('Could not read the sheet. Share it as "Anyone with the link can view", or configure a Google service account.');
  }
  return parseCsv(text);
}

let cachedToken: { token: string; expires: number } | null = null;

async function serviceAccountToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.token;
  const now = Math.floor(Date.now() / 1000);
  const encode = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(`Google auth failed: ${data.error_description ?? res.status}`);
  cachedToken = { token: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

async function readViaApi(spreadsheetId: string, sheetName?: string): Promise<string[][]> {
  const token = await serviceAccountToken();
  const headers = { Authorization: `Bearer ${token}` };
  let range = sheetName;
  if (!range) {
    const meta = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`, { headers });
    const info = (await meta.json()) as { sheets?: Array<{ properties: { title: string } }>; error?: { message: string } };
    if (!meta.ok) throw new Error(`Google Sheets: ${info.error?.message ?? meta.status}`);
    range = info.sheets?.[0]?.properties.title ?? 'Sheet1';
  }
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json()) as { values?: string[][]; error?: { message: string } };
  if (!res.ok) throw new Error(`Google Sheets: ${data.error?.message ?? res.status}`);
  return data.values ?? [];
}

/** RFC 4180 CSV parser (quoted fields, escaped quotes, newlines inside quotes) */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function toObjects(table: string[][]): Record<string, string>[] {
  if (table.length < 2) return [];
  const headers = table[0].map((h) => h.trim());
  return table.slice(1).map((cells) => Object.fromEntries(headers.map((h, i) => [h || `column_${i + 1}`, (cells[i] ?? '').trim()])));
}
