"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { OUTCOMES, downloadCsv, today } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { BdmSelect, DateRangeFilter, ErrorState, FilterBar, LoadingBlock, PageHeader, lastDays } from "@/components/crm/ui";

type Cell = { userId: string; name: string; outcome: string; count: number };

export default function FollowupPivotPage() {
  const [range, setRange] = useState(lastDays(30));
  const [bdm, setBdm] = useState("");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "followup-pivot", range, bdm],
    queryFn: () => api<{ cells: Cell[] }>(`/crm/reports/followup-pivot?from=${range.from}&to=${range.to}${bdm ? `&bdm=${bdm}` : ""}`),
  });

  const people = [...new Map((data?.cells ?? []).map((c) => [c.userId, c.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const get = (userId: string, outcome: string) => data?.cells.find((c) => c.userId === userId && c.outcome === outcome)?.count ?? 0;
  const rowTotal = (userId: string) => OUTCOMES.reduce((s, o) => s + get(userId, o.key), 0);
  const colTotal = (outcome: string) => people.reduce((s, [id]) => s + get(id, outcome), 0);

  return (
    <div className="page space-y-5">
      <PageHeader title="Followup Pivot Report" subtitle="Call outcomes per BDM">
        {people.length > 0 && (
          <Button variant="outline" onClick={() => downloadCsv(`followup-pivot-${today()}.csv`, ["BDM", ...OUTCOMES.map((o) => o.label), "Total"], people.map(([id, name]) => [name, ...OUTCOMES.map((o) => get(id, o.key)), rowTotal(id)]))}>
            Export CSV
          </Button>
        )}
      </PageHeader>
      <FilterBar><DateRangeFilter value={range} onChange={setRange} /><BdmSelect value={bdm} onChange={setBdm} /></FilterBar>
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>BDM</th>{OUTCOMES.map((o) => <th key={o.key} className="text-right whitespace-nowrap">{o.label}</th>)}<th className="text-right">Total</th><th className="text-right">Connect rate</th></tr></thead>
            <tbody>
              {people.length === 0 && <tr><td colSpan={OUTCOMES.length + 3} className="text-center text-muted-foreground py-8">No follow-ups in this period</td></tr>}
              {people.map(([id, name]) => {
                const total = rowTotal(id);
                const unreachable = get(id, "NOT_REACHABLE");
                return (
                  <tr key={id}>
                    <td className="font-semibold whitespace-nowrap">{name}</td>
                    {OUTCOMES.map((o) => <td key={o.key} className="text-right tabular-nums">{get(id, o.key) || <span className="text-muted-foreground/40">0</span>}</td>)}
                    <td className="text-right tabular-nums font-bold">{total}</td>
                    <td className="text-right tabular-nums">{total ? Math.round(((total - unreachable) / total) * 100) : 0}%</td>
                  </tr>
                );
              })}
            </tbody>
            {people.length > 0 && (
              <tfoot><tr className="font-bold border-t">
                <td>Total</td>
                {OUTCOMES.map((o) => <td key={o.key} className="text-right tabular-nums">{colTotal(o.key)}</td>)}
                <td className="text-right tabular-nums">{OUTCOMES.reduce((s, o) => s + colTotal(o.key), 0)}</td>
                <td />
              </tr></tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
