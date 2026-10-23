"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, Clock, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing, Snowflake, UserPlus, Users } from "lucide-react";
import { api } from "@/lib/api";
import { WORK, WORK_HOURS, callingStatus, fmtCallDuration, fmtDateTime, fmtDay, isBdm, qs, rankOf, stageMeta, workHourLabel } from "@/lib/crm";
import { useAuthStore } from "@/store/auth";
import { useCrmUi } from "@/store/crm";
import { Button } from "@/components/ui/button";
import { RecordingButton } from "@/components/crm/CallRecording";
import { BdmCallReport, type BdmCallTarget } from "@/components/crm/BdmCallReport";
import { MyCallingStatus } from "@/components/crm/MyCallingStatus";
import { BdmSelect, DataTable, DateRangeFilter, ErrorState, FilterBar, LoadingBlock, PageHeader, StatCard, lastDays, selectCls } from "@/components/crm/ui";

type Call = {
  id: string; source: string; direction: string; status: string | null; phone: string; contactName: string | null; startedAt: string;
  durationSec: number; recordingUrl: string | null; recordingStatus: string | null; userId: string | null; userName: string | null; leadId: string | null; leadName: string | null; leadStage: string | null;
};
type DayRow = {
  userId: string; name: string; date: string; total: number; outgoing: number; incoming: number; missed: number; connected: number;
  notAnswered: number; talkSec: number; leadCalls: number; coldCalls: number; leadsCalled: number; unmatched: number; firstCall: string | null; lastCall: string | null;
  idleReason: { reason: string; note: string | null; createdAt: string } | null;
};
type Report = { today: string; rows: DayRow[]; hourly: Array<{ hour: number; calls: number; connected: number }> };

const DIRECTION_ICON: Record<string, typeof PhoneCall> = { outgoing: PhoneOutgoing, incoming: PhoneIncoming, missed: PhoneMissed, rejected: PhoneMissed };
const time = (d?: string | null) => (d ? new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "—");
const RANK_BADGE = ["badge-amber", "badge-gray", "badge-sky"];

