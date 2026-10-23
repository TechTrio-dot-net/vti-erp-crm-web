"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronLeft, ChevronRight, History } from "lucide-react";
import { api } from "@/lib/api";
import { addDays, downloadCsv, fmtDateTime, fmtDay, stageMeta, today } from "@/lib/crm";
import { useCrmUi } from "@/store/crm";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AdminOnly, ErrorState, LoadingBlock, PageHeader, selectCls } from "@/components/crm/ui";

type Cell = { assigned: number; pending: number };
type Pick = { title: string; from: string; to: string; user?: string; pending?: boolean };
type LeadRow = {
  id: string; name: string; phone: string | null; source: string | null; campaign: string | null; stage: string; statusLabel: string | null;
  createdAt: string; firstContactAt: string | null; nextFollowupAt: string | null; assignedName: string;
};
type Summary = {
  range: { from: string; to: string };
  dates: string[];
  rows: Array<{ userId: string; name: string; inRotation: boolean; onLeave: boolean; cells: Record<string, Cell> }>;
  totals: Record<string, Cell>;
};

export default function LeadWeeklySummaryPage() {
  return <AdminOnly><LeadSummary /></AdminOnly>;
}

function LeadSummary() {
  const queryClient = useQueryClient();
  const [to, setTo] = useState(today());
  const [division, setDivision] = useState("");
  const [manual, setManual] = useState("");
  const { data: divisions } = useQuery({ queryKey: ["masters", "divisions"], queryFn: () => api<Array<{ id: string; name: string }>>("/masters/divisions") });
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "lead-summary", to, division, manual],
    queryFn: () => api<Summary>(`/crm/reports/lead-summary?to=${to}${division ? `&division=${division}` : ""}${manual ? `&manual=${manual}` : ""}`),
    refetchInterval: 60_000,
  });
  const [pick, setPick] = useState<Pick | null>(null);
  const toggle = useMutation({
    mutationFn: ({ id, start }: { id: string; start: boolean }) => api(`/crm/bdms/${id}/${start ? "start" : "stop"}`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm"] }),
  });

  const cellText = (c?: Cell) => (!c ? "" : c.pending ? `${c.assigned} - ${c.pending}` : `${c.assigned}`);
  /** A BDM's week: every day's cells added up */
  const weekOf = (cells: Record<string, Cell>) =>
    Object.values(cells).reduce((sum, c) => ({ assigned: sum.assigned + c.assigned, pending: sum.pending + c.pending }), { assigned: 0, pending: 0 });
  /** A count; the number opens its leads, the red number the ones not contacted yet */
  const countCell = (c: Cell | undefined, at: Omit<Pick, "pending">, strong = false) =>
    !c || (!c.assigned && !c.pending) ? <span className="text-muted-foreground/50">–</span> : (
      <>
        <button type="button" className={`${strong ? "font-bold" : "font-semibold"} hover:underline`} onClick={() => setPick(at)} title="Show these leads">{c.assigned}</button>
        {c.pending > 0 && (
          <button type="button" className="text-red-600 font-semibold hover:underline" onClick={() => setPick({ ...at, title: `${at.title} — not contacted`, pending: true })} title={`${c.pending} still not contacted`}>
            {" "}− {c.pending}
          </button>
        )}
      </>
    );
  const dayName = (d: string) => (d === today() ? "Today" : fmtDay(d));

  return (
    <div className="page space-y-5">
      <PageHeader title={`Lead Summary (${data?.range.from ?? ""} to ${data?.range.to ?? ""})`} subtitle="Each cell: leads that came in that day, with the BDM who holds them now – leads still not contacted (red)">
        {data && (
          <Button variant="outline" onClick={() => downloadCsv(`lead-summary-${data.range.to}.csv`, ["BDM", "Status", ...data.dates, "Week"], data.rows.map((r) => [r.name, r.onLeave ? "On leave" : r.inRotation ? "Online" : "Stopped", ...data.dates.map((d) => cellText(r.cells[d])), cellText(weekOf(r.cells))]))}>
            Export CSV
          </Button>
        )}
      </PageHeader>

      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="h-9" onClick={() => setTo(addDays(to, -7))}><ChevronLeft className="size-4" />Previous</Button>
          <Button variant="outline" size="sm" className="h-9" disabled={to >= today()} onClick={() => setTo(addDays(to, 7) > today() ? today() : addDays(to, 7))}>Next<ChevronRight className="size-4" /></Button>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-semibold">Division</p>
          <select value={division} onChange={(e) => setDivision(e.target.value)} className={`${selectCls} w-56`}>
            <option value="">-- All --</option>
            {divisions?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-semibold">Show Manual Entry</p>
          <select value={manual} onChange={(e) => setManual(e.target.value)} className={`${selectCls} w-56`}>
            <option value="">YES (All Sources)</option>
            <option value="no">NO (Imported only)</option>
            <option value="only">ONLY manual entries</option>
          </select>
        </div>
        <Button asChild variant="ghost" size="sm" className="h-9 ml-auto">
          <Link href="/crm/transfer"><History className="size-4" />LogFile BDM Sequence</Link>
        </Button>
      </div>

      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-10">Sr</th>
                <th>BDM</th>
                <th>Status</th>
                {data.dates.map((d) => <th key={d} className="text-center whitespace-nowrap">{d === today() ? "Today" : fmtDay(d)}</th>)}
                <th className="text-center bg-muted/60">Week</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && <tr><td colSpan={data.dates.length + 4} className="text-center text-muted-foreground py-8">No active BDMs. Add them in BDM Master.</td></tr>}
              {data.rows.map((r, i) => (
                <tr key={r.userId}>
                  <td className="text-muted-foreground">{i + 1}</td>
                  <td className="font-semibold whitespace-nowrap">{r.name}</td>
                  <td className="whitespace-nowrap">
                    {r.onLeave ? <span className="badge badge-amber">On leave</span> : (
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold w-[4.5rem] ${r.inRotation ? "text-emerald-700" : "text-muted-foreground"}`}>
                          <span className={`size-2 rounded-full ${r.inRotation ? "bg-emerald-500" : "bg-slate-300"}`} />
                          {r.inRotation ? "Online" : "Stopped"}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className={`h-7 px-2.5 text-xs w-14 ${r.inRotation ? "border-red-200 text-red-700 hover:bg-red-50" : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"}`}
                          disabled={toggle.isPending}
                          onClick={() => toggle.mutate({ id: r.userId, start: !r.inRotation })}
                          title={r.inRotation ? `Stop giving new leads to ${r.name}` : `Start giving new leads to ${r.name}`}
                        >
                          {r.inRotation ? "Stop" : "Start"}
                        </Button>
                      </div>
                    )}
                  </td>
                  {data.dates.map((d) => (
                    <td key={d} className="text-center tabular-nums whitespace-nowrap">{countCell(r.cells[d], { title: `${r.name} · ${dayName(d)}`, from: d, to: d, user: r.userId })}</td>
                  ))}
                  <td className="text-center tabular-nums whitespace-nowrap bg-muted/40">{countCell(weekOf(r.cells), { title: `${r.name} · week`, from: data.range.from, to: data.range.to, user: r.userId }, true)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <td />
                <td colSpan={2}>Total</td>
                {data.dates.map((d) => (
                  <td key={d} className="text-center tabular-nums whitespace-nowrap">{countCell(data.totals[d], { title: `Everyone · ${dayName(d)}`, from: d, to: d }, true)}</td>
                ))}
                <td className="text-center tabular-nums whitespace-nowrap bg-muted/40">
                  {countCell(Object.values(data.totals).reduce((sum, c) => ({ assigned: sum.assigned + c.assigned, pending: sum.pending + c.pending }), { assigned: 0, pending: 0 }), { title: "Everyone · week", from: data.range.from, to: data.range.to }, true)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <SummaryLeads pick={pick} division={division} manual={manual} onClose={() => setPick(null)} />
    </div>
  );
}

function SummaryLeads({ pick, division, manual, onClose }: { pick: Pick | null; division: string; manual: string; onClose: () => void }) {
  const { openLead } = useCrmUi();
  const query = pick
    ? new URLSearchParams({
        from: pick.from, to: pick.to,
        ...(pick.user && { user: pick.user }), ...(pick.pending && { pending: "1" }),
        ...(division && { division }), ...(manual && { manual }),
      }).toString()
    : "";
  const { data, isError } = useQuery({
    queryKey: ["crm", "lead-summary", "leads", query],
    queryFn: () => api<{ rows: LeadRow[] }>(`/crm/reports/lead-summary/leads?${query}`),
    enabled: !!pick,
    staleTime: 30_000,
  });
  return (
    <Dialog open={!!pick} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{pick?.title}{data ? ` · ${data.rows.length} lead${data.rows.length === 1 ? "" : "s"}` : ""}</DialogTitle></DialogHeader>
        {isError ? <ErrorState message="Could not load these leads — try again" /> : !data ? <LoadingBlock rows={4} /> : data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No leads.</p>
        ) : (
          <div className="divide-y divide-border/50">
            {/* The list stays open behind the lead, so the drawer's Back comes straight back to it */}
            {data.rows.map((l) => (
              <button key={l.id} type="button" onClick={() => openLead(l.id, pick?.title ?? "the list")} className="w-full text-left py-2.5 px-1 hover:bg-muted/30 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{l.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{[l.phone, l.assignedName, l.campaign ?? l.source].filter(Boolean).join(" · ")}</p>
                </div>
                {l.firstContactAt ? <span className="badge badge-gray">{l.statusLabel ?? stageMeta(l.stage).label}</span> : <span className="badge badge-red">Not contacted</span>}
                <span className="text-xs tabular-nums w-32 text-right text-muted-foreground">{fmtDateTime(l.createdAt)}</span>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
