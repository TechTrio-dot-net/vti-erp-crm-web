"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { OUTCOMES, fmtCallDuration, fmtDateTime, outcomeMeta, stageMeta } from "@/lib/crm";
import { useCrmUi } from "@/store/crm";
import { CallLink } from "@/components/crm/ClickToCall";
import { BdmSelect, DataTable, DateRangeFilter, ErrorState, FilterBar, LoadingBlock, PageHeader, lastDays, selectCls } from "@/components/crm/ui";

type Row = {
  id: string; outcome: string; note: string | null; callActivity: string | null; statusLabel: string | null; callDurationSec: number | null; reason: string | null;
  sampleShared: boolean | null; source: string; nextFollowupAt: string | null; createdAt: string; userName: string | null; leadId: string; leadName: string; phone: string | null; stage: string; campaign: string | null };

export default function FollowupReportPage() {
  const openLead = useCrmUi((s) => s.openLead);
  const [range, setRange] = useState(lastDays(7));
  const [bdm, setBdm] = useState("");
  const [outcome, setOutcome] = useState("");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "followups", range, bdm, outcome],
    queryFn: () => api<{ rows: Row[] }>(`/crm/reports/followups?from=${range.from}&to=${range.to}${bdm ? `&bdm=${bdm}` : ""}${outcome ? `&outcome=${outcome}` : ""}`),
  });

  return (
    <div className="page space-y-5">
      <PageHeader title="Followup Report" subtitle="Every call and follow-up logged by the team" />
      <FilterBar>
        <DateRangeFilter value={range} onChange={setRange} />
        <BdmSelect value={bdm} onChange={setBdm} />
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={selectCls}>
          <option value="">All outcomes</option>
          {OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </FilterBar>
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <DataTable
          title="Follow-ups"
          csvName="followup-report"
          rows={data.rows}
          onRowClick={(r) => openLead(r.leadId)}
          columns={[
            { key: "createdAt", label: "When", render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</span> },
            { key: "userName", label: "BDM" },
            { key: "leadName", label: "Lead", className: "font-semibold" },
            { key: "phone", label: "Mobile", render: (r) => <CallLink leadId={r.leadId} phone={r.phone} /> },
            { key: "callActivity", label: "Call activity", render: (r) => <span className={`badge ${outcomeMeta(r.outcome).badge}`}>{r.callActivity ?? outcomeMeta(r.outcome).label}</span>, csv: (r) => r.callActivity ?? outcomeMeta(r.outcome).label },
            { key: "statusLabel", label: "Status", render: (r) => <span className="whitespace-nowrap">{r.statusLabel ?? outcomeMeta(r.outcome).label}{r.sampleShared ? " · sample shared" : ""}</span>, csv: (r) => r.statusLabel ?? outcomeMeta(r.outcome).label },
            { key: "note", label: "Remarks", className: "min-w-[18rem] max-w-md", render: (r) => <span className="line-clamp-3 whitespace-pre-wrap" title={r.note ?? ""}>{r.note ?? "—"}</span> },
            { key: "callDurationSec", label: "Call time", render: (r) => <span className="whitespace-nowrap text-muted-foreground">{r.callDurationSec ? fmtCallDuration(r.callDurationSec) : "—"}</span>, csv: (r) => (r.callDurationSec ? fmtCallDuration(r.callDurationSec) : "") },
            { key: "reason", label: "Reason", render: (r) => <span className="text-muted-foreground">{r.reason ?? "—"}</span> },
            { key: "nextFollowupAt", label: "Next", render: (r) => <span className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.nextFollowupAt)}</span> },
            { key: "stage", label: "Stage now", render: (r) => <span className={`badge ${stageMeta(r.stage).badge}`}>{stageMeta(r.stage).label}</span>, csv: (r) => stageMeta(r.stage).label },
          ]}
        />
      )}
    </div>
  );
}
