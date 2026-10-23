import { Router } from 'express';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index';
import { authMiddleware, type AuthRequest } from '../lib/auth';
import {
  APP_TIMEZONE,
  BDM_ROLE,
  addDays,
  bdmScope,
  dateRange,
  daysBetween,
  isDateString,
  requireCrm,
  requireCrmAdmin, requireCrmAdminOrCoordination,
  todayLocal,
} from '../lib/crm';
import { HttpError, optionalId, sendError } from '../lib/http';

const router = Router();
router.use(authMiddleware, requireCrm);

const tz = APP_TIMEZONE;
/** Business-local date of a raw column expression, e.g. day('l.assigned_at') */
const day = (column: string) => sql.raw(`(${column} AT TIME ZONE '${tz.replace(/'/g, '')}')::date`);
const OPEN = sql.raw(`l.stage NOT IN ('WON', 'LOST')`);

/** The working day in business-local hours: 10:30 am to 7:00 pm */
export const WORK_START_HOUR = 10;
export const WORK_START_MINUTE = 30;
export const WORK_END_HOUR = 19;
/** Lunch, as minutes of the day: 1:30 pm to 2:00 pm. Nobody is counted as not calling over it. */
export const LUNCH_START_MINUTE = 13 * 60 + 30;
export const LUNCH_END_MINUTE = 14 * 60;
/** No call for this many minutes during the working day = the BDM is shown as not calling (red) */
export const IDLE_MINUTES = 20;
const workHours = {
  startHour: WORK_START_HOUR, startMinute: WORK_START_MINUTE, endHour: WORK_END_HOUR,
  idleMinutes: IDLE_MINUTES, lunchStartMinute: LUNCH_START_MINUTE, lunchEndMinute: LUNCH_END_MINUTE,
};

async function rows<T>(query: SQL): Promise<T[]> {
  return (await db.execute<T & Record<string, unknown>>(query)).rows as T[];
}

/** `AND <alias>.user = bdm` when the report is scoped to one BDM */
function bdmFilter(req: AuthRequest, column: string): SQL {
  const bdm = bdmScope(req, req.query.bdm);
  const id = bdm ? optionalId(bdm, 'bdm') : undefined;
  return id ? sql`AND ${sql.raw(column)} = ${id}` : sql``;
}

/** Monday of the week containing `day` (or the given ?weekStart) */
function weekWindow(query: AuthRequest['query']): { from: string; to: string } {
  const to = isDateString(query.to) ? query.to : isDateString(query.weekStart) ? addDays(query.weekStart, 6) : todayLocal();
  return { from: addDays(to, -6), to };
}

// ─── CRM (visible to BDMs, scoped to themselves) ────────────────────────────────────────────────────────────────

router.get('/dashboard', async (req: AuthRequest, res) => {
  try {
    const { from, to } = dateRange(req.query, 30);
    const today = todayLocal();
    const scope = bdmFilter(req, 'l.assigned_to');

    const [[todayStats], [rangeStats], due, fresh, bySource, byStage] = await Promise.all([
      rows<Record<string, number>>(sql`
        SELECT
          count(*) FILTER (WHERE ${day('l.assigned_at')} = ${today})::int AS "assignedToday",
          count(*) FILTER (WHERE ${OPEN} AND l.first_contact_at IS NULL)::int AS "pending",
          count(*) FILTER (WHERE ${OPEN} AND ${day('l.next_followup_at')} = ${today})::int AS "dueToday",
          count(*) FILTER (WHERE ${OPEN} AND ${day('l.next_followup_at')} < ${today})::int AS "overdue",
          count(*) FILTER (WHERE ${OPEN})::int AS "open",
          count(*) FILTER (WHERE l.stage = 'WON' AND ${day('l.closed_at')} = ${today})::int AS "wonToday"
        FROM leads l WHERE l.assigned_to IS NOT NULL ${scope}`),
      rows<Record<string, number>>(sql`
        SELECT
          count(*)::int AS "assigned",
          count(*) FILTER (WHERE l.first_contact_at IS NOT NULL)::int AS "contacted",
          count(*) FILTER (WHERE l.stage = 'WON')::int AS "won",
          count(*) FILTER (WHERE l.stage = 'LOST')::int AS "lost",
          coalesce(sum(l.estimated_value) FILTER (WHERE l.stage = 'WON'), 0)::float8 AS "wonValue",
          coalesce(avg(extract(epoch FROM (l.first_contact_at - l.assigned_at)) / 60) FILTER (WHERE l.first_contact_at >= l.assigned_at), 0)::float8 AS "avgResponseMins",
          (SELECT count(*)::int FROM lead_followups f JOIN leads l ON l.id = f.lead_id
             WHERE ${day('f.created_at')} = ${today} ${scope}) AS "followupsToday"
        FROM leads l WHERE ${day('l.assigned_at')} BETWEEN ${from} AND ${to} ${scope}`),
      rows(sql`
        SELECT l.id, coalesce(nullif(btrim(l.contact_name), ''), l.company_name) AS name, l.phone, l.stage, l.next_followup_at AS "nextFollowupAt", u.name AS "assignedName"
        FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
        WHERE ${OPEN} AND l.next_followup_at IS NOT NULL AND ${day('l.next_followup_at')} <= ${today} ${scope}
        ORDER BY l.next_followup_at ASC LIMIT 25`),
      rows(sql`
        SELECT l.id, coalesce(nullif(btrim(l.contact_name), ''), l.company_name) AS name, l.phone, l.campaign, l.source, l.assigned_at AS "assignedAt", u.name AS "assignedName"
        FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
        WHERE ${OPEN} AND l.first_contact_at IS NULL AND l.assigned_to IS NOT NULL ${scope}
        ORDER BY l.assigned_at DESC NULLS LAST LIMIT 25`),
      rows(sql`
        SELECT coalesce(l.source, 'unknown') AS source, count(*)::int AS count
        FROM leads l WHERE ${day('l.created_at')} BETWEEN ${from} AND ${to} ${scope}
        GROUP BY 1 ORDER BY 2 DESC`),
      rows(sql`
        SELECT l.stage, count(*)::int AS count FROM leads l WHERE ${OPEN} AND l.assigned_to IS NOT NULL ${scope} GROUP BY 1`),
    ]);

    res.json({
      range: { from, to },
      today: todayStats,
      period: { ...rangeStats, conversionRate: rangeStats.assigned ? Math.round((rangeStats.won / rangeStats.assigned) * 1000) / 10 : 0 },
      due,
      fresh,
      bySource,
      byStage,
    });
  } catch (err) {
    sendError(res, err, 'Failed to load CRM dashboard');
  }
});

