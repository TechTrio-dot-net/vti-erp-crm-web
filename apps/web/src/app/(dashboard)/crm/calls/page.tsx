"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { fmtCallDuration, fmtDateTime, fmtDay, isBdm, qs, stageMeta } from "@/lib/crm";
import { useAuthStore } from "@/store/auth";
import { useCrmUi } from "@/store/crm";
import { Button } from "@/components/ui/button";
import { RecordingButton } from "@/components/crm/CallRecording";
import { BdmSelect, DataTable, DateRangeFilter, ErrorState, FilterBar, LoadingBlock, PageHeader, StatCard, lastDays, selectCls } from "@/components/crm/ui";

type Call = {
  id: string; source: string; direction: string; status: string | null; phone: string; contactName: string | null; startedAt: string;
  durationSec: number; recordingUrl: string | null; recordingStatus: string | null; userId: string | null; userName: string | null; leadId: string | null; leadName: string | null; leadStage: string | null;
};
type DayRow = {
  userId: string; name: string; date: string; total: number; outgoing: number; incoming: number; missed: number; connected: number;
  notAnswered: number; talkSec: number; leadsCalled: number; unmatched: number; firstCall: string; lastCall: string;
};

const DIRECTION_ICON: Record<string, typeof PhoneCall> = { outgoing: PhoneOutgoing, incoming: PhoneIncoming, missed: PhoneMissed, rejected: PhoneMissed };
const time = (d?: string | null) => (d ? new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "—");

export default function CallLogPage() {
  const role = useAuthStore((s) => s.user?.role);
  const queryClient = useQueryClient();
  const openLead = useCrmUi((s) => s.openLead);
  const [range, setRange] = useState(lastDays(1));
  const [bdm, setBdm] = useState("");
  const [direction, setDirection] = useState("");
  const [matched, setMatched] = useState("");
  const [recording, setRecording] = useState("");
  const [page, setPage] = useState(1);
  const limit = 100;

  const report = useQuery({
    queryKey: ["crm", "calls-report", range, bdm],
    queryFn: () => api<{ rows: DayRow[]; hourly: Array<{ hour: number; calls: number; connected: number }> }>(`/crm/reports/calls${qs({ ...range, bdm })}`),
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
  const sum = (k: keyof DayRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const maxHour = Math.max(1, ...(report.data?.hourly.map((h) => h.calls) ?? []));
  const pages = log.data ? Math.max(1, Math.ceil(log.data.total / limit)) : 1;

  return (
    <div className="page space-y-5">
      <PageHeader title="Call Log" subtitle="Calls synced from salespeople's phones and the company calling line" />
      <FilterBar>
        <DateRangeFilter value={range} onChange={(r) => { setRange(r); setPage(1); }} />
        <BdmSelect value={bdm} onChange={(v) => { setBdm(v); setPage(1); }} />
      </FilterBar>

      {report.isError ? <ErrorState /> : report.isLoading ? <LoadingBlock rows={3} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard label="Calls made" value={sum("outgoing")} sub={`${sum("notAnswered")} not answered`} tone="blue" icon={PhoneOutgoing} />
            <StatCard label="Connected" value={sum("connected")} sub={sum("outgoing") ? `${Math.round((sum("connected") / Math.max(1, sum("outgoing") + sum("incoming"))) * 100)}% connect rate` : undefined} tone="green" icon={PhoneCall} />
            <StatCard label="Talk time" value={fmtCallDuration(sum("talkSec"))} sub={sum("connected") ? `avg ${fmtCallDuration(Math.round(sum("talkSec") / sum("connected")))} per call` : undefined} tone="purple" icon={Clock} />
            <StatCard label="Incoming" value={sum("incoming")} sub={`${sum("missed")} missed`} tone="amber" icon={PhoneIncoming} />
            <StatCard label="Unknown numbers" value={sum("unmatched")} sub="not a lead yet" tone="red" icon={UserPlus} />
          </div>

          {!isBdm(role) && rows.length > 0 && (
            <DataTable
              title="Per salesperson"
              csvName="calls-per-bdm"
              rows={rows}
              columns={[
                { key: "date", label: "Date", render: (r) => fmtDay(r.date) },
                { key: "name", label: "BDM", className: "font-semibold" },
                { key: "outgoing", label: "Made", align: "right" },
                { key: "connected", label: "Connected", align: "right", render: (r) => <span className="text-emerald-700 font-semibold">{r.connected}</span> },
                { key: "notAnswered", label: "Not answered", align: "right" },
                { key: "incoming", label: "Incoming", align: "right" },
                { key: "missed", label: "Missed", align: "right", render: (r) => <span className={r.missed ? "text-red-600" : ""}>{r.missed}</span> },
                { key: "talkSec", label: "Talk time", align: "right", render: (r) => fmtCallDuration(r.talkSec) },
                { key: "leadsCalled", label: "Leads called", align: "right" },
                { key: "firstCall", label: "First call", render: (r) => time(r.firstCall) },
                { key: "lastCall", label: "Last call", render: (r) => time(r.lastCall) },
              ]}
            />
          )}

          {(report.data?.hourly.length ?? 0) > 0 && (
            <div className="card p-5">
              <p className="font-semibold mb-3">Calls by hour</p>
              <div className="flex items-end gap-1 h-28">
                {Array.from({ length: 24 }, (_, h) => report.data!.hourly.find((x) => x.hour === h)).map((x, h) => (
                  <div key={h} className="flex-1 flex flex-col items-center gap-1" title={`${h}:00 — ${x?.calls ?? 0} calls, ${x?.connected ?? 0} connected`}>
                    <div className="w-full flex flex-col justify-end h-24 bg-muted/40 rounded-sm overflow-hidden">
                      <div className="w-full bg-primary" style={{ height: `${((x?.calls ?? 0) / maxHour) * 100}%` }} />
                    </div>
                    <span className="text-[9px] text-muted-foreground">{h % 3 === 0 ? h : ""}</span>
                  </div>
                ))}
              </div>
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
          <option value="">Leads & unknown numbers</option>
          <option value="yes">Only leads</option>
          <option value="no">Only unknown numbers</option>
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
    </div>
  );
}
