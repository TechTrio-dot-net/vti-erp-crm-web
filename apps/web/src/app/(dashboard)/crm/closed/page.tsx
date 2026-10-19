"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, IndianRupee, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { compactInr, fmtDate, inr } from "@/lib/crm";
import { useCrmUi } from "@/store/crm";
import { BdmSelect, DataTable, DateRangeFilter, ErrorState, FilterBar, LoadingBlock, PageHeader, StatCard, lastDays, selectCls } from "@/components/crm/ui";

type Row = { id: string; name: string; phone: string | null; source: string | null; campaign: string | null; service: string | null; estimatedValue: number | null; lostReason: string | null; createdAt: string; closedAt: string; assignedName: string | null; followups: number };

export default function ClosedLeadReportPage() {
  const openLead = useCrmUi((s) => s.openLead);
  const [range, setRange] = useState(lastDays(30));
  const [bdm, setBdm] = useState("");
  const [stage, setStage] = useState("WON");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "closed", range, bdm, stage],
    queryFn: () => api<{ rows: Row[] }>(`/crm/reports/closed?from=${range.from}&to=${range.to}&stage=${stage}${bdm ? `&bdm=${bdm}` : ""}`),
  });
  const value = data?.rows.reduce((s, r) => s + (r.estimatedValue ?? 0), 0) ?? 0;
  const days = (r: Row) => Math.max(0, Math.round((new Date(r.closedAt).getTime() - new Date(r.createdAt).getTime()) / 86_400_000));
  const avgDays = data?.rows.length ? Math.round(data.rows.reduce((s, r) => s + days(r), 0) / data.rows.length) : 0;

  return (
    <div className="page space-y-5">
      <PageHeader title="Closed Lead Report" subtitle="Leads closed in the period" />
      <FilterBar>
        <DateRangeFilter value={range} onChange={setRange} />
        <BdmSelect value={bdm} onChange={setBdm} />
        <select value={stage} onChange={(e) => setStage(e.target.value)} className={selectCls}>
          <option value="WON">Won</option>
          <option value="LOST">Lost</option>
        </select>
      </FilterBar>
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard label={stage === "WON" ? "Deals won" : "Leads lost"} value={data.rows.length} tone={stage === "WON" ? "green" : "red"} icon={stage === "WON" ? CheckCircle2 : XCircle} />
            <StatCard label={stage === "WON" ? "Revenue" : "Value lost"} value={compactInr(value)} tone="blue" icon={IndianRupee} />
            <StatCard label="Avg days to close" value={avgDays} tone="amber" />
          </div>
          <DataTable
            title={stage === "WON" ? "Won leads" : "Lost leads"}
            csvName={`closed-${stage.toLowerCase()}`}
            rows={data.rows}
            onRowClick={(r) => openLead(r.id)}
            columns={[
              { key: "closedAt", label: "Closed", render: (r) => fmtDate(r.closedAt) },
              { key: "name", label: "Lead", className: "font-semibold" },
              { key: "phone", label: "Mobile" },
              { key: "service", label: "Service" },
              { key: "source", label: "Source", render: (r) => [r.source, r.campaign].filter(Boolean).join(" · ") || "—" },
              { key: "assignedName", label: "BDM" },
              ...(stage === "LOST" ? [{ key: "lostReason", label: "Reason" }] : []),
              { key: "followups", label: "Follow-ups", align: "right" as const },
              { key: "days", label: "Days", align: "right" as const, render: (r: Row) => days(r), csv: (r: Row) => days(r) },
              { key: "estimatedValue", label: "Value", align: "right" as const, render: (r: Row) => inr(r.estimatedValue) },
            ]}
          />
        </>
      )}
    </div>
  );
}
