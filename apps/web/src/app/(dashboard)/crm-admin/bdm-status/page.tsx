"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { STAGES, downloadCsv, inr, today } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { AdminOnly, DateRangeFilter, ErrorState, FilterBar, LoadingBlock, PageHeader, lastDays, selectCls } from "@/components/crm/ui";

type Cell = { userId: string | null; name: string; stage: string; count: number; pending: number; value: number };

export default function BdmStatusPage() {
  return <AdminOnly><BdmStatus /></AdminOnly>;
}

function BdmStatus() {
  const [range, setRange] = useState(lastDays(30));
  const [dateField, setDateField] = useState("created");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "bdm-status", range, dateField],
    queryFn: () => api<{ cells: Cell[] }>(`/crm/reports/bdm-status?from=${range.from}&to=${range.to}&dateField=${dateField}`),
  });
  const people = [...new Map((data?.cells ?? []).map((c) => [c.userId ?? "none", c.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const cellsFor = (id: string) => (data?.cells ?? []).filter((c) => (c.userId ?? "none") === id);
  const get = (id: string, stage: string) => cellsFor(id).find((c) => c.stage === stage)?.count ?? 0;
  const total = (id: string) => cellsFor(id).reduce((s, c) => s + c.count, 0);
  const pending = (id: string) => cellsFor(id).reduce((s, c) => s + c.pending, 0);
  const wonValue = (id: string) => cellsFor(id).find((c) => c.stage === "WON")?.value ?? 0;

  return (
    <div className="page space-y-5">
      <PageHeader title="BDM & Status Data" subtitle="Where every BDM's leads stand right now">
        {people.length > 0 && <Button variant="outline" onClick={() => downloadCsv(`bdm-status-${today()}.csv`, ["BDM", ...STAGES.map((s) => s.label), "Not contacted", "Total", "Won value"], people.map(([id, name]) => [name, ...STAGES.map((s) => get(id, s.key)), pending(id), total(id), wonValue(id)]))}>Export CSV</Button>}
      </PageHeader>
      <FilterBar>
        <select value={dateField} onChange={(e) => setDateField(e.target.value)} className={selectCls}>
          <option value="created">Leads received</option>
          <option value="assigned">Leads assigned</option>
        </select>
        <DateRangeFilter value={range} onChange={setRange} />
      </FilterBar>
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>BDM</th>{STAGES.map((s) => <th key={s.key} className="text-right"><span className={`badge ${s.badge}`}>{s.label}</span></th>)}<th className="text-right">Not contacted</th><th className="text-right">Total</th><th className="text-right">Won value</th></tr></thead>
            <tbody>
              {people.length === 0 && <tr><td colSpan={STAGES.length + 4} className="text-center text-muted-foreground py-8">No leads in this period</td></tr>}
              {people.map(([id, name]) => (
                <tr key={id}>
                  <td className="font-semibold whitespace-nowrap">{name}</td>
                  {STAGES.map((s) => <td key={s.key} className="text-right tabular-nums">{get(id, s.key) || <span className="text-muted-foreground/40">0</span>}</td>)}
                  <td className="text-right tabular-nums text-red-600 font-semibold">{pending(id) || ""}</td>
                  <td className="text-right tabular-nums font-bold">{total(id)}</td>
                  <td className="text-right tabular-nums">{inr(wonValue(id))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
