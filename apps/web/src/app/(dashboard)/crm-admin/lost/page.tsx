"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate, inr } from "@/lib/crm";
import { useCrmUi } from "@/store/crm";
import { AdminOnly, BdmSelect, DataTable, DateRangeFilter, ErrorState, FilterBar, LoadingBlock, PageHeader, lastDays } from "@/components/crm/ui";

type Row = { id: string; name: string; phone: string | null; source: string | null; campaign: string | null; service: string | null; lostReason: string; estimatedValue: number | null; createdAt: string; closedAt: string; assignedName: string | null; lastNote: string | null };

export default function LostLeadsReportPage() {
  return <AdminOnly coordination bdm><LostLeads /></AdminOnly>;
}

function LostLeads() {
  const openLead = useCrmUi((s) => s.openLead);
  const [range, setRange] = useState(lastDays(30));
  const [bdm, setBdm] = useState("");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "lost", range, bdm],
    queryFn: () => api<{ rows: Row[] }>(`/crm/reports/lost?from=${range.from}&to=${range.to}${bdm ? `&bdm=${bdm}` : ""}`),
  });
  return (
    <div className="page space-y-5">
      <PageHeader title="Lost Leads Report" subtitle="Leads marked lost — open one to reopen it with a new follow-up" />
      <FilterBar><DateRangeFilter value={range} onChange={setRange} /><BdmSelect value={bdm} onChange={setBdm} /></FilterBar>
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <DataTable
          title="Lost leads"
          csvName="lost-leads"
          rows={data.rows}
          onRowClick={(r) => openLead(r.id)}
          columns={[
            { key: "closedAt", label: "Lost on", render: (r) => fmtDate(r.closedAt) },
            { key: "name", label: "Lead", className: "font-semibold" },
            { key: "phone", label: "Mobile" },
            { key: "lostReason", label: "Reason", render: (r) => <span className="badge badge-red">{r.lostReason}</span>, csv: (r) => r.lostReason },
            { key: "assignedName", label: "BDM" },
            { key: "source", label: "Source", render: (r) => [r.source, r.campaign].filter(Boolean).join(" · ") || "—" },
            { key: "service", label: "Service" },
            { key: "lastNote", label: "Last note", className: "text-muted-foreground max-w-xs", render: (r) => <span className="line-clamp-2">{r.lastNote ?? "—"}</span> },
            { key: "estimatedValue", label: "Value", align: "right", render: (r) => inr(r.estimatedValue) },
          ]}
        />
      )}
    </div>
  );
}
