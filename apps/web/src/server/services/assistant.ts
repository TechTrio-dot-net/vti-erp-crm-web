import type Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db/index';
import { AI_MODEL, anthropic, FALLBACK, responseText } from '../lib/ai';
import { APP_TIMEZONE } from '../lib/crm';
import { HttpError } from '../lib/http';

/**
 * The super admin's assistant: Claude answers questions about the business in whatever language they are
 * asked, looking the facts up with read-only SQL over the whole database (leads, calls and their
 * transcripts, quotations, payments, projects, HR…).
 */

// ─── Read-only SQL ────────────────────────────────────────────────────────────────────────────────────────────

/** Columns that are never shown, even to the super admin */
const PRIVATE_COLUMN = /password|reset_token|tokens_valid_from|refresh_token|secret|api_key|access_token/i;

/** Server functions that could read files, block the database or change settings */
const BLOCKED_SQL =
  /\b(pg_read_file|pg_read_binary_file|pg_ls_\w+|pg_stat_file|lo_\w+|dblink\w*|pg_sleep\w*|set_config|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_authid|pg_shadow)\b/i;

const MAX_ROWS = 200;
const MAX_CELL = 2000;
const MAX_RESULT_CHARS = 60_000;

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

/**
 * Runs one SELECT in a read-only transaction with a statement timeout, so nothing can be changed and a
 * heavy query can't hold the database. The query is wrapped as a subquery, which also rules out a second
 * statement, and limited to MAX_ROWS.
 */
export async function runReadOnlyQuery(query: string): Promise<QueryResult> {
  const text = query.trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(text)) throw new HttpError(400, 'Only a single SELECT (or WITH … SELECT) query is allowed');
  if (text.includes(';')) throw new HttpError(400, 'Only one statement is allowed — remove the semicolons');
  if (PRIVATE_COLUMN.test(text)) throw new HttpError(400, 'Passwords, tokens and secrets cannot be queried');
  if (BLOCKED_SQL.test(text)) throw new HttpError(400, 'That function is not allowed');

  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query(`SET LOCAL TIME ZONE '${APP_TIMEZONE.replace(/'/g, '')}'`);
    const result = await client.query(`SELECT * FROM (\n${text}\n) AS answer LIMIT ${MAX_ROWS + 1}`);
    const truncated = result.rows.length > MAX_ROWS;
    const rows = (result.rows as Record<string, unknown>[]).slice(0, MAX_ROWS).map((row) => {
      const clean: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (PRIVATE_COLUMN.test(key)) continue;
        clean[key] = typeof value === 'string' && value.length > MAX_CELL ? `${value.slice(0, MAX_CELL)}… (${value.length} characters)` : value;
      }
      return clean;
    });
    return { rows, rowCount: rows.length, truncated };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // Database errors (bad column, syntax, timeout) go back to Claude so it can correct the query
    throw new HttpError(400, (err as Error).message);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

// ─── Database description for the prompt ─────────────────────────────────────────────────────────────────────

let schemaCache: { text: string; at: number } | null = null;

/** Every table and its columns, e.g. "leads: id uuid, company_name text, …" (cached for 10 minutes) */
async function describeDatabase(): Promise<string> {
  if (schemaCache && Date.now() - schemaCache.at < 10 * 60_000) return schemaCache.text;
  const { rows } = await pool.query<{ table_name: string; column_name: string; data_type: string }>(`
    SELECT table_name, column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name NOT IN ('job_runs', 'app_signals', '__drizzle_migrations')
    ORDER BY table_name, ordinal_position`);
  const tables = new Map<string, string[]>();
  for (const r of rows) {
    if (PRIVATE_COLUMN.test(r.column_name)) continue;
    const type = r.data_type.replace('timestamp with time zone', 'timestamptz').replace('character varying', 'varchar').replace('double precision', 'float');
    tables.set(r.table_name, [...(tables.get(r.table_name) ?? []), `${r.column_name} ${type}`]);
  }
  const text = [...tables].map(([table, columns]) => `${table}: ${columns.join(', ')}`).join('\n');
  schemaCache = { text, at: Date.now() };
  return text;
}

