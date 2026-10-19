"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDay, fmtMinutes } from "@/lib/crm";
import { BdmSelect, DataTable, DateRangeFilter, ErrorState, FilterBar, LoadingBlock, PageHeader, lastDays } from "@/components/crm/ui";

type Row = { userId: string; name: string; date: string; minutes: number; sessions: number; firstStart: string; lastStop: string | null; open: boolean; followups: number; avgResponseMins: number | null };

const time = (d?: string | null) => (d ? new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "—");

export default function BdmTimeAnalysisPage() {
  const [range, setRange] = useState(lastDays(7));
  const [bdm, setBdm] = useState("");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "bdm-time", range, bdm],
    queryFn: () => api<{ rows: Row[] }>(`/crm/reports/bdm-time?from=${range.from}&to=${range.to}${bdm ? `&bdm=${bdm}` : ""}`),
  });

  const totals = new Map<string, { name: string; minutes: number; followups: number; days: number }>();
  data?.rows.forEach((r) => {
    const t = totals.get(r.userId) ?? { name: r.name, minutes: 0, followups: 0, days: 0 };
    t.minutes += r.minutes; t.followups += r.followups; t.days += 1;
    totals.set(r.userId, t);
  });

  return (
    <div className="page space-y-5">
      <PageHeader title="BDM Time Analysis" subtitle="Online time from Start/Stop, calls logged and speed of first response" />
      <FilterBar><DateRangeFilter value={range} onChange={setRange} /><BdmSelect value={bdm} onChange={setBdm} /></FilterBar>
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...totals.entries()].map(([id, t]) => (
              <div key={id} className="card p-4">
                <p className="font-semibold">{t.name}</p>
                <p className="text-2xl font-bold tabular-nums mt-1">{fmtMinutes(t.minutes)}</p>
                <p className="text-xs text-muted-foreground">{t.days} day{t.days !== 1 ? "s" : ""} · {t.followups} calls · {t.minutes ? (t.followups / (t.minutes / 60)).toFixed(1) : 0} calls/hour</p>
              </div>
            ))}
          </div>
          <DataTable
            title="Daily log"
            csvName="bdm-time-analysis"
            rows={data.rows}
            empty="No Start/Stop sessions in this period"
            columns={[
              { key: "date", label: "Date", render: (r) => fmtDay(r.date) },
              { key: "name", label: "BDM", className: "font-semibold" },
              { key: "firstStart", label: "First start", render: (r) => time(r.firstStart) },
              { key: "lastStop", label: "Last stop", render: (r) => (r.open ? <span className="badge badge-green">Online now</span> : time(r.lastStop)) },
              { key: "sessions", label: "Sessions", align: "right" },
              { key: "minutes", label: "Online time", align: "right", render: (r) => fmtMinutes(r.minutes) },
              { key: "followups", label: "Calls logged", align: "right" },
              { key: "avgResponseMins", label: "Avg first response", align: "right", render: (r) => fmtMinutes(r.avgResponseMins) },
            ]}
          />
        </>
      )}
    </div>
  );
}
