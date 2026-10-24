"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { compactInr, fmtCallDuration, fmtDateTime, fmtMinutes, inr } from "@/lib/crm";
import { useAuthStore } from "@/store/auth";
import { useCrmUi } from "@/store/crm";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, DateRangeFilter, ErrorState, FilterBar, LoadingBlock, PageHeader, lastDays } from "@/components/crm/ui";

type Row = { userId: string; name: string; inRotation: boolean; callsMade: number; callsConnected: number; talkSec: number; assigned: number; contacted: number; pending: number; won: number; lost: number; wonValue: number; avgResponseMins: number; followups: number; conversionRate: number };
type WonClient = {
  id: string; name: string; companyName: string | null; phone: string | null; email: string | null; city: string | null;
  source: string | null; campaign: string | null; service: string | null; estimatedValue: number | null;
  assignedAt: string; closedAt: string | null; lastNote: string | null;
};
/** Whose closed clients the modal is showing */
type Pick = { userId: string; name: string };

export default function LeaderDashboardPage() {
  const me = useAuthStore((s) => s.user);
  const [range, setRange] = useState(lastDays(30));
  const [pick, setPick] = useState<Pick | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "leaderboard", range],
    queryFn: () => api<{ rows: Row[] }>(`/crm/reports/leaderboard?from=${range.from}&to=${range.to}`),
  });
  const podium = data?.rows.slice(0, 3) ?? [];
  const medals = ["🥇", "🥈", "🥉"];
  /** A BDM is only ever answered with their own closed clients, so only their own name opens the list */
  const canOpen = (r: Row) => me?.role !== "SALES" || r.userId === me.id;
  const open = (r: Row) => canOpen(r) && setPick({ userId: r.userId, name: r.name });

  return (
    <div className="page space-y-5">
      <PageHeader title="Leader Dashboard" subtitle="Who is bringing in the business — ranked by revenue closed, then deals won. Click a name for the clients they closed." />
      <FilterBar><DateRangeFilter value={range} onChange={setRange} /></FilterBar>
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <>
          <div className="grid md:grid-cols-3 gap-4">
            {podium.map((r, i) => (
              <button
                key={r.userId}
                type="button"
                disabled={!canOpen(r)}
                onClick={() => open(r)}
                className={`card p-5 flex items-center gap-4 text-left ${canOpen(r) ? "hover:bg-muted/30 transition-colors" : "cursor-default"}`}
              >
                <div className="text-4xl">{medals[i]}</div>
                <div className="min-w-0">
                  <p className="font-bold truncate">{r.name}</p>
                  {/* Revenue leads the line because the medals are given on it */}
                  <p className="text-sm text-muted-foreground">{compactInr(r.wonValue)} · {r.won} won · {r.conversionRate}% conversion</p>
                </div>
              </button>
            ))}
            {podium.length === 0 && <div className="card p-6 text-sm text-muted-foreground flex items-center gap-2 md:col-span-3"><Trophy className="size-4" />No BDMs yet.</div>}
          </div>
          <DataTable
            title="All BDMs"
            csvName="leader-dashboard"
            rows={data.rows}
            columns={[
              { key: "rank", label: "#", render: (r) => data.rows.indexOf(r) + 1, csv: (r) => data.rows.indexOf(r) + 1 },
              {
                key: "name", label: "BDM",
                render: (r) => {
                  const dot = r.inRotation && <span className="ml-2 inline-block size-2 rounded-full bg-emerald-500" title="Online" />;
                  return canOpen(r) ? (
                    <button type="button" onClick={() => open(r)} className="font-semibold text-primary-text hover:underline text-left">
                      {r.name}{dot}
                    </button>
                  ) : (
                    <span className="font-semibold">{r.name}{dot}</span>
                  );
                },
                csv: (r) => r.name,
              },
              { key: "assigned", label: "Assigned", align: "right" },
              { key: "contacted", label: "Contacted", align: "right" },
              { key: "pending", label: "Not contacted", align: "right", render: (r) => <span className={r.pending ? "text-red-600 font-semibold" : ""}>{r.pending}</span> },
              { key: "followups", label: "Follow-ups", align: "right" },
              { key: "callsMade", label: "Calls", align: "right" },
              { key: "callsConnected", label: "Connected", align: "right" },
              { key: "talkSec", label: "Talk time", align: "right", render: (r) => fmtCallDuration(r.talkSec) },
              {
                key: "won", label: "Won", align: "right",
                render: (r) => canOpen(r) ? (
                  <button type="button" onClick={() => open(r)} className="text-emerald-700 font-semibold hover:underline tabular-nums">{r.won}</button>
                ) : (
                  <span className="text-emerald-700 font-semibold tabular-nums">{r.won}</span>
                ),
                csv: (r) => r.won,
              },
              { key: "lost", label: "Lost", align: "right" },
              { key: "conversionRate", label: "Conversion", align: "right", render: (r) => `${r.conversionRate}%` },
              { key: "wonValue", label: "Revenue", align: "right", render: (r) => inr(r.wonValue) },
              { key: "avgResponseMins", label: "Avg response", align: "right", render: (r) => fmtMinutes(r.avgResponseMins) },
            ]}
          />
        </>
      )}
      <WonClients pick={pick} range={range} onClose={() => setPick(null)} />
    </div>
  );
}

/** The clients one BDM closed in the period — opened from their name or their Won number */
function WonClients({ pick, range, onClose }: { pick: Pick | null; range: { from: string; to: string }; onClose: () => void }) {
  const { openLead } = useCrmUi();
  const { data, isError } = useQuery({
    queryKey: ["crm", "leaderboard", "won", pick?.userId, range],
    queryFn: () => api<{ user: { id: string; name: string }; total: number; rows: WonClient[] }>(`/crm/reports/leaderboard/won?user=${pick!.userId}&from=${range.from}&to=${range.to}`),
    enabled: !!pick,
    staleTime: 30_000,
  });
  return (
    <Dialog open={!!pick} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(56rem,calc(100vw-2rem))] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {/* Whose list the server actually answered with — never the name that was clicked */}
            {data?.user?.name ?? pick?.name} — clients closed
            {data && <span className="ml-2 text-sm font-normal text-muted-foreground">{data.rows.length} · {inr(data.total)}</span>}
          </DialogTitle>
        </DialogHeader>
        {isError ? <ErrorState message="Could not load these clients — try again" /> : !data ? <LoadingBlock rows={4} /> : data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No clients closed in this period.</p>
        ) : (
          <div className="divide-y divide-border/50">
            {/* The list stays open behind the lead, so the drawer's Back comes straight back to it */}
            {data.rows.map((c) => (
              <button key={c.id} type="button" onClick={() => openLead(c.id, `${data.user?.name ?? pick!.name}'s closed clients`)} className="w-full text-left py-2.5 px-1 hover:bg-muted/30 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{[c.phone, c.service, c.city, c.campaign ?? c.source].filter(Boolean).join(" · ") || "—"}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums whitespace-nowrap">{c.estimatedValue ? inr(c.estimatedValue) : "—"}</span>
                <span className="text-xs tabular-nums w-32 text-right text-muted-foreground">{c.closedAt ? fmtDateTime(c.closedAt) : "—"}</span>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
