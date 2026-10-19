/** Shared Sales CRM types, labels and helpers */

export const CRM_ROLES = ["SUPER_ADMIN", "MANAGEMENT", "PROJECT_MANAGER", "SALES"];
export const CRM_ADMIN_ROLES = ["SUPER_ADMIN", "MANAGEMENT"];
export const HR_ROLES = ["SUPER_ADMIN", "MANAGEMENT", "HR"];
export const isCrmAdmin = (role?: string) => !!role && CRM_ADMIN_ROLES.includes(role);
/** Coordination (the imported VTI role, or a custom COORDINATION role): hands won clients over to production */
export const COORDINATION_ROLES = ["VTI_COORDINATION", "COORDINATION"];
export const isCoordination = (role?: string) => !!role && COORDINATION_ROLES.includes(role);
export const isBdm = (role?: string) => role === "SALES";

export const STAGES = [
  { key: "AWARENESS", label: "New", badge: "badge-gray" },
  { key: "CONTACTED", label: "Contacted", badge: "badge-blue" },
  { key: "PROPOSAL", label: "Interested", badge: "badge-purple" },
  { key: "NEGOTIATION", label: "Negotiation", badge: "badge-amber" },
  { key: "WON", label: "Won", badge: "badge-green" },
  { key: "LOST", label: "Lost", badge: "badge-red" },
] as const;

export const OUTCOMES = [
  { key: "CONNECTED", label: "Connected", badge: "badge-blue" },
  { key: "CALL_BACK", label: "Call back", badge: "badge-sky" },
  { key: "NOT_REACHABLE", label: "Not reachable", badge: "badge-gray" },
  { key: "INTERESTED", label: "Interested", badge: "badge-purple" },
  { key: "NOT_INTERESTED", label: "Not interested", badge: "badge-amber" },
  { key: "CONVERTED", label: "Converted (won)", badge: "badge-green" },
  { key: "LOST", label: "Lost", badge: "badge-red" },
] as const;

export const LOST_REASONS = ["Price too high", "Not interested", "Chose competitor", "Not reachable", "Location / timing", "Duplicate / invalid", "Other"];

export const stageMeta = (key?: string | null) => STAGES.find((s) => s.key === key) ?? { key: key ?? "", label: key ?? "—", badge: "badge-gray" };
export const outcomeMeta = (key?: string | null) => OUTCOMES.find((o) => o.key === key) ?? { key: key ?? "", label: key ?? "—", badge: "badge-gray" };

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

