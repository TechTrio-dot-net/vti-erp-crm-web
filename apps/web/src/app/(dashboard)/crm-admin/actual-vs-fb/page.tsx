"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDay } from "@/lib/crm";
import { AdminOnly, DataTable, DateRangeFilter, ErrorState, FilterBar, LoadingBlock, PageHeader, StatCard, lastDays } from "@/components/crm/ui";

type Row = { date: string; campaign: string; source: string; type: string; fbLeads: number; actualLeads: number; duplicates: number; errors: number };

export default function ActualVsFbPage() {
  return <AdminOnly><ActualVsFb /></AdminOnly>;
}

function ActualVsFb() {
  const [range, setRange] = useState(lastDays(7));
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "actual-vs-fb", range],
    queryFn: () => api<{ rows: Row[]; manualByDate: Array<{ date: string; count: number }> }>(`/crm/reports/actual-vs-fb?from=${range.from}&to=${range.to}`),
  });
  const sum = (k: keyof Row) => (data?.rows ?? []).reduce((s, r) => s + (r[k] as number), 0);
  const manual = (data?.manualByDate ?? []).reduce((s, r) => s + r.count, 0);

  return (
    <div className="page space-y-5">
      <PageHeader title="Actual Leads Vs FB Leads" subtitle="Leads Meta / Google Sheet sent us vs leads that entered the CRM" />
      <FilterBar><DateRangeFilter value={range} onChange={setRange} /></FilterBar>
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard label="FB / sheet leads" value={sum("fbLeads")} tone="blue" />
            <StatCard label="New CRM leads" value={sum("actualLeads")} tone="green" />
            <StatCard label="Repeat enquiries" value={sum("duplicates")} sub="same mobile already open" tone="amber" />
            <StatCard label="Failed rows" value={sum("errors")} sub="fix in Verify Data" tone="red" />
            <StatCard label="Manual inquiries" value={manual} tone="purple" />
          </div>
          <DataTable
            title="By day and campaign"
            csvName="actual-vs-fb"
            rows={data.rows}
            empty="Nothing received from Meta or Google Sheets in this period"
            columns={[
              { key: "date", label: "Date", render: (r) => fmtDay(r.date) },
              { key: "campaign", label: "Campaign", className: "font-semibold" },
              { key: "source", label: "Source", render: (r) => <>{r.source} <span className="badge badge-gray ml-1">{r.type === "meta" ? "Meta" : "Sheet"}</span></> },
              { key: "fbLeads", label: "FB leads", align: "right" },
              { key: "actualLeads", label: "Actual leads", align: "right", render: (r) => <span className="text-emerald-700 font-semibold">{r.actualLeads}</span> },
              { key: "duplicates", label: "Repeat", align: "right" },
              { key: "errors", label: "Failed", align: "right", render: (r) => <span className={r.errors ? "text-red-600 font-semibold" : ""}>{r.errors}</span> },
              { key: "match", label: "Match", align: "right", render: (r) => `${r.fbLeads ? Math.round(((r.actualLeads + r.duplicates) / r.fbLeads) * 100) : 100}%`, csv: (r) => (r.fbLeads ? Math.round(((r.actualLeads + r.duplicates) / r.fbLeads) * 100) : 100) },
            ]}
          />
        </>
      )}
    </div>
  );
}