// ─── Leads Status Overview (the old CRM's BDM dashboard) ─────────────────────────────────────────────────────

/**
 * A lead's status as the old CRM showed it: the status it carried over, or the stage it has reached here.
 * A closed lead is never live: once it is lost (or won) it stays out of the live counts and lists, whatever
 * status label it carries — "Not Interested" marks a lead lost here, so it belongs with the lost leads.
 */
const STATUS = sql.raw(`coalesce(nullif(btrim(l.status_label), ''), CASE l.stage WHEN 'AWARENESS' THEN 'New' WHEN 'CONTACTED' THEN 'Contacted'
  WHEN 'PROPOSAL' THEN 'Interested' WHEN 'NEGOTIATION' THEN 'Hot Closing' WHEN 'WON' THEN 'Closed' ELSE 'Lost' END)`);
const LIVE = sql`(l.stage NOT IN ('WON', 'LOST') AND ${STATUS} <> 'Lost')`;
/** Lost: closed as lost here, or still carrying the old CRM's "Lost" status */
const LOST = sql`(l.stage <> 'WON' AND (l.stage = 'LOST' OR ${STATUS} = 'Lost'))`;
/** New leads still waiting for their first real conversation */
const PENDING_STATUSES = ['Fresh', 'New', 'Proposal Call', 'Proposal Call(Fresh)'];
const OVERVIEW_WHEN = ['today', 'yesterday', 'late', 'upcoming', 'total'] as const;

function whenFilter(when: string, today: string): SQL {
  const due = day('l.next_followup_at');
  switch (when) {
    case 'today': return sql`${due} = ${today}::date`;
    case 'yesterday': return sql`${due} = ${today}::date - 1`;
    case 'late': return sql`(l.next_followup_at IS NULL OR ${due} < ${today}::date)`;
    case 'upcoming': return sql`${due} > ${today}::date`;
    default: return sql`true`;
  }
}

router.get('/status-overview', async (req: AuthRequest, res) => {
  try {
    const today = todayLocal();
    const scope = bdmFilter(req, 'l.assigned_to');
    const pending = sql`${STATUS} IN (${sql.join(PENDING_STATUSES.map((s) => sql`${s}`), sql`, `)})`;
    const [[cards], breakdown, [calls]] = await Promise.all([
      rows<Record<string, number>>(sql`
        SELECT
          count(*) FILTER (WHERE ${day('l.created_at')} = ${today}::date)::int AS "newToday",
          count(*) FILTER (WHERE ${day('l.created_at')} = ${today}::date AND ${LIVE} AND ${pending})::int AS "newTodayPending",
          count(*) FILTER (WHERE ${day('l.created_at')} = ${today}::date - 1)::int AS "newYesterday",
          count(*) FILTER (WHERE ${day('l.created_at')} = ${today}::date - 1 AND ${LIVE} AND ${pending})::int AS "newYesterdayPending",
          count(*) FILTER (WHERE ${LIVE})::int AS live,
          count(*) FILTER (WHERE ${LIVE} AND ${whenFilter('today', today)})::int AS "today",
          count(*) FILTER (WHERE ${LIVE} AND ${whenFilter('late', today)})::int AS overdue,
          count(*) FILTER (WHERE ${LIVE} AND ${whenFilter('upcoming', today)})::int AS upcoming,
          count(*) FILTER (WHERE ${LOST})::int AS lost
        FROM leads l WHERE l.assigned_to IS NOT NULL ${scope}`),
      rows<{ status: string; today: number; yesterday: number; late: number; upcoming: number; total: number }>(sql`
        SELECT ${STATUS} AS status,
          count(*) FILTER (WHERE ${whenFilter('today', today)})::int AS today,
          count(*) FILTER (WHERE ${whenFilter('yesterday', today)})::int AS yesterday,
          count(*) FILTER (WHERE ${whenFilter('late', today)})::int AS late,
          count(*) FILTER (WHERE ${whenFilter('upcoming', today)})::int AS upcoming,
          count(*)::int AS total
        FROM leads l WHERE l.assigned_to IS NOT NULL AND ${LIVE} ${scope}
        GROUP BY 1 ORDER BY total DESC, 1`),
      rows<Record<string, number>>(sql`
        SELECT count(*)::int AS total,
          count(*) FILTER (WHERE c.duration_sec > 0)::int AS connected,
          count(*) FILTER (WHERE coalesce(c.duration_sec, 0) = 0)::int AS "notConnected",
          coalesce(sum(c.duration_sec), 0)::int AS "durationSec"
        FROM call_logs c WHERE c.user_id IS NOT NULL AND ${day('c.started_at')} = ${today}::date ${bdmFilter(req, 'c.user_id')}`),
    ]);
    res.json({ today, cards, breakdown, calls: { ...calls, pending: cards.today }, updatedAt: new Date().toISOString() });
  } catch (err) {
    sendError(res, err, 'Failed to load the leads status overview');
  }
});

