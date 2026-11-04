/** Shared Sales CRM types, labels and helpers */

export const CRM_ROLES = ["SUPER_ADMIN", "MANAGEMENT", "PROJECT_MANAGER", "SALES"];
export const CRM_ADMIN_ROLES = ["SUPER_ADMIN", "MANAGEMENT"];
export const HR_ROLES = ["SUPER_ADMIN", "MANAGEMENT", "HR"];
export const isCrmAdmin = (role?: string) => !!role && CRM_ADMIN_ROLES.includes(role);
/** Coordination (the imported VTI role, or a custom COORDINATION role): hands won clients over to production */
export const COORDINATION_ROLES = ["VTI_COORDINATION", "COORDINATION"];
export const isCoordination = (role?: string) => !!role && COORDINATION_ROLES.includes(role);
export const isBdm = (role?: string) => role === "SALES";

/**
 * Four colours carry the whole pipeline at a glance: orange is nobody on the line yet, yellow is a live
 * conversation to follow up, green is won and red is dead. Keep the badges here in step with LEADS_STAGES
 * in app/(dashboard)/leads/page.tsx and STAGE_COLORS in app/(dashboard)/dashboard/page.tsx.
 */
export const STAGES = [
  { key: "AWARENESS", label: "New", badge: "badge-orange" },
  { key: "CONTACTED", label: "Contacted", badge: "badge-yellow" },
  { key: "PROPOSAL", label: "Interested", badge: "badge-yellow" },
  { key: "NEGOTIATION", label: "Negotiation", badge: "badge-yellow" },
  { key: "WON", label: "Won", badge: "badge-green" },
  { key: "LOST", label: "Lost", badge: "badge-red" },
] as const;

/** The same four colours as STAGES: not connected, connected / follow-up, converted, lost */
export const OUTCOMES = [
  { key: "CONNECTED", label: "Connected", badge: "badge-yellow" },
  { key: "CALL_BACK", label: "Call back", badge: "badge-yellow" },
  { key: "NOT_REACHABLE", label: "Not reachable", badge: "badge-orange" },
  { key: "INTERESTED", label: "Interested", badge: "badge-yellow" },
  { key: "NOT_INTERESTED", label: "Not interested", badge: "badge-red" },
  { key: "CONVERTED", label: "Converted (won)", badge: "badge-green" },
  { key: "LOST", label: "Lost", badge: "badge-red" },
] as const;

/**
 * Leads carry a free-text status from the old CRM ("Hot Closing", "Fresh", "Not Interested" …) as well as a
 * stage. These are the groupings importLegacyCrm.ts uses to turn one into the other, so a panel showing the
 * raw label lands on the same colour as one showing the stage.
 */
const STATUS_WON = ["closed", "booked", "token amount received", "won", "converted"];
const STATUS_LOST = ["lost", "not interested", "invalid", "disqualified", "just curious", "event planner", "travel agent", "voucher inquiry", "investor (real estate)"];
const STATUS_NEW = ["fresh", "new", "proposal call(fresh)", "not contacted"];

export type StatusTone = "orange" | "yellow" | "green" | "red" | "gray";

/** Anything we don't recognise is a lead somebody has already spoken to, so it follows up in yellow. */
export function statusTone(label?: string | null): StatusTone {
  const s = (label ?? "").trim().toLowerCase();
  if (!s) return "gray";
  if (STATUS_WON.includes(s)) return "green";
  if (STATUS_LOST.includes(s)) return "red";
  if (STATUS_NEW.includes(s)) return "orange";
  return "yellow";
}

/** Badge class for a status label, in the four pipeline colours */
export const statusBadge = (label?: string | null) => `badge-${statusTone(label)}`;

/** The same four colours as a solid dot, for list markers */
export const STATUS_DOT: Record<StatusTone, string> = {
  orange: "bg-orange-400",
  yellow: "bg-yellow-400",
  green: "bg-emerald-500",
  red: "bg-red-500",
  gray: "bg-muted-foreground",
};

/**
 * What the four row colours stand for, for the key above a table. Two readings of the same colours: a
 * lead's stage on the lead tables, a call's outcome on the calling ones. Yellow covers three stages at
 * once, so the stage key names the stretch rather than any one of them.
 */
export const STAGE_LEGEND = [
  { label: "New", badge: "badge-orange" },
  { label: "Contacted / interested", badge: "badge-yellow" },
  { label: "Won", badge: "badge-green" },
  { label: "Lost", badge: "badge-red" },
] as const;

export const OUTCOME_LEGEND = [
  { label: "Not reachable", badge: "badge-orange" },
  { label: "Connected", badge: "badge-yellow" },
  { label: "Converted (won)", badge: "badge-green" },
  { label: "Lost", badge: "badge-red" },
] as const;

