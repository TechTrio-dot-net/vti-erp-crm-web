"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { addDays, downloadCsv, fmtDay, today } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { AdminOnly, ErrorState, LoadingBlock, PageHeader, selectCls } from "@/components/crm/ui";

type Cell = { key: string; date: string; total: number; won: number };

export default function SourceWeeklySummaryPage() {
  return <AdminOnly><SourceSummary /></AdminOnly>;
}

function SourceSummary() {
  const [to, setTo] = useState(today());
  const [by, setBy] = useState("source");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "source-summary", to, by],
    queryFn: () => api<{ range: { from: string; to: string }; dates: string[]; cells: Cell[] }>(`/crm/reports/source-summary?to=${to}&by=${by}`),
  });
  const keys = [...new Set((data?.cells ?? []).map((c) => c.key))].sort();
  const get = (k: string, d: string) => data?.cells.find((c) => c.key === k && c.date === d);
  const rowTotal = (k: string) => (data?.cells ?? []).filter((c) => c.key === k).reduce((s, c) => s + c.total, 0);
  const rowWon = (k: string) => (data?.cells ?? []).filter((c) => c.key === k).reduce((s, c) => s + c.won, 0);

  return (
    <div className="page space-y-5">
      <PageHeader title="Source Weekly Summary" subtitle={data ? `Leads received ${data.range.from} to ${data.range.to}` : undefined}>
        {data && keys.length > 0 && <Button variant="outline" onClick={() => downloadCsv(`source-summary-${to}.csv`, [by, ...data.dates, "Total", "Won"], keys.map((k) => [k, ...data.dates.map((d) => get(k, d)?.total ?? 0), rowTotal(k), rowWon(k)]))}>Export CSV</Button>}
      </PageHeader>
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" className="h-9" onClick={() => setTo(addDays(to, -7))}><ChevronLeft className="size-4" />Previous</Button>
        <Button variant="outline" size="sm" className="h-9" disabled={to >= today()} onClick={() => setTo(addDays(to, 7) > today() ? today() : addDays(to, 7))}>Next<ChevronRight className="size-4" /></Button>
        <select value={by} onChange={(e) => setBy(e.target.value)} className={selectCls}>
          <option value="source">By source</option>
          <option value="campaign">By campaign</option>
        </select>
      </div>
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead><tr><th className="capitalize">{by}</th>{data.dates.map((d) => <th key={d} className="text-right whitespace-nowrap">{fmtDay(d)}</th>)}<th className="text-right">Total</th><th className="text-right">Won</th><th className="text-right">Conv.</th></tr></thead>
            <tbody>
              {keys.length === 0 && <tr><td colSpan={data.dates.length + 4} className="text-center text-muted-foreground py-8">No leads this week</td></tr>}
              {keys.map((k) => (
                <tr key={k}>
                  <td className="font-semibold capitalize">{k}</td>
                  {data.dates.map((d) => <td key={d} className="text-right tabular-nums">{get(k, d)?.total || <span className="text-muted-foreground/40">·</span>}</td>)}
                  <td className="text-right tabular-nums font-bold">{rowTotal(k)}</td>
                  <td className="text-right tabular-nums text-emerald-700">{rowWon(k)}</td>
                  <td className="text-right tabular-nums">{rowTotal(k) ? Math.round((rowWon(k) / rowTotal(k)) * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
            {keys.length > 0 && (
              <tfoot><tr className="font-bold border-t">
                <td>Total</td>
                {data.dates.map((d) => <td key={d} className="text-right tabular-nums">{data.cells.filter((c) => c.date === d).reduce((s, c) => s + c.total, 0)}</td>)}
                <td className="text-right tabular-nums">{data.cells.reduce((s, c) => s + c.total, 0)}</td>
                <td className="text-right tabular-nums">{data.cells.reduce((s, c) => s + c.won, 0)}</td>
                <td />
              </tr></tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