/** The leads behind one number of the overview */
router.get('/status-overview/leads', async (req: AuthRequest, res) => {
  try {
    const today = todayLocal();
    const scope = bdmFilter(req, 'l.assigned_to');
    const q = req.query;
    const when = OVERVIEW_WHEN.includes(q.when as (typeof OVERVIEW_WHEN)[number]) ? String(q.when) : 'total';
    const filters: SQL[] = [];
    if (q.kind === 'lost') filters.push(LOST);
    else if (q.kind === 'new-today' || q.kind === 'new-yesterday') {
      filters.push(sql`${day('l.created_at')} = (${today}::date - ${q.kind === 'new-today' ? 0 : 1}::int)`);
      if (q.pending === '1') filters.push(sql`${LIVE} AND ${STATUS} IN (${sql.join(PENDING_STATUSES.map((s) => sql`${s}`), sql`, `)})`);
    } else {
      filters.push(LIVE, whenFilter(when, today));
      if (typeof q.status === 'string' && q.status) filters.push(sql`${STATUS} = ${q.status}`);
    }
    const data = await rows(sql`
      SELECT l.id, coalesce(nullif(btrim(l.contact_name), ''), l.company_name) AS name, l.phone, ${STATUS} AS status, l.next_followup_at AS "nextFollowupAt",
        l.created_at AS "createdAt", u.name AS "assignedName"
      FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.assigned_to IS NOT NULL AND ${sql.join(filters, sql` AND `)} ${scope}
      ORDER BY l.next_followup_at ASC NULLS FIRST, l.created_at DESC LIMIT 1000`);
    res.json({ rows: data });
  } catch (err) {
    sendError(res, err, 'Failed to load the leads');
  }
});

/** Leader Dashboard — BDM leaderboard for a period */
router.get('/leaderboard', async (req: AuthRequest, res) => {
  try {
    const { from, to } = dateRange(req.query, 30);
    const data = await rows(sql`
      SELECT u.id AS "userId", u.name, u.in_rotation AS "inRotation",
        count(l.id)::int AS assigned,
        count(l.id) FILTER (WHERE l.first_contact_at IS NOT NULL)::int AS contacted,
        count(l.id) FILTER (WHERE l.stage NOT IN ('WON', 'LOST') AND l.first_contact_at IS NULL)::int AS pending,
        count(l.id) FILTER (WHERE l.stage = 'WON')::int AS won,
        count(l.id) FILTER (WHERE l.stage = 'LOST')::int AS lost,
        coalesce(sum(l.estimated_value) FILTER (WHERE l.stage = 'WON'), 0)::float8 AS "wonValue",
        round(coalesce(avg(extract(epoch FROM (l.first_contact_at - l.assigned_at)) / 60) FILTER (WHERE l.first_contact_at >= l.assigned_at), 0))::int AS "avgResponseMins",
        (SELECT count(*)::int FROM lead_followups f WHERE f.user_id = u.id AND ${day('f.created_at')} BETWEEN ${from} AND ${to}) AS followups,
        (SELECT count(*)::int FROM call_logs c WHERE c.user_id = u.id AND c.direction = 'outgoing' AND ${day('c.started_at')} BETWEEN ${from} AND ${to}) AS "callsMade",
        (SELECT count(*)::int FROM call_logs c WHERE c.user_id = u.id AND c.duration_sec > 0 AND c.direction IN ('outgoing','incoming') AND ${day('c.started_at')} BETWEEN ${from} AND ${to}) AS "callsConnected",
        (SELECT coalesce(sum(c.duration_sec), 0)::int FROM call_logs c WHERE c.user_id = u.id AND ${day('c.started_at')} BETWEEN ${from} AND ${to}) AS "talkSec"
      FROM users u
      LEFT JOIN leads l ON l.assigned_to = u.id AND ${day('l.assigned_at')} BETWEEN ${from} AND ${to}
      WHERE u.role = ${BDM_ROLE} AND u.is_active
      GROUP BY u.id
      ORDER BY won DESC, "wonValue" DESC, contacted DESC`);
    res.json({
      range: { from, to },
      rows: (data as Array<Record<string, number>>).map((r) => ({ ...r, conversionRate: r.assigned ? Math.round((r.won / r.assigned) * 1000) / 10 : 0 })),
    });
  } catch (err) {
    sendError(res, err, 'Failed to load leaderboard');
  }
});

/** Follow-ups done vs due per BDM per day */
router.get('/followups-datewise', async (req: AuthRequest, res) => {
  try {
    const { from, to } = dateRange(req.query, 7);
    const [done, due, dueList] = await Promise.all([
      rows<{ userId: string; name: string; date: string; count: number }>(sql`
        SELECT f.user_id AS "userId", u.name, to_char(${day('f.created_at')}, 'YYYY-MM-DD') AS date, count(*)::int AS count
        FROM lead_followups f JOIN users u ON u.id = f.user_id
        WHERE ${day('f.created_at')} BETWEEN ${from} AND ${to} ${bdmFilter(req, 'f.user_id')}
        GROUP BY 1, 2, 3`),
      rows<{ userId: string; name: string; date: string; count: number }>(sql`
        SELECT l.assigned_to AS "userId", u.name, to_char(${day('l.next_followup_at')}, 'YYYY-MM-DD') AS date, count(*)::int AS count
        FROM leads l JOIN users u ON u.id = l.assigned_to
        WHERE ${OPEN} AND ${day('l.next_followup_at')} BETWEEN ${from} AND ${to} ${bdmFilter(req, 'l.assigned_to')}
        GROUP BY 1, 2, 3`),
      rows(sql`
        SELECT l.id, coalesce(nullif(btrim(l.contact_name), ''), l.company_name) AS name, l.phone, l.stage, l.next_followup_at AS "nextFollowupAt", u.name AS "assignedName",
          (SELECT f.note FROM lead_followups f WHERE f.lead_id = l.id ORDER BY f.created_at DESC LIMIT 1) AS "lastNote"
        FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
        WHERE ${OPEN} AND ${day('l.next_followup_at')} BETWEEN ${from} AND ${to} ${bdmFilter(req, 'l.assigned_to')}
        ORDER BY l.next_followup_at ASC LIMIT 500`),
    ]);
    const dates = daysBetween(from, to);
    const people = new Map<string, { userId: string; name: string; cells: Record<string, { done: number; due: number }> }>();
    const cell = (r: { userId: string; name: string; date: string }) => {
      const p = people.get(r.userId) ?? { userId: r.userId, name: r.name, cells: {} };
      people.set(r.userId, p);
      return (p.cells[r.date] ??= { done: 0, due: 0 });
    };
    done.forEach((r) => (cell(r).done = r.count));
    due.forEach((r) => (cell(r).due = r.count));
    res.json({ dates, rows: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)), dueList });
  } catch (err) {
    sendError(res, err, 'Failed to load follow-up report');
  }
});