/** The key to the two-colour reading below: only the closed leads carry a colour */
export const WON_LOST_LEGEND = [
  { label: "Won", badge: "badge-green" },
  { label: "Lost", badge: "badge-red" },
] as const;

export const LOST_REASONS = ["Price too high", "Not interested", "Chose competitor", "Not reachable", "Location / timing", "Duplicate / invalid", "Other"];

export const stageMeta = (key?: string | null) => STAGES.find((s) => s.key === key) ?? { key: key ?? "", label: key ?? "—", badge: "badge-gray" };
export const outcomeMeta = (key?: string | null) => OUTCOMES.find((o) => o.key === key) ?? { key: key ?? "", label: key ?? "—", badge: "badge-gray" };

/**
 * The same status as a whole-row tint for DataTable's rowClassName. Derived from the badge so a row and its
 * badge can never drift apart; anything outside the four pipeline colours leaves the row alone.
 */
function rowClass(badge: string): string {
  const tone = badge.replace("badge-", "");
  return ["orange", "yellow", "green", "red"].includes(tone) ? `row-${tone}` : "";
}

/** Row tint for a lead's stage */
export const stageRow = (stage?: string | null) => rowClass(stageMeta(stage).badge);

/** Row tint for a call's outcome, falling back to the lead's stage when the call has no result yet */
export const outcomeRow = (outcome?: string | null, stage?: string | null) =>
  outcome ? rowClass(outcomeMeta(outcome).badge) : stage ? stageRow(stage) : "";

/** Row tint for an old-CRM status label */
export const statusRow = (label?: string | null) => rowClass(statusBadge(label));

/**
 * The two-colour reading of the same pipeline, for the Call log, the lead tables and Client leisure: green
 * once a lead is won, red once it is lost, and no colour at all for every stage in between, so a scan of
 * those lists picks out what is closed rather than tinting every row.
 */
const wonLostOnly = (badge: string) => (badge === "badge-green" || badge === "badge-red" ? badge : "badge-gray");

/** Badge for a lead's stage, won and lost only */
export const stageBadgeWonLost = (stage?: string | null) => wonLostOnly(stageMeta(stage).badge);

/**
 * These two do not use rowClass: a solid fill is far too loud when it marks the handful of closed rows in
 * an otherwise plain table, so they take the light wash and left bar defined for .row-won / .row-lost.
 */
const wonLostRow = (badge: string) => (badge === "badge-green" ? "row-won" : badge === "badge-red" ? "row-lost" : "");

/** Row highlight for a lead's stage, won and lost only */
export const stageRowWonLost = (stage?: string | null) => wonLostRow(stageBadgeWonLost(stage));

/** Badge for a call's outcome, won and lost only */
export const outcomeBadgeWonLost = (outcome?: string | null) => wonLostOnly(outcomeMeta(outcome).badge);

/**
 * Row highlight for a call, won and lost only. An after-call form that closed the deal either way colours
 * the row itself; anything else falls through to the Won/Lost badge beside the lead's name - a call nobody
 * answered, and one marked "not reachable", included. So every call on a closed lead reads the same way
 * down the column, instead of a handful of them being picked out.
 */
export const outcomeRowWonLost = (call: { outcome?: string | null; leadStage?: string | null }) =>
  wonLostRow(outcomeBadgeWonLost(call.outcome)) || stageRowWonLost(call.leadStage);

// ─── The calling day ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Office hours: 10:30 am to 7:00 pm, lunch 1:30 to 2:00 pm. Inside them, a BDM with no call for
 * `idleMinutes` is shown in red; lunch is time off, so it never counts towards that quiet stretch.
 */
export const WORK = { startHour: 10, startMinute: 30, endHour: 19, idleMinutes: 20, lunchStart: 13 * 60 + 30, lunchEnd: 14 * 60 };

/** The hour the lunch break falls in, for the hour-by-hour report */
export const LUNCH_HOUR = Math.floor(WORK.lunchStart / 60);

/** The hours of the working day, as buckets: 10–11, 11–12 … 6–7 */
export const WORK_HOURS = Array.from({ length: WORK.endHour - WORK.startHour }, (_, i) => WORK.startHour + i);

