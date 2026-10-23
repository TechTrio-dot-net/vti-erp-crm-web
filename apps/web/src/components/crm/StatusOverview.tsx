"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Hourglass, Phone, PhoneMissed, PhoneOutgoing } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/crm";
import { useCrmUi } from "@/store/crm";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorState, LoadingBlock } from "@/components/crm/ui";

type Overview = {
  today: string;
  updatedAt: string;
  cards: {
    newToday: number; newTodayPending: number; newYesterday: number; newYesterdayPending: number;
    live: number; today: number; overdue: number; upcoming: number; lost: number;
  };
  breakdown: Array<{ status: string; today: number; yesterday: number; late: number; upcoming: number; total: number }>;
  calls: { total: number; connected: number; notConnected: number; durationSec: number; pending: number };
};
type Pick = { title: string; params: Record<string, string> };
type Row = { id: string; name: string; phone: string | null; status: string; nextFollowupAt: string | null; createdAt: string; assignedName: string | null };

const leadsKey = (query: string, scope: string) => ["crm", "status-overview", "leads", query, scope] as const;
const fetchLeads = (query: string, scope: string) => api<{ rows: Row[] }>(`/crm/reports/status-overview/leads?${query}${scope ? `&${scope}` : ""}`);

const WHEN = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["late", "Late"],
  ["upcoming", "Upcoming"],
  ["total", "Total"],
] as const;

/** Status dot colours as in the old CRM */
const dot = (status: string) =>
  /hot closing/i.test(status) ? "bg-red-500" : /^hot$/i.test(status) ? "bg-orange-400" : /fresh/i.test(status) ? "bg-blue-500" : "bg-emerald-500";

const hms = (sec: number) => [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60].map((n) => String(n).padStart(2, "0")).join(":");

/**
 * Leads Status Overview — the old CRM's BDM dashboard: new leads, live / due / overdue / upcoming / lost, the
 * live leads by status and next follow-up, and today's calls. Every number opens the leads behind it.
 */