router.get('/followups', async (req: AuthRequest, res) => {
  try {
    const { from, to } = dateRange(req.query, 7);
    const outcome = typeof req.query.outcome === 'string' && req.query.outcome ? sql`AND f.outcome = ${req.query.outcome}` : sql``;
    const data = await rows(sql`
      SELECT f.id, f.outcome, f.note, f.next_followup_at AS "nextFollowupAt", f.created_at AS "createdAt",
        f.call_activity AS "callActivity", f.status_label AS "statusLabel", f.call_duration_sec AS "callDurationSec", f.reason,
        f.sample_shared AS "sampleShared", f.source,
        u.name AS "userName", l.id AS "leadId", l.company_name AS "leadName", l.phone, l.stage, l.campaign
      FROM lead_followups f
      JOIN leads l ON l.id = f.lead_id
      LEFT JOIN users u ON u.id = f.user_id
      WHERE ${day('f.created_at')} BETWEEN ${from} AND ${to} ${bdmFilter(req, 'f.user_id')} ${outcome}
      ORDER BY f.created_at DESC LIMIT 2000`);
    res.json({ range: { from, to }, rows: data });
  } catch (err) {
    sendError(res, err, 'Failed to load follow-ups');
  }
});

/** BDM × call outcome */
router.get('/followup-pivot', async (req: AuthRequest, res) => {
  try {
    const { from, to } = dateRange(req.query, 30);
    const data = await rows<{ userId: string; name: string; outcome: string; count: number }>(sql`
      SELECT f.user_id AS "userId", coalesce(u.name, 'Removed user') AS name, f.outcome, count(*)::int AS count
      FROM lead_followups f LEFT JOIN users u ON u.id = f.user_id
      WHERE ${day('f.created_at')} BETWEEN ${from} AND ${to} ${bdmFilter(req, 'f.user_id')}
      GROUP BY 1, 2, 3`);
    res.json({ range: { from, to }, cells: data });
  } catch (err) {
    sendError(res, err, 'Failed to load pivot');
  }
});

router.get('/closed', async (req: AuthRequest, res) => {
  try {
    const { from, to } = dateRange(req.query, 30);
    const stage = req.query.stage === 'LOST' ? 'LOST' : 'WON';
    const data = await rows(sql`
      SELECT l.id, coalesce(nullif(btrim(l.contact_name), ''), l.company_name) AS name, l.phone, l.email, l.city, l.source, l.campaign,
        coalesce(s.name, l.service) AS service, l.estimated_value AS "estimatedValue", l.stage, l.lost_reason AS "lostReason",
        l.created_at AS "createdAt", l.assigned_at AS "assignedAt", l.closed_at AS "closedAt", u.name AS "assignedName",
        (SELECT count(*)::int FROM lead_followups f WHERE f.lead_id = l.id) AS followups
      FROM leads l LEFT JOIN users u ON u.id = l.assigned_to LEFT JOIN services s ON s.id = l.service_id
      WHERE l.stage = ${stage} AND ${day('l.closed_at')} BETWEEN ${from} AND ${to} ${bdmFilter(req, 'l.assigned_to')}
      ORDER BY l.closed_at DESC LIMIT 2000`);
    res.json({ range: { from, to }, rows: data });
  } catch (err) {
    sendError(res, err, 'Failed to load closed leads');
  }
});

/** Hours logged via Start/Stop, follow-ups done and first-response time, per BDM per day */
router.get('/bdm-time', async (req: AuthRequest, res) => {
  try {
    const { from, to } = dateRange(req.query, 7);
    const [sessions, activity] = await Promise.all([
      rows<{ userId: string; name: string; date: string; minutes: number; sessions: number; firstStart: string; lastStop: string | null; open: boolean }>(sql`
        SELECT s.user_id AS "userId", u.name, to_char(${day('s.started_at')}, 'YYYY-MM-DD') AS date,
          round(sum(extract(epoch FROM (coalesce(s.ended_at, now()) - s.started_at)) / 60))::int AS minutes,
          count(*)::int AS sessions,
          min(s.started_at) AS "firstStart", max(s.ended_at) AS "lastStop", bool_or(s.ended_at IS NULL) AS open
        FROM bdm_sessions s JOIN users u ON u.id = s.user_id
        WHERE ${day('s.started_at')} BETWEEN ${from} AND ${to} ${bdmFilter(req, 's.user_id')}
        GROUP BY 1, 2, 3 ORDER BY 3 DESC, 2`),
      rows<{ userId: string; date: string; followups: number; avgResponseMins: number | null }>(sql`
        SELECT x."userId", x.date, sum(x.followups)::int AS followups, max(x."avgResponseMins") AS "avgResponseMins" FROM (
          SELECT f.user_id AS "userId", to_char(${day('f.created_at')}, 'YYYY-MM-DD') AS date, count(*) AS followups, NULL::int AS "avgResponseMins"
          FROM lead_followups f WHERE ${day('f.created_at')} BETWEEN ${from} AND ${to} ${bdmFilter(req, 'f.user_id')} GROUP BY 1, 2
          UNION ALL
          SELECT l.assigned_to, to_char(${day('l.assigned_at')}, 'YYYY-MM-DD'), 0,
            round(avg(extract(epoch FROM (l.first_contact_at - l.assigned_at)) / 60))::int
          FROM leads l WHERE l.first_contact_at >= l.assigned_at AND ${day('l.assigned_at')} BETWEEN ${from} AND ${to} ${bdmFilter(req, 'l.assigned_to')}
          GROUP BY 1, 2
        ) x GROUP BY 1, 2`),
    ]);
    const act = new Map(activity.map((a) => [`${a.userId}|${a.date}`, a]));
    res.json({
      range: { from, to },
      rows: sessions.map((s) => ({ ...s, followups: act.get(`${s.userId}|${s.date}`)?.followups ?? 0, avgResponseMins: act.get(`${s.userId}|${s.date}`)?.avgResponseMins ?? null })),
    });
  } catch (err) {
    sendError(res, err, 'Failed to load BDM time analysis');
  }
});

