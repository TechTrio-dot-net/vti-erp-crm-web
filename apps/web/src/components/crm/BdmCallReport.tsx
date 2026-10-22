"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing } from "lucide-react";
import { api } from "@/lib/api";
import { WORK_HOURS, callingStatus, fmtCallDuration, fmtDay, outcomeMeta, qs, stageMeta, workHourLabel } from "@/lib/crm";
import { useCrmUi } from "@/store/crm";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RecordingButton } from "@/components/crm/CallRecording";
import { DataTable, ErrorState, LoadingBlock, selectCls } from "./ui";

export type BdmCallTarget = { userId: string; name: string; date: string; rank?: number; of?: number };

type HourRow = {
  hour: number; made: number; connected: number; notAnswered: number; incoming: number; missed: number;
  leadCalls: number; coldCalls: number; talkSec: number;
};
type DetailCall = {
  id: string; startedAt: string; direction: string; durationSec: number; status: string | null; source: string;
  phone: string; contactName: string | null; recordingUrl: string | null; recordingStatus: string | null;
  leadId: string | null; leadName: string | null; leadStage: string | null; statusLabel: string | null;
  note: string | null; kind: "lead" | "cold"; result: string | null;
};
type Reason = { reason: string; note: string | null; createdAt: string };
type Detail = { person: { userId: string; name: string }; today: string; hourly: HourRow[]; reasons: Reason[]; calls: DetailCall[] };

/** How the call went, in plain words. The keys are the after-call outcomes. */
const RESULTS = [
  { key: "INTERESTED", label: "Interested" },
  { key: "NOT_INTERESTED", label: "Not interested" },
  { key: "CALL_BACK", label: "Call back" },
  { key: "NOT_REACHABLE", label: "Not reachable" },
  { key: "CONNECTED", label: "Talked" },
  { key: "CONVERTED", label: "Won" },
  { key: "LOST", label: "Lost" },
  { key: "none", label: "Nothing written yet" },
];
const resultLabel = (key: string | null) => RESULTS.find((r) => r.key === (key ?? "none"))?.label ?? key ?? "—";

/** An outgoing call to a number the CRM doesn't know is a cold call; the same number ringing in is just new */
const kindLabel = (c: DetailCall) => (c.kind === "lead" ? "Lead" : c.direction === "outgoing" ? "Cold call" : "New number");

const EMPTY_HOUR = { made: 0, connected: 0, notAnswered: 0, incoming: 0, missed: 0, leadCalls: 0, coldCalls: 0, talkSec: 0 };
const time = (d: string) => new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