export function StatusOverview({ bdm }: { bdm: string }) {
  const queryClient = useQueryClient();
  const [pick, setPick] = useState<Pick | null>(null);
  const scope = bdm ? `bdm=${bdm}` : "";
  const { data, isLoading } = useQuery({
    queryKey: ["crm", "status-overview", bdm],
    queryFn: () => api<Overview>(`/crm/reports/status-overview?${scope}`),
    refetchInterval: 60_000,
  });
  if (isLoading || !data) return <LoadingBlock rows={6} />;
  const { cards, breakdown, calls } = data;
  const open = (title: string, params: Record<string, string>) => setPick({ title, params });
  const sum = (key: (typeof WHEN)[number][0]) => breakdown.reduce((s, r) => s + r[key], 0);

  // Loading starts when the pointer reaches a number, so the list is usually there by the time it is clicked
  const prefetch = (params: Record<string, string>) => {
    const query = new URLSearchParams(params).toString();
    void queryClient.prefetchQuery({ queryKey: leadsKey(query, scope), queryFn: () => fetchLeads(query, scope), staleTime: 30_000 });
  };
  const Num = ({ value, title, params, className = "" }: { value: number; title: string; params: Record<string, string>; className?: string }) => (
    <button type="button" onClick={() => open(title, params)} onMouseEnter={() => prefetch(params)} onFocus={() => prefetch(params)} className={`tabular-nums font-semibold text-sky-700 dark:text-sky-400 hover:underline ${className}`}>
      {value}
    </button>
  );

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Leads Status Overview</h2>
        <p className="text-sm text-muted-foreground">Snapshot of follow-up statuses — Today / Late / Upcoming / Total</p>
      </div>

      <div className="grid lg:grid-cols-[1fr_260px] gap-4 items-start">
        <div className="space-y-4 min-w-0">
          <div className="grid sm:grid-cols-2 gap-4">
            {([
              ["Today's New Leads", cards.newToday, cards.newTodayPending, "new-today"],
              ["Yesterday's New Leads", cards.newYesterday, cards.newYesterdayPending, "new-yesterday"],
            ] as const).map(([label, total, pending, kind]) => (
              <div key={kind} className="card p-4">
                <p className="text-xs font-semibold text-muted-foreground">{label}</p>
                <Num value={total} title={label} params={{ kind }} className="text-2xl mt-1" />
                <button type="button" onClick={() => open(`${label} — pending Fresh + Proposal`, { kind, pending: "1" })} onMouseEnter={() => prefetch({ kind, pending: "1" })} className="block text-sm font-bold text-red-600 hover:underline mt-1">
                  Pending Fresh + Proposal {kind === "new-today" ? "Today" : "Yesterday"}: {pending}
                </button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {([
              ["Live Leads", cards.live, { when: "total" }],
              ["Today Due", cards.today, { when: "today" }],
              ["Overdue", cards.overdue, { when: "late" }],
              ["Upcoming", cards.upcoming, { when: "upcoming" }],
              ["Lost", cards.lost, { kind: "lost" }],
            ] as const).map(([label, value, params]) => (
              <div key={label} className="card p-4">
                <p className="text-xs font-semibold text-muted-foreground">{label}</p>
                <Num value={value} title={label} params={params} className="text-2xl mt-1" />
              </div>
            ))}
          </div>

          <div className="card">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
              <p className="font-semibold">Status breakdown</p>
              <p className="text-xs text-muted-foreground">Updated: {fmtDateTime(data.updatedAt)}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr><th>Status</th>{WHEN.map(([, label]) => <th key={label} className="text-right">{label}</th>)}</tr>
                </thead>
                <tbody>
                  {breakdown.length === 0 && <tr><td colSpan={6} className="text-center text-muted-foreground py-8">No live leads.</td></tr>}
                  {breakdown.map((r) => (
                    <tr key={r.status}>
                      <td className="font-semibold whitespace-nowrap"><span className={`inline-block size-2 rounded-full mr-2 ${dot(r.status)}`} />{r.status}</td>
                      {WHEN.map(([key, label]) => (
                        <td key={key} className="text-right"><Num value={r[key]} title={`${r.status} — ${label}`} params={{ status: r.status, when: key }} /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {breakdown.length > 0 && (
                  <tfoot>
                    <tr className="font-bold"><td>Total</td>{WHEN.map(([key]) => <td key={key} className="text-right tabular-nums">{sum(key)}</td>)}</tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>

        <div className="card p-4 space-y-4">
          <p className="font-semibold">Today</p>
          {([
            [Phone, "bg-sky-600", "Total Calls", calls.total],
            [PhoneOutgoing, "bg-emerald-600", "Connected", calls.connected],
            [PhoneMissed, "bg-red-600", "Not Connected", calls.notConnected],
            [Clock, "bg-amber-500", "Call Duration", hms(calls.durationSec)],
            [Hourglass, "bg-violet-600", "Pending Calls", calls.pending],
          ] as const).map(([Icon, tone, label, value]) => (
            <div key={label} className="flex items-center gap-3">
              <span className={`size-9 rounded-full grid place-items-center text-white ${tone}`}><Icon className="size-4" /></span>
              <p className="text-sm">{label} : <b className="tabular-nums">{value}</b></p>
            </div>
          ))}
        </div>
      </div>

      <OverviewLeads pick={pick} scope={scope} onClose={() => setPick(null)} />
    </section>
  );
}

function OverviewLeads({ pick, scope, onClose }: { pick: Pick | null; scope: string; onClose: () => void }) {
  const { openLead } = useCrmUi();
  const query = pick ? new URLSearchParams({ ...pick.params }).toString() : "";
  const { data, isError } = useQuery({
    queryKey: leadsKey(query, scope),
    queryFn: () => fetchLeads(query, scope),
    enabled: !!pick,
    staleTime: 30_000,
  });
  return (
    <Dialog open={!!pick} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{pick?.title}{data ? ` · ${data.rows.length}` : ""}</DialogTitle></DialogHeader>
        {isError ? <ErrorState message="Could not load these leads — try again" /> : !data ? <LoadingBlock rows={4} /> : data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No leads.</p>
        ) : (
          <div className="divide-y divide-border/50">
            {/* The list stays open behind the lead, so the drawer's Back comes straight back to it */}
            {data.rows.map((l) => (
              <button key={l.id} type="button" onClick={() => openLead(l.id, pick?.title ?? "the list")} className="w-full text-left py-2.5 px-1 hover:bg-muted/30 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{l.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{[l.phone, l.assignedName].filter(Boolean).join(" · ")}</p>
                </div>
                <span className="badge badge-gray">{l.status}</span>
                <span className="text-xs tabular-nums w-32 text-right text-muted-foreground">{l.nextFollowupAt ? fmtDateTime(l.nextFollowupAt) : "No follow-up"}</span>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
