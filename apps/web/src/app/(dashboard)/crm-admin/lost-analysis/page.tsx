"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { compactInr } from "@/lib/crm";
import { AdminOnly, DateRangeFilter, ErrorState, FilterBar, LoadingBlock, PageHeader, StatCard, lastDays } from "@/components/crm/ui";

type Analysis = {
  byReason: Array<{ reason: string; count: number; value: number }>;
  byBdm: Array<{ reason: string; name: string; count: number }>;
  bySource: Array<{ reason: string; source: string; count: number }>;
  totals: { lost: number; closed: number };
};

function Matrix({ title, rows, cols, get }: { title: string; rows: string[]; cols: string[]; get: (r: string, c: string) => number }) {
  return (
    <div className="card overflow-x-auto">
      <p className="px-5 py-3 border-b border-border/50 font-semibold">{title}</p>
      <table className="data-table">
        <thead><tr><th>Reason</th>{cols.map((c) => <th key={c} className="text-right whitespace-nowrap capitalize">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}><td className="font-semibold whitespace-nowrap">{r}</td>{cols.map((c) => <td key={c} className="text-right tabular-nums">{get(r, c) || <span className="text-muted-foreground/40">0</span>}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LostLeadsAnalysisPage() {
  return <AdminOnly><LostAnalysis /></AdminOnly>;
}

function LostAnalysis() {
  const [range, setRange] = useState(lastDays(30));
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "lost-analysis", range],
    queryFn: () => api<Analysis>(`/crm/reports/lost-analysis?from=${range.from}&to=${range.to}`),
  });
  const reasons = data?.byReason.map((r) => r.reason) ?? [];
  const bdms = [...new Set(data?.byBdm.map((b) => b.name))];
  const sources = [...new Set(data?.bySource.map((b) => b.source))];
  const max = Math.max(1, ...(data?.byReason.map((r) => r.count) ?? []));

  return (
    <div className="page space-y-5">
      <PageHeader title="Lost Leads Analysis" subtitle="Why deals are lost, by BDM and by source" />
      <FilterBar><DateRangeFilter value={range} onChange={setRange} /></FilterBar>
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard label="Leads lost" value={data.totals.lost} tone="red" icon={XCircle} />
            <StatCard label="Loss rate (of closed)" value={`${data.totals.closed ? Math.round((data.totals.lost / data.totals.closed) * 100) : 0}%`} tone="amber" />
            <StatCard label="Value lost" value={compactInr(data.byReason.reduce((s, r) => s + r.value, 0))} tone="purple" />
          </div>
          <div className="card p-5">
            <p className="font-semibold mb-4">Top reasons</p>
            {data.byReason.length === 0 ? <p className="text-sm text-muted-foreground">No lost leads in this period.</p> : data.byReason.map((r) => (
              <div key={r.reason} className="mb-3 last:mb-0">
                <div className="flex justify-between text-sm mb-1"><span>{r.reason}</span><span className="font-semibold tabular-nums">{r.count} · {compactInr(r.value)}</span></div>
                <div className="h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-red-400 rounded-full" style={{ width: `${(r.count / max) * 100}%` }} /></div>
              </div>
            ))}
          </div>
          {reasons.length > 0 && (
            <div className="grid xl:grid-cols-2 gap-5">
              <Matrix title="Reason × BDM" rows={reasons} cols={bdms} get={(r, c) => data.byBdm.find((b) => b.reason === r && b.name === c)?.count ?? 0} />
              <Matrix title="Reason × Source" rows={reasons} cols={sources} get={(r, c) => data.bySource.find((b) => b.reason === r && b.source === c)?.count ?? 0} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