type CallDayRow = {
  userId: string; name: string; date: string; total: number; outgoing: number; incoming: number; missed: number;
  connected: number; notAnswered: number; talkSec: number; leadCalls: number; coldCalls: number; leadsCalled: number;
  unmatched: number; firstCall: string | null; lastCall: string | null;
  idleReason?: { reason: string; note: string | null; createdAt: string } | null;
};

type IdleReason = { userId: string; reason: string; note: string | null; createdAt: string };

/** Calls from phones and the calling service, per BDM per day */
router.get('/calls', async (req: AuthRequest, res) => {
  try {
    const { from, to } = dateRange(req.query, 7);
    const scope = bdmFilter(req, 'c.user_id');
    const today = todayLocal();
    const [perDay, hourly, people, idleReasons] = await Promise.all([
      rows<CallDayRow>(sql`
        SELECT c.user_id AS "userId", coalesce(u.name, 'Unknown') AS name, to_char(${day('c.started_at')}, 'YYYY-MM-DD') AS date,
          count(*)::int AS total,
          count(*) FILTER (WHERE c.direction = 'outgoing')::int AS outgoing,
          count(*) FILTER (WHERE c.direction = 'incoming')::int AS incoming,
          count(*) FILTER (WHERE c.direction IN ('missed', 'rejected'))::int AS missed,
          count(*) FILTER (WHERE c.direction IN ('outgoing', 'incoming') AND c.duration_sec > 0)::int AS connected,
          count(*) FILTER (WHERE c.direction = 'outgoing' AND c.duration_sec = 0)::int AS "notAnswered",
          coalesce(sum(c.duration_sec), 0)::int AS "talkSec",
          count(*) FILTER (WHERE c.direction = 'outgoing' AND c.lead_id IS NOT NULL)::int AS "leadCalls",
          count(*) FILTER (WHERE c.direction = 'outgoing' AND c.lead_id IS NULL)::int AS "coldCalls",
          count(DISTINCT c.lead_id)::int AS "leadsCalled",
          count(*) FILTER (WHERE c.lead_id IS NULL)::int AS unmatched,
          min(c.started_at) AS "firstCall", max(c.started_at) AS "lastCall"
        FROM call_logs c LEFT JOIN users u ON u.id = c.user_id
        WHERE ${day('c.started_at')} BETWEEN ${from} AND ${to} ${scope}
        GROUP BY 1, 2, 3`),
      rows(sql`
        SELECT extract(hour FROM c.started_at AT TIME ZONE ${tz})::int AS hour, count(*)::int AS calls,
          count(*) FILTER (WHERE c.direction IN ('outgoing', 'incoming') AND c.duration_sec > 0)::int AS connected
        FROM call_logs c WHERE ${day('c.started_at')} BETWEEN ${from} AND ${to} ${scope}
        GROUP BY 1 ORDER BY 1`),
      // Every working BDM, so someone who hasn't called at all today still shows up (in red)
      rows<{ userId: string; name: string }>(sql`
        SELECT u.id AS "userId", u.name FROM users u
        WHERE u.role = ${BDM_ROLE} AND u.is_active ${bdmFilter(req, 'u.id')} ORDER BY u.name`),
      // The newest reason each of them gave today for not calling
      rows<IdleReason>(sql`
        SELECT DISTINCT ON (r.user_id) r.user_id AS "userId", r.reason, r.note, r.created_at AS "createdAt"
        FROM bdm_idle_reasons r
        WHERE ${day('r.created_at')} = ${today} ${bdmFilter(req, 'r.user_id')}
        ORDER BY r.user_id, r.created_at DESC`),
    ]);
    const all = [...perDay];
    if (from <= today && today <= to) {
      for (const p of people) {
        if (!perDay.some((r) => r.userId === p.userId && r.date === today)) {
          all.push({
            userId: p.userId, name: p.name, date: today, total: 0, outgoing: 0, incoming: 0, missed: 0, connected: 0,
            notAnswered: 0, talkSec: 0, leadCalls: 0, coldCalls: 0, leadsCalled: 0, unmatched: 0, firstCall: null, lastCall: null,
          });
        }
      }
    }
    for (const row of all) {
      if (row.date !== today) continue;
      const given = idleReasons.find((r) => r.userId === row.userId);
      row.idleReason = given && (!row.lastCall || given.createdAt > row.lastCall) ? { reason: given.reason, note: given.note, createdAt: given.createdAt } : null;
    }
    // Newest day first, and inside a day the busiest BDM first - that order is the daily ranking
    all.sort((a, b) => (a.date === b.date ? b.outgoing - a.outgoing || b.total - a.total || a.name.localeCompare(b.name) : a.date < b.date ? 1 : -1));
    res.json({ range: { from, to }, today, workHours, rows: all, hourly });
  } catch (err) {
    sendError(res, err, 'Failed to load call report');
  }
});

