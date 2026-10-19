"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pause, Pencil, Play, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDateTime, inr, timeAgo, type Bdm } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminOnly, DataTable, ErrorState, LoadingBlock, PageHeader, selectCls, useBdms } from "@/components/crm/ui";

const EMPTY = { name: "", username: "", email: "", phone: "", password: "", divisionId: "", weeklyLeadTarget: "0", weeklyRevenueTarget: "0", rotationPosition: "0", isActive: true };

export default function BdmMasterPage() {
  return <AdminOnly><BdmMaster /></AdminOnly>;
}

function BdmMaster() {
  const queryClient = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const { data: bdms, isLoading, isError } = useBdms({ includeInactive: showInactive });
  const { data: divisions } = useQuery({ queryKey: ["masters", "divisions"], queryFn: () => api<Array<{ id: string; name: string }>>("/masters/divisions") });
  const [editing, setEditing] = useState<Bdm | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["crm"] });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name, email: form.email, phone: form.phone || null, divisionId: form.divisionId || null,
        weeklyLeadTarget: Number(form.weeklyLeadTarget) || 0, weeklyRevenueTarget: Number(form.weeklyRevenueTarget) || 0,
        rotationPosition: Number(form.rotationPosition) || 0, ...(form.password && { password: form.password }),
      };
      return editing
        ? api(`/crm/bdms/${editing.id}`, { method: "PATCH", body: JSON.stringify({ ...body, isActive: form.isActive }) })
        : api("/crm/bdms", { method: "POST", body: JSON.stringify({ ...body, username: form.username }) });
    },
    onSuccess: () => { toast.success(editing ? "BDM updated" : "BDM created — they can sign in now"); setEditing(null); setCreating(false); refresh(); },
  });

  const toggle = useMutation({
    mutationFn: ({ id, start }: { id: string; start: boolean }) => api(`/crm/bdms/${id}/${start ? "start" : "stop"}`, { method: "POST" }),
    onSuccess: refresh,
  });

  const open = (b: Bdm | null) => {
    setForm(b ? {
      name: b.name, username: b.username, email: b.email ?? "", phone: b.phone ?? "", password: "", divisionId: b.divisionId ?? "",
      weeklyLeadTarget: String(b.weeklyLeadTarget), weeklyRevenueTarget: String(b.weeklyRevenueTarget), rotationPosition: String(b.rotationPosition), isActive: b.isActive,
    } : EMPTY);
    setEditing(b);
    setCreating(!b);
  };
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="page space-y-5">
      <PageHeader title="BDM Master" subtitle="Sales team logins, rotation order and weekly targets">
        <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show deactivated</label>
        <Button onClick={() => open(null)}><Plus className="size-4" />Add BDM</Button>
      </PageHeader>
      {isError ? <ErrorState /> : isLoading || !bdms ? <LoadingBlock /> : (
        <DataTable
          rows={bdms}
          csvName="bdm-master"
          empty="No BDMs yet — add your first salesperson"
          columns={[
            { key: "rotationPosition", label: "Order", align: "right" },
            { key: "name", label: "BDM", render: (b) => <div><p className="font-semibold">{b.name}{!b.isActive && <span className="badge badge-gray ml-2">Deactivated</span>}</p><p className="text-xs text-muted-foreground">{b.username} · {b.email}</p></div> },
            { key: "divisionName", label: "Division" },
            {
              key: "inRotation", label: "Status",
              render: (b) => b.onLeave ? <span className="badge badge-amber">On leave</span> : b.inRotation ? <span className="badge badge-green">Online {b.sessionStartedAt && `· ${timeAgo(b.sessionStartedAt)}`}</span> : <span className="badge badge-gray">Offline</span>,
              csv: (b) => (b.onLeave ? "On leave" : b.inRotation ? "Online" : "Offline"),
            },
            { key: "openLeads", label: "Open", align: "right" },
            { key: "pendingLeads", label: "Not contacted", align: "right" },
            { key: "lastAssignedAt", label: "Last lead", render: (b) => fmtDateTime(b.lastAssignedAt) },
            { key: "weeklyLeadTarget", label: "Weekly target", align: "right", render: (b) => `${b.weeklyLeadTarget} deals · ${inr(b.weeklyRevenueTarget)}` },
            {
              key: "actions", label: "",
              render: (b) => (
                <div className="flex justify-end gap-1">
                  {b.isActive && (b.inRotation
                    ? <Button size="sm" className="h-7 bg-red-600 hover:bg-red-700 text-white" onClick={() => toggle.mutate({ id: b.id, start: false })}><Pause className="size-3" />Stop</Button>
                    : <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700 text-white" disabled={b.onLeave} onClick={() => toggle.mutate({ id: b.id, start: true })}><Play className="size-3" />Start</Button>)}
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => open(b)} aria-label={`Edit ${b.name}`}><Pencil className="size-3.5" /></Button>
                </div>
              ),
              csv: () => "",
            },
          ]}
        />
      )}

      <Dialog open={creating || !!editing} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? `Edit ${editing.name}` : "Add BDM"}</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5"><Label>Full name *</Label><Input value={form.name} onChange={set("name")} required /></div>
              {!editing && <div className="space-y-1.5"><Label>Username *</Label><Input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.toLowerCase() }))} required /></div>}
              <div className={`space-y-1.5 ${editing ? "col-span-2" : ""}`}><Label>Email *</Label><Input type="email" value={form.email} onChange={set("email")} required /></div>
              <div className="space-y-1.5"><Label>Mobile</Label><Input value={form.phone} onChange={set("phone")} /></div>
              <div className="space-y-1.5"><Label>{editing ? "New password" : "Password *"}</Label><Input type="password" value={form.password} onChange={set("password")} required={!editing} minLength={6} placeholder={editing ? "Leave blank to keep" : "Min 6 characters"} autoComplete="new-password" /></div>
              <div className="space-y-1.5">
                <Label>Division</Label>
                <select value={form.divisionId} onChange={set("divisionId")} className={`${selectCls} w-full`}>
                  <option value="">—</option>
                  {divisions?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><Label>Rotation order</Label><Input type="number" value={form.rotationPosition} onChange={set("rotationPosition")} /></div>
              <div className="space-y-1.5"><Label>Weekly target (deals)</Label><Input type="number" min={0} value={form.weeklyLeadTarget} onChange={set("weeklyLeadTarget")} /></div>
              <div className="space-y-1.5"><Label>Weekly target (₹)</Label><Input type="number" min={0} value={form.weeklyRevenueTarget} onChange={set("weeklyRevenueTarget")} /></div>
              {editing && (
                <label className="col-span-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                  Active (unticking blocks sign-in and removes them from rotation)
                </label>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button>
              <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
