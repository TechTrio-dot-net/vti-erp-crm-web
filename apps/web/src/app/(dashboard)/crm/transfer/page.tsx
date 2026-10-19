"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRightLeft, CalendarOff, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime, today } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AdminOnly, DataTable, DateRangeFilter, PageHeader, lastDays, selectCls, textareaCls, useBdms } from "@/components/crm/ui";

type Leave = { id: string; userId: string; userName: string; fromDate: string; toDate: string; reason: string | null; transferredCount: number; createdAt: string };
type Assignment = { id: string; reason: string; note: string | null; createdAt: string; lead: { id: string; companyName: string; phone: string | null; campaign: string | null } | null; fromUser: { name: string } | null; toUser: { name: string } | null; byUser: { name: string } | null };

const REASONS: Record<string, string> = { auto: "Auto rotation", manual: "Manual", transfer: "Transfer", leave: "Leave", campaign: "Campaign rule" };

export default function LeadTransferPage() {
  return <AdminOnly><LeadTransfer /></AdminOnly>;
}

function LeadTransfer() {
  const queryClient = useQueryClient();
  const { data: bdms } = useBdms();
  const [transfer, setTransfer] = useState({ fromUserId: "", toUserId: "rotation", onlyPending: false, note: "" });
  const [leave, setLeave] = useState({ userId: "", fromDate: today(), toDate: today(), reason: "", transferTo: "rotation", onlyPending: false });
  const [logRange, setLogRange] = useState(lastDays(7));
  const [logReason, setLogReason] = useState("");

  const { data: leaves } = useQuery({ queryKey: ["crm", "leaves"], queryFn: () => api<Leave[]>("/crm/leaves") });
  const { data: log } = useQuery({
    queryKey: ["crm", "assignments", logRange, logReason],
    queryFn: () => api<Assignment[]>(`/crm/assignments?from=${logRange.from}&to=${logRange.to}${logReason ? `&reason=${logReason}` : ""}`),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["crm"] });

  const transferMutation = useMutation({
    mutationFn: () => api<{ moved: number }>("/crm/transfer", { method: "POST", body: JSON.stringify(transfer) }),
    onSuccess: (r) => { toast.success(`${r.moved} lead${r.moved !== 1 ? "s" : ""} transferred`); refresh(); },
  });
  const leaveMutation = useMutation({
    mutationFn: () => api<{ transferredCount: number }>("/crm/leaves", { method: "POST", body: JSON.stringify({ ...leave, transferTo: leave.transferTo || undefined }) }),
    onSuccess: (r) => { toast.success("Leave saved", { description: `${r.transferredCount} open lead(s) handed over` }); setLeave((l) => ({ ...l, userId: "", reason: "" })); refresh(); },
  });
  const deleteLeave = useMutation({
    mutationFn: (id: string) => api(`/crm/leaves/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("Leave removed"); refresh(); },
  });

  const from = bdms?.find((b) => b.id === transfer.fromUserId);
  const leaveBdm = bdms?.find((b) => b.id === leave.userId);

  return (
    <div className="page space-y-5">
      <PageHeader title="Lead Transfer & Leave" subtitle="Hand over leads when a salesperson is on leave, busy or leaves the company" />

      <div className="grid lg:grid-cols-2 gap-5">
        <form className="card p-5 space-y-3" onSubmit={(e) => { e.preventDefault(); if (!leave.userId) return toast.error("Choose the BDM"); leaveMutation.mutate(); }}>
          <p className="font-semibold flex items-center gap-2"><CalendarOff className="size-4 text-amber-600" />Mark leave</p>
          <p className="text-xs text-muted-foreground">During leave the BDM gets no new leads. If the leave includes today they&apos;re stopped right away.</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>BDM</Label>
              <select value={leave.userId} onChange={(e) => setLeave((l) => ({ ...l, userId: e.target.value }))} className={`${selectCls} w-full`}>
                <option value="">Select…</option>
                {bdms?.map((b) => <option key={b.id} value={b.id}>{b.name} — {b.openLeads} open</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><Label>From</Label><input type="date" value={leave.fromDate} onChange={(e) => setLeave((l) => ({ ...l, fromDate: e.target.value }))} className={`${selectCls} w-full`} /></div>
            <div className="space-y-1.5"><Label>To</Label><input type="date" value={leave.toDate} min={leave.fromDate} onChange={(e) => setLeave((l) => ({ ...l, toDate: e.target.value }))} className={`${selectCls} w-full`} /></div>
            <div className="col-span-2 space-y-1.5">
              <Label>Their open leads</Label>
              <select value={leave.transferTo} onChange={(e) => setLeave((l) => ({ ...l, transferTo: e.target.value }))} className={`${selectCls} w-full`}>
                <option value="rotation">Share among online BDMs (round-robin)</option>
                <option value="">Keep with them</option>
                {bdms?.filter((b) => b.id !== leave.userId).map((b) => <option key={b.id} value={b.id}>Give all to {b.name}</option>)}
              </select>
            </div>
            {leave.transferTo && (
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={leave.onlyPending} onChange={(e) => setLeave((l) => ({ ...l, onlyPending: e.target.checked }))} />
                Only leads not contacted yet {leaveBdm && `(${leaveBdm.pendingLeads})`}
              </label>
            )}
            <div className="col-span-2 space-y-1.5"><Label>Reason</Label><textarea rows={2} value={leave.reason} onChange={(e) => setLeave((l) => ({ ...l, reason: e.target.value }))} className={textareaCls} /></div>
          </div>
          <Button type="submit" disabled={leaveMutation.isPending} className="w-full">{leaveMutation.isPending ? "Saving…" : "Save leave"}</Button>
        </form>

        <form className="card p-5 space-y-3" onSubmit={(e) => { e.preventDefault(); if (!transfer.fromUserId) return toast.error("Choose who to transfer from"); transferMutation.mutate(); }}>
          <p className="font-semibold flex items-center gap-2"><ArrowRightLeft className="size-4 text-primary-text" />Transfer leads</p>
          <p className="text-xs text-muted-foreground">Moves open leads (won and lost leads stay). Every move is recorded in the log below.</p>
          <div className="space-y-1.5">
            <Label>From</Label>
            <select value={transfer.fromUserId} onChange={(e) => setTransfer((t) => ({ ...t, fromUserId: e.target.value }))} className={`${selectCls} w-full`}>
              <option value="">Select…</option>
              {bdms?.map((b) => <option key={b.id} value={b.id}>{b.name} — {b.openLeads} open, {b.pendingLeads} not contacted</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>To</Label>
            <select value={transfer.toUserId} onChange={(e) => setTransfer((t) => ({ ...t, toUserId: e.target.value }))} className={`${selectCls} w-full`}>
              <option value="rotation">Share among online BDMs (round-robin)</option>
              {bdms?.filter((b) => b.id !== transfer.fromUserId).map((b) => <option key={b.id} value={b.id}>{b.name}{b.onLeave ? " (on leave)" : ""}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={transfer.onlyPending} onChange={(e) => setTransfer((t) => ({ ...t, onlyPending: e.target.checked }))} />
            Only leads not contacted yet
          </label>
          <div className="space-y-1.5"><Label>Note</Label><textarea rows={2} value={transfer.note} onChange={(e) => setTransfer((t) => ({ ...t, note: e.target.value }))} className={textareaCls} placeholder="e.g. Resigned, workload balance" /></div>
          <Button type="submit" disabled={transferMutation.isPending || !transfer.fromUserId} className="w-full">
            {transferMutation.isPending ? "Transferring…" : `Transfer ${from ? (transfer.onlyPending ? from.pendingLeads : from.openLeads) : ""} leads`}
          </Button>
        </form>
      </div>

      <DataTable
        title="Leaves"
        rows={leaves ?? []}
        empty="No leaves recorded"
        columns={[
          { key: "userName", label: "BDM", className: "font-semibold" },
          { key: "fromDate", label: "From", render: (r) => fmtDate(r.fromDate) },
          { key: "toDate", label: "To", render: (r) => fmtDate(r.toDate) },
          { key: "status", label: "", render: (r) => (r.fromDate <= today() && today() <= r.toDate ? <span className="badge badge-amber">On leave today</span> : r.toDate < today() ? <span className="badge badge-gray">Past</span> : <span className="badge badge-blue">Upcoming</span>) },
          { key: "reason", label: "Reason", className: "text-muted-foreground" },
          { key: "transferredCount", label: "Leads handed over", align: "right" },
          { key: "actions", label: "", render: (r) => <Button variant="ghost" size="sm" className="h-7 px-2 hover:text-destructive" onClick={() => window.confirm("Remove this leave?") && deleteLeave.mutate(r.id)}><Trash2 className="size-3.5" /></Button> },
        ]}
      />

      <div className="card p-4 flex flex-wrap items-center gap-3">
        <p className="font-semibold mr-2">Assignment log (BDM sequence)</p>
        <DateRangeFilter value={logRange} onChange={setLogRange} />
        <select value={logReason} onChange={(e) => setLogReason(e.target.value)} className={selectCls}>
          <option value="">All reasons</option>
          {Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <DataTable
        rows={log ?? []}
        csvName="assignment-log"
        empty="No assignments in this period"
        columns={[
          { key: "createdAt", label: "When", render: (r) => fmtDateTime(r.createdAt) },
          { key: "lead", label: "Lead", render: (r) => <span className="font-semibold">{r.lead?.companyName ?? "—"}</span>, csv: (r) => r.lead?.companyName },
          { key: "phone", label: "Mobile", render: (r) => r.lead?.phone ?? "—", csv: (r) => r.lead?.phone },
          { key: "reason", label: "Type", render: (r) => <span className="badge badge-gray">{REASONS[r.reason] ?? r.reason}</span>, csv: (r) => REASONS[r.reason] ?? r.reason },
          { key: "from", label: "From", render: (r) => r.fromUser?.name ?? "—", csv: (r) => r.fromUser?.name },
          { key: "to", label: "To", render: (r) => r.toUser?.name ?? "Unassigned", csv: (r) => r.toUser?.name },
          { key: "by", label: "By", render: (r) => r.byUser?.name ?? "System", csv: (r) => r.byUser?.name ?? "System" },
          { key: "note", label: "Note", className: "text-muted-foreground" },
        ]}
      />
    </div>
  );
}