/** No result was written on the call itself, so the lead's own stage says how it went */
const RESULT_BY_STAGE: Record<string, string> = { PROPOSAL: 'INTERESTED', NEGOTIATION: 'INTERESTED', WON: 'CONVERTED', LOST: 'LOST' };

type CallRow = {
  id: string; startedAt: string; direction: string; durationSec: number; status: string | null; source: string;
  phone: string; contactName: string | null; recordingUrl: string | null; recordingStatus: string | null;
  leadId: string | null; leadName: string | null; leadStage: string | null; statusLabel: string | null;
  outcome: string | null; note: string | null;
};

/** One salesperson: their day hour by hour, and every call they made or got - lead calls and cold calls alike */
router.get('/calls/bdm', async (req: AuthRequest, res) => {
  try {
    const { from, to } = dateRange(req.query, 1);
    const userId = optionalId(bdmScope(req, req.query.user), 'user');
    if (!userId) throw new HttpError(400, 'user is required');
    const inRange = sql`c.user_id = ${userId} AND ${day('c.started_at')} BETWEEN ${from} AND ${to}`;
    const [[person], hourly, reasons, calls] = await Promise.all([
      rows<{ userId: string; name: string }>(sql`SELECT u.id AS "userId", u.name FROM users u WHERE u.id = ${userId}`),
      rows(sql`
        SELECT extract(hour FROM c.started_at AT TIME ZONE ${tz})::int AS hour,
          count(*) FILTER (WHERE c.direction = 'outgoing')::int AS made,
          count(*) FILTER (WHERE c.direction IN ('outgoing', 'incoming') AND c.duration_sec > 0)::int AS connected,
          count(*) FILTER (WHERE c.direction = 'outgoing' AND c.duration_sec = 0)::int AS "notAnswered",
          count(*) FILTER (WHERE c.direction = 'incoming')::int AS incoming,
          count(*) FILTER (WHERE c.direction IN ('missed', 'rejected'))::int AS missed,
          count(*) FILTER (WHERE c.direction = 'outgoing' AND c.lead_id IS NOT NULL)::int AS "leadCalls",
          count(*) FILTER (WHERE c.direction = 'outgoing' AND c.lead_id IS NULL)::int AS "coldCalls",
          coalesce(sum(c.duration_sec), 0)::int AS "talkSec"
        FROM call_logs c WHERE ${inRange} GROUP BY 1 ORDER BY 1`),
      rows<{ reason: string; note: string | null; createdAt: string }>(sql`
        SELECT r.reason, r.note, r.created_at AS "createdAt" FROM bdm_idle_reasons r
        WHERE r.user_id = ${userId} AND ${day('r.created_at')} BETWEEN ${from} AND ${to}
        ORDER BY r.created_at DESC`),
      rows<CallRow>(sql`
        SELECT c.id, c.started_at AS "startedAt", c.direction, c.duration_sec AS "durationSec", c.status, c.source,
          c.phone, c.contact_name AS "contactName", c.recording_url AS "recordingUrl", r.status AS "recordingStatus",
          c.lead_id AS "leadId", l.company_name AS "leadName", l.stage AS "leadStage", l.status_label AS "statusLabel",
          f.outcome, f.note
        FROM call_logs c
        LEFT JOIN leads l ON l.id = c.lead_id
        LEFT JOIN call_recordings r ON r.call_log_id = c.id
        LEFT JOIN LATERAL (
          SELECT lf.outcome, lf.note FROM lead_followups lf WHERE lf.call_log_id = c.id ORDER BY lf.created_at DESC LIMIT 1
        ) f ON true
        WHERE ${inRange} ORDER BY c.started_at DESC LIMIT 1000`),
    ]);
    if (!person) throw new HttpError(404, 'Salesperson not found');
    res.json({
      range: { from, to },
      today: todayLocal(),
      workHours,
      person,
      hourly,
      reasons,
      // A call on a number the CRM doesn't know yet is a cold call; the rest are calls on leads
      calls: calls.map((c) => ({ ...c, kind: c.leadId ? 'lead' : 'cold', result: c.outcome ?? RESULT_BY_STAGE[c.leadStage ?? ''] ?? null })),
    });
  } catch (err) {
    sendError(res, err, 'Failed to load this salesperson\'s calls');
  }
});

// ─── CRM Admin ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Lead Weekly Summary: per BDM per day, "leads - not contacted yet". As in the old CRM, a lead counts on the day it
 * came in, under the BDM who holds it now — a transfer moves it to the new BDM's row, not to another day.
 */
router.get('/lead-summary', requireCrmAdmin, async (req: AuthRequest, res) => {
  try {
    const { from, to } = weekWindow(req.query);
    const division = optionalId(req.query.division, 'division');
    const manual = req.query.manual === 'no' ? sql`AND NOT l.is_manual` : req.query.manual === 'only' ? sql`AND l.is_manual` : sql``;
    const today = todayLocal();
    const [people, cells] = await Promise.all([
      rows<{ userId: string; name: string; inRotation: boolean; onLeave: boolean; rotationPosition: number }>(sql`
        SELECT u.id AS "userId", u.name, u.in_rotation AS "inRotation", u.rotation_position AS "rotationPosition",
          EXISTS (SELECT 1 FROM bdm_leaves b WHERE b.user_id = u.id AND ${today}::date BETWEEN b.from_date AND b.to_date) AS "onLeave"
        FROM users u
        WHERE u.role = ${BDM_ROLE} AND u.is_active ${division ? sql`AND u.division_id = ${division}` : sql``}
        ORDER BY u.rotation_position, u.name`),
      rows<{ userId: string; date: string; assigned: number; pending: number }>(sql`
        SELECT l.assigned_to AS "userId", to_char(${day('l.created_at')}, 'YYYY-MM-DD') AS date,
          count(*)::int AS assigned,
          count(*) FILTER (WHERE l.first_contact_at IS NULL)::int AS pending
        FROM leads l ${division ? sql`JOIN users u ON u.id = l.assigned_to AND u.division_id = ${division}` : sql``}
        WHERE l.assigned_to IS NOT NULL AND ${day('l.created_at')} BETWEEN ${from} AND ${to} ${manual}
        GROUP BY 1, 2`),
    ]);
    const dates = daysBetween(from, to).reverse();
    const byUser = new Map<string, Record<string, { assigned: number; pending: number }>>();
    for (const c of cells) {
      const entry = byUser.get(c.userId) ?? {};
      entry[c.date] = { assigned: c.assigned, pending: c.pending };
      byUser.set(c.userId, entry);
    }
    const totals = Object.fromEntries(
      dates.map((d) => [
        d,
        cells.filter((c) => c.date === d && people.some((p) => p.userId === c.userId)).reduce((s, c) => ({ assigned: s.assigned + c.assigned, pending: s.pending + c.pending }), { assigned: 0, pending: 0 }),
      ])
    );
    res.json({ range: { from, to }, dates, rows: people.map((p) => ({ ...p, cells: byUser.get(p.userId) ?? {} })), totals });
  } catch (err) {
    sendError(res, err, 'Failed to load lead summary');
  }
});

