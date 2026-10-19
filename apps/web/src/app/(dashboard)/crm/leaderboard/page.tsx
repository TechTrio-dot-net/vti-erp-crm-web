"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { compactInr, fmtCallDuration, fmtMinutes, inr } from "@/lib/crm";
import { DataTable, DateRangeFilter, ErrorState, FilterBar, LoadingBlock, PageHeader, lastDays } from "@/components/crm/ui";

type Row = { userId: string; name: string; inRotation: boolean; callsMade: number; callsConnected: number; talkSec: number; assigned: number; contacted: number; pending: number; won: number; lost: number; wonValue: number; avgResponseMins: number; followups: number; conversionRate: number };

export default function LeaderDashboardPage() {
  const [range, setRange] = useState(lastDays(30));
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "leaderboard", range],
    queryFn: () => api<{ rows: Row[] }>(`/crm/reports/leaderboard?from=${range.from}&to=${range.to}`),
  });
  const podium = data?.rows.slice(0, 3) ?? [];
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="page space-y-5">
      <PageHeader title="Leader Dashboard" subtitle="Who is converting — ranked by deals won, then revenue" />
      <FilterBar><DateRangeFilter value={range} onChange={setRange} /></FilterBar>
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <>
          <div className="grid md:grid-cols-3 gap-4">
            {podium.map((r, i) => (
              <div key={r.userId} className="card p-5 flex items-center gap-4">
                <div className="text-4xl">{medals[i]}</div>
                <div className="min-w-0">
                  <p className="font-bold truncate">{r.name}</p>
                  <p className="text-sm text-muted-foreground">{r.won} won · {compactInr(r.wonValue)} · {r.conversionRate}% conversion</p>
                </div>
              </div>
            ))}
            {podium.length === 0 && <div className="card p-6 text-sm text-muted-foreground flex items-center gap-2 md:col-span-3"><Trophy className="size-4" />No BDMs yet.</div>}
          </div>
          <DataTable
            title="All BDMs"
            csvName="leader-dashboard"
            rows={data.rows}
            columns={[
              { key: "rank", label: "#", render: (r) => data.rows.indexOf(r) + 1, csv: (r) => data.rows.indexOf(r) + 1 },
              { key: "name", label: "BDM", render: (r) => <span className="font-semibold">{r.name}{r.inRotation && <span className="ml-2 inline-block size-2 rounded-full bg-emerald-500" title="Online" />}</span> },
              { key: "assigned", label: "Assigned", align: "right" },
              { key: "contacted", label: "Contacted", align: "right" },
              { key: "pending", label: "Not contacted", align: "right", render: (r) => <span className={r.pending ? "text-red-600 font-semibold" : ""}>{r.pending}</span> },
              { key: "followups", label: "Follow-ups", align: "right" },
              { key: "callsMade", label: "Calls", align: "right" },
              { key: "callsConnected", label: "Connected", align: "right" },
              { key: "talkSec", label: "Talk time", align: "right", render: (r) => fmtCallDuration(r.talkSec) },
              { key: "won", label: "Won", align: "right", render: (r) => <span className="text-emerald-700 font-semibold">{r.won}</span> },
              { key: "lost", label: "Lost", align: "right" },
              { key: "conversionRate", label: "Conversion", align: "right", render: (r) => `${r.conversionRate}%` },
              { key: "wonValue", label: "Revenue", align: "right", render: (r) => inr(r.wonValue) },
              { key: "avgResponseMins", label: "Avg response", align: "right", render: (r) => fmtMinutes(r.avgResponseMins) },
            ]}
          />
        </>
      )}
    </div>
  );
}