const INSTRUCTIONS = `You are the business assistant for Voice Tunes India (voice-over, dubbing, jingles, video production), talking with the company's super admin inside their CRM/ERP.

Answer questions about the business — leads, sales calls and what was said on them, follow-ups, salespeople's performance, quotations, payments, projects and tasks, employees and HR, invoices, marketing — by looking the facts up with the run_sql tool. Never guess or invent numbers, names or dates; if the data doesn't hold the answer, say so.

Language: reply in the same language and script the admin used (Hindi, English, Hinglish, Marathi, Gujarati, Tamil, …). Keep names, numbers and IDs as they are in the data.

Style: lead with the answer. Keep it short; use a small markdown table for lists of records and "- " bullets for points. Mention the period you counted over. Don't show SQL unless asked. Amounts are Indian rupees (₹, Indian digit grouping like ₹1,25,000).

Data notes:
- PostgreSQL. The session time zone is ${APP_TIMEZONE}, so now(), current_date and ::date casts are already in local time. "Today", "this week" and "this month" mean local time.
- users: everyone who logs in; users.role is the built-in role. A BDM (salesperson) is a user with role = 'SALES'. users.is_active = false means they left.
- leads: sales enquiries. stage is AWARENESS (shown as "New"), CONTACTED, PROPOSAL, NEGOTIATION, WON or LOST; assigned_to → users.id is the BDM; next_followup_at is the next planned follow-up; estimated_value is the deal value; lost_reason for lost leads; source/campaign/platform tell where it came from.
- lead_followups: every follow-up logged on a lead (outcome CONNECTED, CALL_BACK, NOT_REACHABLE, INTERESTED, NOT_INTERESTED, CONVERTED, LOST; notes; next follow-up date).
- call_logs: phone calls. direction outgoing/incoming/missed/rejected; duration_sec > 0 on an outgoing or incoming call means it connected; user_id is the BDM; lead_id the lead (null for numbers that aren't leads); source 'device' = BDM's phone app, 'exotel' = company line.
- call_recordings: one per recorded call (call_log_id → call_logs.id). transcript is the text of the conversation in the language spoken; summary is a short English summary; status transcribed/failed/uploaded. To find what customers said about something, search transcript and summary with ILIKE (try Hindi and English words, e.g. '%price%' and '%रेट%').
- quotations / quotation_items / quotation_payments: quotations sent to clients and payments received against them.
- employees, departments, designations, salaries: HR. projects, tasks, time_entries: delivery work. invoices: client invoices.
- Leads imported from the old PHP CRM have external_id 'legacy-crm:<old id>'; their follow-ups (lead_followups) carry call_activity, status_label, call_duration_sec and reason. legacy_archive holds every row of every old CRM table exactly as it was (table_name, row_key, data jsonb, e.g. data->>'remarks'), including tables this CRM has no screen for: payment_due / payment_done / payment_approval_history (payments ledger), booking_installments, campaign_wise_bdm, bdm_master, user_master (passwords and tokens were removed).

run_sql rules: one SELECT or WITH query per call, no semicolons, at most ${MAX_ROWS} rows come back — aggregate with COUNT/SUM/GROUP BY rather than fetching raw rows. Several independent queries may be run at once. If a query fails, read the error, fix the query and try again.

Database tables and columns:
`;

const SQL_TOOL: Anthropic.Beta.BetaTool = {
  name: 'run_sql',
  description:
    'Runs one read-only PostgreSQL SELECT query on the company database and returns the rows as JSON (at most 200 rows). Use it for every fact you report.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'A single SELECT or WITH … SELECT statement, without a trailing semicolon' },
      purpose: { type: 'string', description: 'A few words on what this query looks up, shown to the admin (e.g. "Calls per BDM this week")' },
    },
    required: ['query', 'purpose'],
    additionalProperties: false,
  },
};

// ─── Conversation ─────────────────────────────────────────────────────────────────────────────────────────────

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatAnswer {
  answer: string;
  queries: Array<{ purpose: string; query: string; rows?: number; error?: string }>;
}

const MAX_TOOL_ROUNDS = 12;
/** Stops looking things up in time to answer within the request's time limit */
const TIME_BUDGET_MS = 200_000;

export async function askAssistant(history: ChatTurn[], asker: { name: string }): Promise<ChatAnswer> {
  const now = new Date().toLocaleString('en-IN', { timeZone: APP_TIMEZONE, dateStyle: 'full', timeStyle: 'short' });
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((turn, i) => ({
    role: turn.role,
    // The current time and who is asking go on the latest question only, so earlier turns stay cacheable
    content: i === history.length - 1 ? `[${now} · asked by ${asker.name}]\n\n${turn.content}` : turn.content,
  }));
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: INSTRUCTIONS + (await describeDatabase()), cache_control: { type: 'ephemeral' } },
  ];

  const queries: ChatAnswer['queries'] = [];
  const started = Date.now();
  for (let round = 0; ; round++) {
    const outOfTime = round >= MAX_TOOL_ROUNDS || Date.now() - started > TIME_BUDGET_MS;
    const response = await anthropic().beta.messages.create({
      ...FALLBACK,
      model: AI_MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system,
      tools: [SQL_TOOL],
      // Out of rounds or time: answer with what has been found so far
      ...(outOfTime && { tool_choice: { type: 'none' as const } }),
      cache_control: { type: 'ephemeral' },
      messages,
    });

    if (response.stop_reason === 'refusal') {
      return { answer: responseText(response.content) || "Sorry, I can't help with that request.", queries };
    }
    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !calls.length) {
      const answer = responseText(response.content);
      return { answer: answer || 'I could not find an answer to that.', queries };
    }

    messages.push({ role: 'assistant', content: response.content });
    const results = await Promise.all(
      calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const input = call.input as { query?: unknown; purpose?: unknown };
        const query = typeof input.query === 'string' ? input.query : '';
        const purpose = typeof input.purpose === 'string' ? input.purpose : 'Query';
        try {
          const result = await runReadOnlyQuery(query);
          queries.push({ purpose, query, rows: result.rowCount });
          let json = JSON.stringify(result);
          if (json.length > MAX_RESULT_CHARS) json = `${json.slice(0, MAX_RESULT_CHARS)}… (result cut off — aggregate or select fewer columns)`;
          return { type: 'tool_result', tool_use_id: call.id, content: json };
        } catch (err) {
          const message = (err as Error).message;
          queries.push({ purpose, query, error: message });
          return { type: 'tool_result', tool_use_id: call.id, content: `Error: ${message}`, is_error: true };
        }
      })
    );
    messages.push({ role: 'user', content: results });
  }
}