/** The leads behind one Lead Summary number: a BDM (or every listed BDM) over a day or the week */
router.get('/lead-summary/leads', requireCrmAdmin, async (req: AuthRequest, res) => {
  try {
    const q = req.query;
    if (!isDateString(q.from) || !isDateString(q.to)) throw new HttpError(400, 'from and to are required');
    const user = optionalId(q.user, 'user');
    const division = optionalId(q.division, 'division');
    const data = await rows(sql`
      SELECT l.id, coalesce(nullif(btrim(l.contact_name), ''), l.company_name) AS name, l.phone, l.source, l.campaign, l.stage, l.status_label AS "statusLabel",
        l.created_at AS "createdAt", l.first_contact_at AS "firstContactAt", l.next_followup_at AS "nextFollowupAt", u.name AS "assignedName"
      FROM leads l JOIN users u ON u.id = l.assigned_to
      WHERE ${day('l.created_at')} BETWEEN ${q.from} AND ${q.to}
        ${user ? sql`AND l.assigned_to = ${user}` : sql`AND u.role = ${BDM_ROLE} AND u.is_active`}
        ${division ? sql`AND u.division_id = ${division}` : sql``}
        ${q.pending === '1' ? sql`AND l.first_contact_at IS NULL` : sql``}
        ${q.manual === 'no' ? sql`AND NOT l.is_manual` : q.manual === 'only' ? sql`AND l.is_manual` : sql``}
      ORDER BY l.created_at DESC LIMIT 2000`);
    res.json({ rows: data });
  } catch (err) {
    sendError(res, err, 'Failed to load the leads');
  }
});

/** Source (or campaign) × day, by lead creation date */
router.get('/source-summary', requireCrmAdmin, async (req: AuthRequest, res) => {
  try {
    const { from, to } = weekWindow(req.query);
    const group = req.query.by === 'campaign' ? sql.raw(`coalesce(l.campaign, '(no campaign)')`) : sql.raw(`coalesce(l.source, 'unknown')`);
    const cells = await rows<{ key: string; date: string; total: number; won: number }>(sql`
      SELECT ${group} AS key, to_char(${day('l.created_at')}, 'YYYY-MM-DD') AS date,
        count(*)::int AS total, count(*) FILTER (WHERE l.stage = 'WON')::int AS won
      FROM leads l WHERE ${day('l.created_at')} BETWEEN ${from} AND ${to}
      GROUP BY 1, 2`);
    res.json({ range: { from, to }, dates: daysBetween(from, to).reverse(), cells });
  } catch (err) {
    sendError(res, err, 'Failed to load source summary');
  }
});

/** Lost leads — BDMs see their own (bdmFilter), admins and coordination everyone's */
router.get('/lost', async (req: AuthRequest, res) => {
  try {
    const { from, to } = dateRange(req.query, 30);
    const data = await rows(sql`
      SELECT l.id, coalesce(nullif(btrim(l.contact_name), ''), l.company_name) AS name, l.phone, l.source, l.campaign, coalesce(s.name, l.service) AS service,
        coalesce(l.lost_reason, 'Not specified') AS "lostReason", l.estimated_value AS "estimatedValue",
        l.created_at AS "createdAt", l.closed_at AS "closedAt", u.name AS "assignedName",
        (SELECT f.note FROM lead_followups f WHERE f.lead_id = l.id ORDER BY f.created_at DESC LIMIT 1) AS "lastNote"
      FROM leads l LEFT JOIN users u ON u.id = l.assigned_to LEFT JOIN services s ON s.id = l.service_id
      WHERE l.stage = 'LOST' AND ${day('l.closed_at')} BETWEEN ${from} AND ${to} ${bdmFilter(req, 'l.assigned_to')}
      ORDER BY l.closed_at DESC LIMIT 2000`);
    res.json({ range: { from, to }, rows: data });
  } catch (err) {
    sendError(res, err, 'Failed to load lost leads');
  }
});

router.get('/lost-analysis', requireCrmAdmin, async (req: AuthRequest, res) => {
  try {
    const { from, to } = dateRange(req.query, 30);
    const base = sql`FROM leads l LEFT JOIN users u ON u.id = l.assigned_to WHERE l.stage = 'LOST' AND ${day('l.closed_at')} BETWEEN ${from} AND ${to}`;
    const reason = sql.raw(`coalesce(l.lost_reason, 'Not specified')`);
    const [byReason, byBdm, bySource, [totals]] = await Promise.all([
      rows(sql`SELECT ${reason} AS reason, count(*)::int AS count, coalesce(sum(l.estimated_value), 0)::float8 AS value ${base} GROUP BY 1 ORDER BY 2 DESC`),
      rows(sql`SELECT ${reason} AS reason, coalesce(u.name, 'Unassigned') AS name, count(*)::int AS count ${base} GROUP BY 1, 2`),
      rows(sql`SELECT ${reason} AS reason, coalesce(l.source, 'unknown') AS source, count(*)::int AS count ${base} GROUP BY 1, 2`),
      rows<{ lost: number; closed: number }>(sql`
        SELECT count(*) FILTER (WHERE l.stage = 'LOST')::int AS lost, count(*)::int AS closed
        FROM leads l WHERE l.stage IN ('WON', 'LOST') AND ${day('l.closed_at')} BETWEEN ${from} AND ${to}`),
    ]);
    res.json({ range: { from, to }, byReason, byBdm, bySource, totals });
  } catch (err) {
    sendError(res, err, 'Failed to load lost lead analysis');
  }
});