const hour12 = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? " am" : " pm"}`;

/** 10 → "10:30 – 11 am" (the day starts at 10:30), 14 → "2 – 3 pm" */
export const workHourLabel = (h: number) =>
  h === WORK.startHour ? `${WORK.startHour}:${WORK.startMinute} – ${hour12(h + 1)}` : `${hour12(h)} – ${hour12(h + 1)}`;

export type CallingStatus = { key: "working" | "idle" | "off" | "lunch"; label: string; sub: string; badge: string; dot: string };

/** Minutes since the last call, with the lunch break taken out - nobody is "quiet" over their lunch */
function quietMinutes(lastCall: Date, now: Date): number {
  const total = Math.floor((now.getTime() - lastCall.getTime()) / 60000);
  const from = lastCall.getHours() * 60 + lastCall.getMinutes();
  const to = now.getHours() * 60 + now.getMinutes();
  const lunch = Math.max(0, Math.min(to, WORK.lunchEnd) - Math.max(from, WORK.lunchStart));
  return Math.max(0, total - lunch);
}

/**
 * Is this salesperson calling right now? Only means anything for today: green while a call was made in the
 * last `idleMinutes`, red once the line has gone quiet inside office hours, grey outside them.
 */
export function callingStatus(lastCall: string | null | undefined, now: Date = new Date()): CallingStatus {
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  if (minuteOfDay < WORK.startHour * 60 + WORK.startMinute || minuteOfDay >= WORK.endHour * 60) {
    return { key: "off", label: "Off hours", sub: "Work is 10:30 am – 7 pm", badge: "badge-gray", dot: "bg-muted-foreground" };
  }
  if (minuteOfDay >= WORK.lunchStart && minuteOfDay < WORK.lunchEnd) {
    return { key: "lunch", label: "Lunch break", sub: "1:30 – 2 pm", badge: "badge-gray", dot: "bg-muted-foreground" };
  }
  const quiet = lastCall ? quietMinutes(new Date(lastCall), now) : null;
  if (quiet === null) return { key: "idle", label: "Not calling", sub: "No calls today", badge: "badge-red", dot: "bg-red-500" };
  if (quiet >= WORK.idleMinutes) return { key: "idle", label: "Not calling", sub: `Quiet for ${quiet} min`, badge: "badge-red", dot: "bg-red-500" };
  return { key: "working", label: "Working", sub: quiet < 1 ? "Calling now" : `Last call ${quiet} min ago`, badge: "badge-green", dot: "bg-emerald-500" };
}

/** Who made the most calls that day: 1 is the busiest, people with the same number share a rank */
export const rankOf = <T extends { date: string; outgoing: number }>(row: T, all: T[]) =>
  all.filter((r) => r.date === row.date && r.outgoing > row.outgoing).length + 1;


export type CrmLead = {
  id: string;
  name: string;
  /** The person, when the lead's name is their company */
  contactName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  source: string | null;
  campaign: string | null;
  adName: string | null;
  formName: string | null;
  platform: string | null;
  service: string | null;
  serviceId: string | null;
  stage: string;
  estimatedValue: number | null;
  notes: string | null;
  isManual: boolean;
  assignedTo: string | null;
  assignedName: string | null;
  assignedAt: string | null;
  firstContactAt: string | null;
  lastContactAt: string | null;
  nextFollowupAt: string | null;
  closedAt: string | null;
  lostReason: string | null;
  /** Asked on the phone app's after-call form */
  businessType: "B2B" | "B2C" | null;
  /** Detailed status from the old CRM (Hot, Cold, Follow Up, …) */
  statusLabel: string | null;
  /** The latest follow-up's remark */
  lastRemark: string | null;
  sampleSharedAt: string | null;
  createdAt: string;
  pending: boolean;
  overdue: boolean;
};

export type Bdm = {
  id: string;
  name: string;
  username: string;
  email?: string;
  phone?: string | null;
  isActive: boolean;
  inRotation: boolean;
  rotationPosition: number;
  lastAssignedAt: string | null;
  weeklyLeadTarget: number;
  weeklyRevenueTarget: number;
  divisionId: string | null;
  divisionName: string | null;
  onLeave: boolean;
  sessionStartedAt: string | null;
  openLeads: number;
  pendingLeads: number;
};

// ─── Formatting ────────────────────────────────────────────────────────────────────────────────────────────────

export const inr = (n?: number | null) =>
  n == null ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`;

export const compactInr = (n?: number | null) => {
  const v = n ?? 0;
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K`;
  return `₹${Math.round(v)}`;
};

export const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export const fmtDateTime = (d?: string | null) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

/** "2026-09-13" → "13 Sep" */
export const fmtDay = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function fmtMinutes(mins?: number | null) {
  if (mins == null) return "—";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** 187 → "3m 07s" */
export function fmtCallDuration(sec?: number | null) {
  if (!sec) return "0s";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${m}m`;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

export function timeAgo(d?: string | null) {
  if (!d) return "—";
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

// ─── Dates (local calendar days) ───────────────────────────────────────────────────────────────────────────────

export const toDay = (d: Date) => {
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
};
export const today = () => toDay(new Date());
export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return toDay(d);
};

/** Value for <input type="datetime-local"> */
export const toLocalInput = (d?: string | Date | null) => {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : "";
};

// ─── CSV (client-side export of what's on screen) ──────────────────────────────────────────────────────────────

export function downloadCsv(filename: string, headers: string[], rows: Array<Array<unknown>>) {
  const cell = (v: unknown) => {
    const text = v == null ? "" : String(v);
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = "﻿" + [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

