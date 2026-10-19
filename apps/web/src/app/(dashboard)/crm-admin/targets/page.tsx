"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { addDays, fmtDay, inr, today } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { AdminOnly, DataTable, ErrorState, LoadingBlock, PageHeader } from "@/components/crm/ui";

type Row = { userId: string; name: string; leadTarget: number; revenueTarget: number; assigned: number; won: number; revenue: number; leadAchievement: number | null; revenueAchievement: number | null };

function Progress({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground text-xs">No target</span>;
  const color = pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div>
      <span className="text-xs font-semibold tabular-nums w-10 text-right">{pct}%</span>
    </div>
  );
}

export default function WeeklyTargetsPage() {
  return <AdminOnly coordination><WeeklyTargets /></AdminOnly>;
}

function WeeklyTargets() {
  const [anchor, setAnchor] = useState(today());
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "weekly-targets", anchor],
    queryFn: () => api<{ range: { from: string; to: string }; rows: Row[] }>(`/crm/reports/weekly-targets?weekStart=${anchor}`),
  });
  return (
    <div className="page space-y-5">
      <PageHeader title="Weekly Target Summary" subtitle={data ? `Week ${fmtDay(data.range.from)} – ${fmtDay(data.range.to)} · targets are set in BDM Master` : undefined}>
        <Button variant="outline" size="sm" onClick={() => setAnchor(addDays(anchor, -7))}><ChevronLeft className="size-4" />Previous week</Button>
        <Button variant="outline" size="sm" disabled={data ? data.range.to >= today() : true} onClick={() => setAnchor(addDays(anchor, 7))}>Next week<ChevronRight className="size-4" /></Button>
      </PageHeader>
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <DataTable
          csvName="weekly-targets"
          rows={data.rows}
          empty="No active BDMs"
          columns={[
            { key: "name", label: "BDM", className: "font-semibold" },
            { key: "assigned", label: "Leads assigned", align: "right" },
            { key: "won", label: "Deals won", align: "right", render: (r) => <span>{r.won} <span className="text-muted-foreground">/ {r.leadTarget || "—"}</span></span>, csv: (r) => r.won },
            { key: "leadTarget", label: "Deal target", align: "right" },
            { key: "leadAchievement", label: "Deals progress", render: (r) => <Progress pct={r.leadAchievement} /> },
            { key: "revenue", label: "Revenue", align: "right", render: (r) => inr(r.revenue) },
            { key: "revenueTarget", label: "Revenue target", align: "right", render: (r) => (r.revenueTarget ? inr(r.revenueTarget) : "—") },
            { key: "revenueAchievement", label: "Revenue progress", render: (r) => <Progress pct={r.revenueAchievement} /> },
          ]}
        />
      )}
    </div>
  );
}