/** Leads received from Meta / sheets vs leads that became CRM leads, per day and campaign */
router.get('/actual-vs-fb', requireCrmAdmin, async (req: AuthRequest, res) => {
  try {
    const { from, to } = dateRange(req.query, 7);
    const [imports, manual] = await Promise.all([
      rows(sql`
        SELECT to_char(${day('i.received_at')}, 'YYYY-MM-DD') AS date, coalesce(i.campaign, '(no campaign)') AS campaign, src.name AS source, src.type,
          count(*)::int AS "fbLeads",
          count(*) FILTER (WHERE i.status = 'imported')::int AS "actualLeads",
          count(*) FILTER (WHERE i.status = 'duplicate')::int AS duplicates,
          count(*) FILTER (WHERE i.status = 'error')::int AS errors
        FROM lead_imports i JOIN lead_sources src ON src.id = i.source_id
        WHERE i.status <> 'ignored' AND ${day('i.received_at')} BETWEEN ${from} AND ${to}
        GROUP BY 1, 2, 3, 4 ORDER BY 1 DESC, 5 DESC`),
      rows(sql`
        SELECT to_char(${day('l.created_at')}, 'YYYY-MM-DD') AS date, count(*)::int AS count
        FROM leads l WHERE l.is_manual AND ${day('l.created_at')} BETWEEN ${from} AND ${to} GROUP BY 1`),
    ]);
    res.json({ range: { from, to }, rows: imports, manualByDate: manual });
  } catch (err) {
    sendError(res, err, 'Failed to load actual vs FB leads');
  }
});

/** BDM × lead stage for leads created (or assigned) in the period */
router.get('/bdm-status', requireCrmAdmin, async (req: AuthRequest, res) => {
  try {
    const { from, to } = dateRange(req.query, 30);
    const column = req.query.dateField === 'assigned' ? 'l.assigned_at' : 'l.created_at';
    const cells = await rows(sql`
      SELECT l.assigned_to AS "userId", coalesce(u.name, 'Unassigned') AS name, l.stage, count(*)::int AS count,
        count(*) FILTER (WHERE ${OPEN} AND l.first_contact_at IS NULL)::int AS pending,
        coalesce(sum(l.estimated_value), 0)::float8 AS value
      FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
      WHERE ${day(column)} BETWEEN ${from} AND ${to}
      GROUP BY 1, 2, 3`);
    res.json({ range: { from, to }, cells });
  } catch (err) {
    sendError(res, err, 'Failed to load BDM status data');
  }
});

/** Week (Mon–Sun) closures and revenue vs each BDM's targets */
router.get('/weekly-targets', requireCrmAdminOrCoordination, async (req: AuthRequest, res) => {
  try {
    const anchor = isDateString(req.query.weekStart) ? req.query.weekStart : todayLocal();
    const dow = (new Date(`${anchor}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    const from = addDays(anchor, -dow);
    const to = addDays(from, 6);
    const data = await rows<Record<string, number | string>>(sql`
      SELECT u.id AS "userId", u.name, u.weekly_lead_target AS "leadTarget", u.weekly_revenue_target AS "revenueTarget",
        count(l.id) FILTER (WHERE ${day('l.assigned_at')} BETWEEN ${from} AND ${to})::int AS assigned,
        count(l.id) FILTER (WHERE l.stage = 'WON' AND ${day('l.closed_at')} BETWEEN ${from} AND ${to})::int AS won,
        coalesce(sum(l.estimated_value) FILTER (WHERE l.stage = 'WON' AND ${day('l.closed_at')} BETWEEN ${from} AND ${to}), 0)::float8 AS revenue
      FROM users u LEFT JOIN leads l ON l.assigned_to = u.id
      WHERE u.role = ${BDM_ROLE} AND u.is_active
      GROUP BY u.id ORDER BY u.name`);
    res.json({
      range: { from, to },
      rows: data.map((r) => ({
        ...r,
        leadAchievement: Number(r.leadTarget) ? Math.round((Number(r.won) / Number(r.leadTarget)) * 100) : null,
        revenueAchievement: Number(r.revenueTarget) ? Math.round((Number(r.revenue) / Number(r.revenueTarget)) * 100) : null,
      })),
    });
  } catch (err) {
    sendError(res, err, 'Failed to load weekly targets');
  }
});

router.get('/whatsapp-log', requireCrmAdmin, async (req: AuthRequest, res) => {
  try {
    const { from, to } = dateRange(req.query, 7);
    const data = await rows(sql`
      SELECT w.id, w.phone, w.message, w.created_at AS "createdAt", u.name AS "userName", l.id AS "leadId", l.company_name AS "leadName"
      FROM whatsapp_logs w LEFT JOIN users u ON u.id = w.user_id LEFT JOIN leads l ON l.id = w.lead_id
      WHERE ${day('w.created_at')} BETWEEN ${from} AND ${to} ${bdmFilter(req, 'w.user_id')}
      ORDER BY w.created_at DESC LIMIT 2000`);
    res.json({ range: { from, to }, rows: data });
  } catch (err) {
    sendError(res, err, 'Failed to load WhatsApp log');
  }
});

export default router;
