"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDateTime, fmtDay, stageMeta } from "@/lib/crm";
import { useCrmUi } from "@/store/crm";
import { CallLink } from "@/components/crm/ClickToCall";
import { BdmSelect, DataTable, DateRangeFilter, ErrorState, FilterBar, LoadingBlock, PageHeader, lastDays } from "@/components/crm/ui";

type Report = {
  dates: string[];
  rows: Array<{ userId: string; name: string; cells: Record<string, { done: number; due: number }> }>;
  dueList: Array<{ id: string; name: string; phone: string | null; stage: string; nextFollowupAt: string; assignedName: string | null; lastNote: string | null }>;
};

export default function FollowupDateWisePage() {
  const openLead = useCrmUi((s) => s.openLead);
  const [range, setRange] = useState(lastDays(7));
  const [bdm, setBdm] = useState("");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "followups-datewise", range, bdm],
    queryFn: () => api<Report>(`/crm/reports/followups-datewise?from=${range.from}&to=${range.to}${bdm ? `&bdm=${bdm}` : ""}`),
  });

  return (
    <div className="page space-y-5">
      <PageHeader title="Followup Date Wise Report" subtitle="Each cell: follow-ups done / follow-ups scheduled for that day (still open)" />
      <FilterBar><DateRangeFilter value={range} onChange={setRange} /><BdmSelect value={bdm} onChange={setBdm} /></FilterBar>
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <>
          <div className="card overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>BDM</th>{data.dates.map((d) => <th key={d} className="text-center whitespace-nowrap">{fmtDay(d)}</th>)}<th className="text-center">Total</th></tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && <tr><td colSpan={data.dates.length + 2} className="text-center text-muted-foreground py-8">No follow-up activity in this period</td></tr>}
                {data.rows.map((r) => {
                  const done = Object.values(r.cells).reduce((s, c) => s + c.done, 0);
                  const due = Object.values(r.cells).reduce((s, c) => s + c.due, 0);
                  return (
                    <tr key={r.userId}>
                      <td className="font-semibold whitespace-nowrap">{r.name}</td>
                      {data.dates.map((d) => {
                        const c = r.cells[d];
                        return (
                          <td key={d} className="text-center tabular-nums whitespace-nowrap">
                            {c ? <><span className="text-emerald-700 font-semibold">{c.done}</span><span className="text-muted-foreground"> / </span><span className="text-amber-600">{c.due}</span></> : <span className="text-muted-foreground/40">·</span>}
                          </td>
                        );
                      })}
                      <td className="text-center tabular-nums font-bold whitespace-nowrap">{done} / {due}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <DataTable
            title="Follow-ups scheduled in this period (still open)"
            csvName="followups-due"
            rows={data.dueList}
            onRowClick={(r) => openLead(r.id)}
            columns={[
              { key: "nextFollowupAt", label: "Due", render: (r) => <span className={new Date(r.nextFollowupAt) < new Date() ? "text-red-600 font-semibold" : ""}>{fmtDateTime(r.nextFollowupAt)}</span> },
              { key: "name", label: "Lead", className: "font-semibold" },
              { key: "phone", label: "Mobile", render: (r) => <CallLink leadId={r.id} phone={r.phone} /> },
              { key: "stage", label: "Stage", render: (r) => <span className={`badge ${stageMeta(r.stage).badge}`}>{stageMeta(r.stage).label}</span>, csv: (r) => stageMeta(r.stage).label },
              { key: "assignedName", label: "BDM" },
              { key: "lastNote", label: "Last note", className: "text-muted-foreground max-w-xs truncate" },
            ]}
          />
        </>
      )}
    </div>
  );
}