function Tile({ label, value, sub, tone = "" }: { label: string; value: React.ReactNode; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border/60 p-3">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** One salesperson's day: hour by hour through office hours, then every call they made or got */
export function BdmCallReport({ target, onClose }: { target: BdmCallTarget | null; onClose: () => void }) {
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-0 gap-0">
        {target && <Body key={`${target.userId}|${target.date}`} target={target} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({ target, onClose }: { target: BdmCallTarget; onClose: () => void }) {
  const openLead = useCrmUi((s) => s.openLead);
  const [kind, setKind] = useState("");
  const [result, setResult] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "calls-bdm", target.userId, target.date],
    queryFn: () => api<Detail>(`/crm/reports/calls/bdm${qs({ user: target.userId, from: target.date, to: target.date })}`),
    refetchInterval: 60_000,
  });

  const calls = useMemo(() => data?.calls ?? [], [data]);
  const shown = calls.filter((c) => (!kind || c.kind === kind) && (!result || (c.result ?? "none") === result));
  const totals = useMemo(() => {
    const made = calls.filter((c) => c.direction === "outgoing");
    return {
      made: made.length,
      connected: calls.filter((c) => ["outgoing", "incoming"].includes(c.direction) && c.durationSec > 0).length,
      notAnswered: made.filter((c) => c.durationSec === 0).length,
      incoming: calls.filter((c) => c.direction === "incoming").length,
      missed: calls.filter((c) => ["missed", "rejected"].includes(c.direction)).length,
      leadCalls: made.filter((c) => c.kind === "lead").length,
      coldCalls: made.filter((c) => c.kind === "cold").length,
      talkSec: calls.reduce((s, c) => s + c.durationSec, 0),
    };
  }, [calls]);

  const byHour = new Map((data?.hourly ?? []).map((h) => [h.hour, h]));
  const hours = WORK_HOURS.map((hour) => ({ hour, ...EMPTY_HOUR, ...byHour.get(hour) }));
  const outside = (data?.hourly ?? []).filter((h) => !WORK_HOURS.includes(h.hour));
  const outsideCalls = outside.reduce((s, h) => s + h.made + h.incoming + h.missed, 0);
  const busiest = Math.max(1, ...hours.map((h) => h.made + h.incoming));
  const isToday = data?.today === target.date;
  const live = callingStatus(calls[0]?.startedAt ?? null);
  const nowHour = new Date().getHours();

  return (
    <>
      <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/50">
        <DialogTitle className="flex flex-wrap items-center gap-2 text-xl">
          {target.name}
          <span className="text-sm font-normal text-muted-foreground">· {fmtDay(target.date)}</span>
          {isToday && <span className={`badge ${live.badge}`}>{live.label} — {live.sub}</span>}
          {target.rank && <span className="badge badge-blue">Rank {target.rank}{target.of ? ` of ${target.of}` : ""} today</span>}
        </DialogTitle>
        <p className="text-sm text-muted-foreground">Every call of the day — leads and cold calls — hour by hour. Office hours are 10:30 am to 7:00 pm.</p>
      </DialogHeader>

      {isError ? <div className="p-6"><ErrorState message="Could not load this salesperson's calls" /></div> : isLoading || !data ? <div className="p-6"><LoadingBlock /></div> : (
        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile label="Calls made" value={totals.made} sub={`${totals.notAnswered} not answered`} />
            <Tile label="Talked to" value={totals.connected} tone="text-emerald-700" sub={fmtCallDuration(totals.talkSec)} />
            <Tile label="Lead calls" value={totals.leadCalls} sub="called a number in the CRM" />
            <Tile label="Cold calls" value={totals.coldCalls} sub="called a brand-new number" />
          </div>

          {data.reasons.length > 0 && (
            <div className="card p-4">
              <p className="font-semibold mb-2">Why the quiet time</p>
              <ul className="space-y-1.5 text-sm">
                {data.reasons.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <span className="badge badge-amber">{r.reason}</span>
                    <span className="text-muted-foreground">said at {time(r.createdAt)}</span>
                    {r.note && <span className="text-muted-foreground">— {r.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card p-4">
            <p className="font-semibold mb-1">Hour by hour</p>
            <p className="text-xs text-muted-foreground mb-3">Red means no call at all in that hour of the working day.</p>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Hour</th><th>Calls</th><th className="text-right">Made</th><th className="text-right">Talked</th>
                    <th className="text-right">Lead calls</th><th className="text-right">Cold calls</th><th className="text-right">Talk time</th>
                  </tr>
                </thead>
                <tbody>
                  {hours.map((h) => {
                    const total = h.made + h.incoming;
                    // An hour that hasn't happened yet today is simply still to come, not a quiet hour
                    const future = isToday && h.hour > nowHour;
                    return (
                      <tr key={h.hour} className={total === 0 && !future ? "bg-red-50/70" : undefined}>
                        <td className="whitespace-nowrap font-medium">{workHourLabel(h.hour)}</td>
                        <td className="w-1/3 min-w-32">
                          {total > 0 ? (
                            <div className="flex items-center gap-2">
                              <div className="h-2.5 rounded-full bg-primary" style={{ width: `${Math.max(6, (total / busiest) * 100)}%` }} />
                              <span className="text-xs text-muted-foreground tabular-nums">{total}</span>
                            </div>
                          ) : (
                            <span className={`text-xs ${future ? "text-muted-foreground" : "text-red-600 font-medium"}`}>{future ? "Still to come" : "No calls"}</span>
                          )}
                        </td>
                        <td className="text-right tabular-nums">{h.made}</td>
                        <td className="text-right tabular-nums text-emerald-700">{h.connected}</td>
                        <td className="text-right tabular-nums">{h.leadCalls}</td>
                        <td className="text-right tabular-nums">{h.coldCalls}</td>
                        <td className="text-right tabular-nums">{fmtCallDuration(h.talkSec)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {outsideCalls > 0 && <p className="text-xs text-muted-foreground mt-2">{outsideCalls} call{outsideCalls === 1 ? "" : "s"} outside office hours (before 10:30 am or after 7 pm).</p>}
          </div>

          <div className="flex flex-wrap gap-2">
            <select value={kind} onChange={(e) => setKind(e.target.value)} className={selectCls} aria-label="Lead calls or cold calls">
              <option value="">All calls</option>
              <option value="lead">Lead calls only</option>
              <option value="cold">Cold calls only</option>
            </select>
            <select value={result} onChange={(e) => setResult(e.target.value)} className={selectCls} aria-label="How the call went">
              <option value="">Any result</option>
              {RESULTS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>

          <DataTable
            title="All calls"
            csvName={`calls-${target.name.toLowerCase().replace(/\s+/g, "-")}-${target.date}`}
            rows={shown}
            empty="No calls match this filter."
            columns={[
              { key: "startedAt", label: "Time", render: (c) => <span className="whitespace-nowrap">{time(c.startedAt)}</span>, csv: (c) => time(c.startedAt) },
              {
                key: "direction", label: "Call",
                render: (c) => {
                  const Icon = c.direction === "incoming" ? PhoneIncoming : ["missed", "rejected"].includes(c.direction) ? PhoneMissed : PhoneOutgoing;
                  return <span className="inline-flex items-center gap-1.5 capitalize"><Icon className={`size-3.5 ${c.durationSec > 0 ? "text-emerald-600" : c.direction === "outgoing" ? "text-muted-foreground" : "text-red-500"}`} />{c.direction}</span>;
                },
              },
              {
                key: "kind", label: "Type",
                render: (c) => <span className={`badge ${c.kind === "cold" ? "badge-amber" : "badge-blue"}`}>{kindLabel(c)}</span>,
                csv: (c) => kindLabel(c),
              },
              {
                key: "durationSec", label: "Length", align: "right",
                render: (c) => (c.durationSec > 0 ? fmtCallDuration(c.durationSec) : <span className="text-muted-foreground">{c.direction === "outgoing" ? "no answer" : "—"}</span>),
              },
              {
                key: "phone", label: "Number",
                render: (c) => <span className="whitespace-nowrap">{c.phone}{c.contactName && <span className="block text-xs text-muted-foreground">{c.contactName}</span>}</span>,
              },
              {
                key: "leadName", label: "Lead",
                render: (c) => c.leadId ? (
                  <button type="button" className="text-primary-text hover:underline text-left" onClick={() => { onClose(); openLead(c.leadId!); }}>
                    {c.leadName} {c.leadStage && <span className={`badge ${stageMeta(c.leadStage).badge} ml-1`}>{stageMeta(c.leadStage).label}</span>}
                  </button>
                ) : <span className="text-muted-foreground">Not a lead yet</span>,
                csv: (c) => c.leadName ?? "",
              },
              {
                key: "result", label: "What happened",
                render: (c) => <span className={`badge ${c.result ? outcomeMeta(c.result).badge : "badge-gray"}`}>{resultLabel(c.result)}</span>,
                csv: (c) => resultLabel(c.result),
              },
              { key: "note", label: "Note", render: (c) => c.note ? <span className="text-xs text-muted-foreground line-clamp-2">{c.note}</span> : "—" },
              { key: "recordingStatus", label: "Recording", render: (c) => <RecordingButton callId={c.id} status={c.recordingStatus} recordingUrl={c.recordingUrl} />, csv: (c) => c.recordingStatus ?? "" },
            ]}
          />
          {calls.length === 0 && (
            <p className="text-sm text-muted-foreground flex items-center gap-2"><Phone className="size-4" />No calls on this day.</p>
          )}
        </div>
      )}
    </>
  );
}