export default function CallLogPage() {
  const me = useAuthStore((s) => s.user);
  const role = me?.role;
  const queryClient = useQueryClient();
  const openLead = useCrmUi((s) => s.openLead);
  const [range, setRange] = useState(lastDays(1));
  const [bdm, setBdm] = useState("");
  const [direction, setDirection] = useState("");
  const [matched, setMatched] = useState("");
  const [recording, setRecording] = useState("");
  const [page, setPage] = useState(1);
  const [person, setPerson] = useState<BdmCallTarget | null>(null);
  const limit = 100;

  // Keeps "working / not calling" honest between refetches
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const report = useQuery({
    queryKey: ["crm", "calls-report", range, bdm],
    queryFn: () => api<Report>(`/crm/reports/calls${qs({ ...range, bdm })}`),
    refetchInterval: 60_000,
  });
  const log = useQuery({
    queryKey: ["crm", "calls", range, bdm, direction, matched, recording, page],
    queryFn: () => api<{ rows: Call[]; total: number }>(`/calls${qs({ ...range, bdm, direction, matched, recording, page, limit })}`),
    refetchInterval: 60_000,
    placeholderData: (p) => p,
  });

  const createLead = useMutation({
    mutationFn: (id: string) => api<{ leadId: string; status: string }>(`/calls/${id}/create-lead`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: (r) => {
      toast.success(r.status === "duplicate" ? "Linked to the existing open lead" : "Lead created");
      queryClient.invalidateQueries({ queryKey: ["crm"] });
      openLead(r.leadId);
    },
  });

  const rows = report.data?.rows ?? [];
  const today = report.data?.today;
  const sum = (k: keyof DayRow) => rows.reduce((s, r) => s + ((r[k] as number) ?? 0), 0);
  const maxHour = Math.max(1, ...(report.data?.hourly.map((h) => h.calls) ?? []));
  const outsideHours = (report.data?.hourly ?? []).filter((h) => !WORK_HOURS.includes(h.hour)).reduce((s, h) => s + h.calls, 0);
  const pages = log.data ? Math.max(1, Math.ceil(log.data.total / limit)) : 1;

  return (
    <div className="page space-y-5">
      <PageHeader title="Call Log" subtitle="Calls synced from salespeople's phones and the company calling line">
        {isBdm(role) && me && (
          <Button variant="outline" onClick={() => setPerson({ userId: me.id, name: me.name, date: today ?? range.to })}>
            <CalendarDays className="size-4" />See my day
          </Button>
        )}
      </PageHeader>
      <FilterBar>
        <DateRangeFilter value={range} onChange={(r) => { setRange(r); setPage(1); }} />
        <BdmSelect value={bdm} onChange={(v) => { setBdm(v); setPage(1); }} />
      </FilterBar>

      {isBdm(role) && <MyCallingStatus />}

      {report.isError ? <ErrorState /> : report.isLoading ? <LoadingBlock rows={3} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
            <StatCard label="Calls made" value={sum("outgoing")} sub={`${sum("notAnswered")} not answered`} tone="blue" icon={PhoneOutgoing} />
            <StatCard label="Connected" value={sum("connected")} sub={sum("outgoing") ? `${Math.round((sum("connected") / Math.max(1, sum("outgoing") + sum("incoming"))) * 100)}% connect rate` : undefined} tone="green" icon={PhoneCall} />
            <StatCard label="Talk time" value={fmtCallDuration(sum("talkSec"))} sub={sum("connected") ? `avg ${fmtCallDuration(Math.round(sum("talkSec") / sum("connected")))} per call` : undefined} tone="purple" icon={Clock} />
            <StatCard label="Lead calls" value={sum("leadCalls")} sub={`${sum("leadsCalled")} leads called`} tone="sky" icon={Users} />
            <StatCard label="Cold calls" value={sum("coldCalls")} sub="new numbers, not a lead yet" tone="amber" icon={Snowflake} />
            <StatCard label="Incoming" value={sum("incoming")} sub={`${sum("missed")} missed`} tone="red" icon={PhoneIncoming} />
          </div>

          {!isBdm(role) && rows.length > 0 && (
            <DataTable
              title="Per salesperson — click a row to see the full day"
              csvName="calls-per-bdm"
              rows={rows}
              onRowClick={(r) => setPerson({ userId: r.userId, name: r.name, date: r.date, rank: rankOf(r, rows), of: rows.filter((x) => x.date === r.date).length })}
              rowClassName={(r) => (r.date === today && callingStatus(r.lastCall).key === "idle" ? "row-idle" : "")}
              columns={[
                {
                  key: "rank", label: "Rank",
                  render: (r) => {
                    const rank = rankOf(r, rows);
                    return <span className={`badge ${RANK_BADGE[rank - 1] ?? "badge-gray"}`}>#{rank}</span>;
                  },
                  csv: (r) => rankOf(r, rows),
                },
                { key: "date", label: "Date", render: (r) => fmtDay(r.date) },
                { key: "name", label: "BDM", className: "font-semibold" },
                {
                  key: "live", label: "Right now",
                  render: (r) => {
                    if (r.date !== today) return <span className="text-muted-foreground">—</span>;
                    const live = callingStatus(r.lastCall);
                    // Wraps onto a second line on a narrow screen rather than holding the column open
                    return (
                      <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        <span className={`size-2 shrink-0 rounded-full ${live.dot}`} />
                        <span className={`whitespace-nowrap ${live.key === "idle" ? "text-red-600 font-semibold" : ""}`}>{live.label}</span>
                        <span className="text-xs text-muted-foreground">{live.sub}</span>
                        {live.key === "idle" && (r.idleReason
                          ? <span className="badge badge-amber" title={r.idleReason.note ?? undefined}>{r.idleReason.reason}</span>
                          : <span className="text-xs text-muted-foreground italic">no reason given</span>)}
                      </span>
                    );
                  },
                  csv: (r) => {
                    if (r.date !== today) return "";
                    const live = callingStatus(r.lastCall);
                    return live.key === "idle" ? `${live.label} (${r.idleReason?.reason ?? "no reason given"})` : live.label;
                  },
                },
                { key: "outgoing", label: "Made", align: "right" },
                { key: "connected", label: "Connected", align: "right", render: (r) => <span className="text-emerald-700 font-semibold">{r.connected}</span> },
                { key: "notAnswered", label: "Not answered", align: "right" },
                { key: "leadCalls", label: "Lead calls", align: "right" },
                { key: "coldCalls", label: "Cold calls", align: "right" },
                { key: "incoming", label: "Incoming", align: "right" },
                { key: "missed", label: "Missed", align: "right", render: (r) => <span className={r.missed ? "text-red-600" : ""}>{r.missed}</span> },
                { key: "talkSec", label: "Talk time", align: "right", render: (r) => fmtCallDuration(r.talkSec) },
                { key: "firstCall", label: "First call", render: (r) => time(r.firstCall) },
                { key: "lastCall", label: "Last call", render: (r) => time(r.lastCall) },
              ]}
            />
          )}
          {!isBdm(role) && rows.length > 0 && (
            <p className="text-xs text-muted-foreground -mt-3">
              Rank 1 is the most calls made that day. A red row means no call for {WORK.idleMinutes} minutes during office hours (10:30 am – 7:00 pm) — the 1:30 – 2 pm lunch break does not count, and the salesperson can add the reason from their own Call Log.
            </p>
          )}

          {(report.data?.hourly.length ?? 0) > 0 && (
            <div className="card p-5">
              <p className="font-semibold">Calls by hour</p>
              <p className="text-xs text-muted-foreground mb-3">Office hours, 10:30 am to 7:00 pm.</p>
              <div className="flex items-end gap-2 h-32">
                {WORK_HOURS.map((h) => {
                  const x = report.data!.hourly.find((e) => e.hour === h);
                  return (
                    <div key={h} className="flex-1 flex flex-col items-center gap-1" title={`${workHourLabel(h)} — ${x?.calls ?? 0} calls, ${x?.connected ?? 0} connected`}>
                      <span className="text-[10px] text-muted-foreground tabular-nums">{x?.calls ?? 0}</span>
                      <div className="w-full flex flex-col justify-end h-20 bg-muted/40 rounded-sm overflow-hidden">
                        <div className={`w-full ${x?.calls ? "bg-primary" : ""}`} style={{ height: `${((x?.calls ?? 0) / maxHour) * 100}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{workHourLabel(h).split(" – ")[0]}</span>
                    </div>
                  );
                })}
              </div>
              {outsideHours > 0 && <p className="text-xs text-muted-foreground mt-2">{outsideHours} call{outsideHours === 1 ? "" : "s"} outside office hours.</p>}
            </div>
          )}
        </>
      )}

      <div className="card p-3 flex flex-wrap gap-2">
        <select value={direction} onChange={(e) => { setDirection(e.target.value); setPage(1); }} className={selectCls}>
          <option value="">All calls</option>
          <option value="outgoing">Outgoing</option>
          <option value="incoming">Incoming</option>
          <option value="missed">Missed</option>
        </select>
        <select value={matched} onChange={(e) => { setMatched(e.target.value); setPage(1); }} className={selectCls}>
          <option value="">Lead calls & cold calls</option>
          <option value="yes">Only lead calls</option>
          <option value="no">Only cold calls (new numbers)</option>
        </select>
        <select value={recording} onChange={(e) => { setRecording(e.target.value); setPage(1); }} className={selectCls}>
          <option value="">With or without recording</option>
          <option value="yes">Only recorded calls</option>
        </select>
      </div>
      {log.isError ? <ErrorState /> : log.isLoading || !log.data ? <LoadingBlock /> : (
        <>
          <DataTable
            title={`${log.data.total} calls`}
            csvName="call-log"
            rows={log.data.rows}
            empty="No calls in this period. Calls appear here once the phone app syncs or the calling service is connected."
            columns={[
              { key: "startedAt", label: "When", render: (c) => <span className="whitespace-nowrap">{fmtDateTime(c.startedAt)}</span> },
              {
                key: "direction", label: "Type",
                render: (c) => {
                  const Icon = DIRECTION_ICON[c.direction] ?? PhoneCall;
                  return <span className="inline-flex items-center gap-1.5 capitalize"><Icon className={`size-3.5 ${c.durationSec > 0 ? "text-emerald-600" : c.direction === "outgoing" ? "text-muted-foreground" : "text-red-500"}`} />{c.direction}</span>;
                },
              },
              { key: "durationSec", label: "Duration", align: "right", render: (c) => (c.durationSec > 0 ? fmtCallDuration(c.durationSec) : <span className="text-muted-foreground">{c.status && !["completed"].includes(c.status) ? c.status.replace("-", " ") : c.direction === "outgoing" ? "no answer" : "—"}</span>), csv: (c) => c.durationSec },
              ...(!isBdm(role) ? [{ key: "userName", label: "BDM" }] : []),
              { key: "phone", label: "Number", render: (c) => <span className="whitespace-nowrap">{c.phone}{c.contactName && <span className="block text-xs text-muted-foreground">{c.contactName}</span>}</span> },
              {
                key: "leadName", label: "Lead",
                render: (c) => c.leadId ? (
                  <button type="button" className="text-primary-text hover:underline text-left" onClick={() => openLead(c.leadId!)}>
                    {c.leadName} {c.leadStage && <span className={`badge ${stageMeta(c.leadStage).badge} ml-1`}>{stageMeta(c.leadStage).label}</span>}
                  </button>
                ) : c.leadName ? <span className="text-muted-foreground">{c.leadName}</span> : (
                  <Button size="sm" variant="outline" className="h-7" disabled={createLead.isPending} onClick={() => createLead.mutate(c.id)}><UserPlus className="size-3.5" />Make lead</Button>
                ),
              },
              { key: "source", label: "Via", render: (c) => (c.source === "exotel" ? "Company line" : "Phone") },
              { key: "recordingStatus", label: "Recording", render: (c) => <RecordingButton callId={c.id} status={c.recordingStatus} recordingUrl={c.recordingUrl} />, csv: (c) => c.recordingStatus ?? "" },
            ]}
          />
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="text-muted-foreground">Page {page} of {pages}</span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </>
      )}

      <BdmCallReport target={person} onClose={() => setPerson(null)} />
    </div>
  );
}
