"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, IndianRupee, PhoneCall, Target, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { compactInr, fmtDateTime, fmtMinutes, isBdm, stageMeta, STAGES, timeAgo } from "@/lib/crm";
import { useAuthStore } from "@/store/auth";
import { useCrmUi } from "@/store/crm";
import { Button } from "@/components/ui/button";
import { StatusOverview } from "@/components/crm/StatusOverview";
import { BdmSelect, DateRangeFilter, ErrorState, LoadingBlock, PageHeader, StatCard, lastDays, useBdms } from "@/components/crm/ui";

type Dashboard = {
  today: { assignedToday: number; pending: number; dueToday: number; overdue: number; open: number; wonToday: number };
  period: { assigned: number; contacted: number; won: number; lost: number; wonValue: number; avgResponseMins: number; followupsToday: number; conversionRate: number };
  due: Array<{ id: string; name: string; phone: string | null; stage: string; nextFollowupAt: string; assignedName: string | null }>;
  fresh: Array<{ id: string; name: string; phone: string | null; campaign: string | null; source: string | null; assignedAt: string | null; assignedName: string | null }>;
  bySource: Array<{ source: string; count: number }>;
  byStage: Array<{ stage: string; count: number }>;
};

export default function CrmDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { openLead, openInquiry } = useCrmUi();
  const [range, setRange] = useState(lastDays(30));
  const [bdm, setBdm] = useState("");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "dashboard", range, bdm],
    queryFn: () => api<Dashboard>(`/crm/reports/dashboard?from=${range.from}&to=${range.to}${bdm ? `&bdm=${bdm}` : ""}`),
    refetchInterval: 60_000,
  });
  const { data: bdms } = useBdms();
  const me = bdms?.find((b) => b.id === user?.id);
  const hour = new Date().getHours();

  return (
    <div className="page space-y-5">
      <PageHeader
        title={isBdm(user?.role) ? `Good ${hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}, ${user?.name?.split(" ")[0]}` : "CRM Dashboard"}
        subtitle={isBdm(user?.role) ? (me?.inRotation ? "You're online — new leads come to you automatically" : "You're offline — press Start in the top bar to receive leads") : "Live view of leads, follow-ups and conversions"}
      >
        <BdmSelect value={bdm} onChange={setBdm} />
        <Button onClick={openInquiry}><UserPlus className="size-4" />Add Inquiry</Button>
      </PageHeader>

      <StatusOverview bdm={bdm} />

      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock rows={8} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger">
            <Link href="/crm/leads?status=pending"><StatCard label="Not contacted yet" value={data.today.pending} sub={`${data.today.assignedToday} new today`} tone="red" icon={PhoneCall} /></Link>
            <Link href="/crm/leads?status=today"><StatCard label="Follow-ups due today" value={data.today.dueToday} sub={`${data.period.followupsToday} calls logged today`} tone="blue" icon={CalendarClock} /></Link>
            <Link href="/crm/leads?status=overdue"><StatCard label="Overdue follow-ups" value={data.today.overdue} sub={`${data.today.open} open leads in total`} tone="amber" icon={AlertTriangle} /></Link>
            <StatCard label="Won today" value={data.today.wonToday} sub={`${data.period.won} won in period`} tone="green" icon={CheckCircle2} />
          </div>

          <div className="card p-4 flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold mr-2">Period performance</p>
            <DateRangeFilter value={range} onChange={setRange} />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Leads assigned" value={data.period.assigned} sub={`${data.period.contacted} contacted`} tone="sky" icon={Target} />
            <StatCard label="Conversion" value={`${data.period.conversionRate}%`} sub={`${data.period.won} won · ${data.period.lost} lost`} tone="purple" icon={CheckCircle2} />
            <StatCard label="Revenue won" value={compactInr(data.period.wonValue)} tone="green" icon={IndianRupee} />
            <StatCard label="Avg first response" value={fmtMinutes(data.period.avgResponseMins)} sub="assignment → first call" tone="amber" icon={Clock} />
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <LeadList
              title="Call these first — follow-ups due"
              empty="No follow-ups due. 🎉"
              rows={data.due.map((l) => ({ id: l.id, primary: l.name, secondary: `${l.phone ?? ""}${!isBdm(user?.role) && l.assignedName ? ` · ${l.assignedName}` : ""}`, right: fmtDateTime(l.nextFollowupAt), badge: stageMeta(l.stage), late: new Date(l.nextFollowupAt) < new Date() }))}
              onOpen={openLead}
              href="/crm/leads?status=due"
            />
            <LeadList
              title="New leads — not contacted"
              empty="Every lead has been contacted."
              rows={data.fresh.map((l) => ({ id: l.id, primary: l.name, secondary: [l.phone, l.campaign ?? l.source, !isBdm(user?.role) ? l.assignedName : null].filter(Boolean).join(" · "), right: timeAgo(l.assignedAt), badge: { label: "New", badge: "badge-red" } }))}
              onOpen={openLead}
              href="/crm/leads?status=pending"
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <div className="card p-5">
              <p className="text-[15px] font-semibold mb-4">Open leads by stage</p>
              {STAGES.filter((s) => s.key !== "WON" && s.key !== "LOST").map((s) => {
                const count = data.byStage.find((b) => b.stage === s.key)?.count ?? 0;
                const pct = data.today.open ? Math.round((count / data.today.open) * 100) : 0;
                return (
                  <div key={s.key} className="mb-3 last:mb-0">
                    <div className="flex justify-between text-sm mb-1"><span className={`badge ${s.badge}`}>{s.label}</span><span className="font-semibold tabular-nums">{count}</span></div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-primary/60 rounded-full" style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
            </div>
            <div className="card p-5">
              <p className="text-[15px] font-semibold mb-4">Leads by source (period)</p>
              {data.bySource.length === 0 ? <p className="text-sm text-muted-foreground">No leads in this period.</p> : data.bySource.map((s) => {
                const max = Math.max(...data.bySource.map((x) => x.count), 1);
                return (
                  <div key={s.source} className="mb-3 last:mb-0">
                    <div className="flex justify-between text-sm mb-1"><span className="capitalize">{s.source}</span><span className="font-semibold tabular-nums">{s.count}</span></div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full" style={{ width: `${(s.count / max) * 100}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function LeadList({ title, rows, empty, onOpen, href }: {
  title: string;
  empty: string;
  href: string;
  onOpen: (id: string) => void;
  rows: Array<{ id: string; primary: string; secondary: string; right: string; badge: { label: string; badge: string }; late?: boolean }>;
}) {
  return (
    <div className="card">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
        <p className="text-[15px] font-semibold">{title}</p>
        <Link href={href} className="text-xs text-muted-foreground hover:text-foreground">View all</Link>
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground text-center py-10">{empty}</p> : (
        <div className="divide-y divide-border/50">
          {rows.map((r) => (
            <button key={r.id} type="button" onClick={() => onOpen(r.id)} className="w-full text-left px-5 py-2.5 hover:bg-muted/30 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{r.primary}</p>
                <p className="text-xs text-muted-foreground truncate">{r.secondary}</p>
              </div>
              <span className={`badge ${r.badge.badge}`}>{r.badge.label}</span>
              <span className={`text-xs tabular-nums w-28 text-right ${r.late ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>{r.right}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
