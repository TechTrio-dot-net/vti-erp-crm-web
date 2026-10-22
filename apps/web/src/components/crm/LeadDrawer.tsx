"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Phone, MessageCircle, Mail, MapPin, Megaphone, Clock, UserRound, History, Pencil, Trash2, FileSignature } from "lucide-react";
import { api } from "@/lib/api";
import { useMe } from "@/lib/erp/me";
import {
  LOST_REASONS, OUTCOMES, STAGES, fmtCallDuration, fmtDateTime, inr, isCoordination, isCrmAdmin, outcomeMeta, stageMeta, timeAgo, toLocalInput,
  type CrmLead,
} from "@/lib/crm";
import { useAuthStore } from "@/store/auth";
import { useClickToCall } from "@/components/crm/ClickToCall";
import { RecordingButton } from "@/components/crm/CallRecording";
import { useCrmUi } from "@/store/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { selectCls, textareaCls, useBdms, useServices } from "./ui";

type LeadDetail = CrmLead & {
  followups: Array<{ id: string; outcome: string; source?: "web" | "phone"; note: string | null; nextFollowupAt: string | null; createdAt: string; userName: string | null;
    connected?: boolean | null; interested?: boolean | null; sampleShared?: boolean | null;
    callActivity?: string | null; statusLabel?: string | null; callDurationSec?: number | null; reason?: string | null }>;
  assignments: Array<{ id: string; reason: string; note: string | null; createdAt: string; fromUser: { name: string } | null; toUser: { name: string } | null; byUser: { name: string } | null }>;
  whatsapp: Array<{ id: string; message: string | null; createdAt: string }>;
  calls: Array<{ id: string; source: string; direction: string; status: string | null; startedAt: string; durationSec: number; recordingUrl: string | null; userName: string | null; recordingStatus: string | null; summary: string | null }>;
};

const REASON_LABEL: Record<string, string> = { auto: "Auto rotation", manual: "Manual", transfer: "Transfer", leave: "Leave hand-over", campaign: "Campaign rule" };

/** Quick "next follow-up" choices */
function quickTimes() {
  const at = (days: number, hour: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const inHours = (h: number) => new Date(Date.now() + h * 3600_000);
  return [
    { label: "In 2 hours", date: inHours(2) },
    { label: "Tomorrow 11am", date: at(1, 11) },
    { label: "In 2 days", date: at(2, 11) },
    { label: "Next week", date: at(7, 11) },
  ];
}

export function LeadDrawer() {
  const { leadId, leadBackTo, closeLead } = useCrmUi();
  return (
    <Dialog open={!!leadId} onOpenChange={(o) => !o && closeLead()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0 gap-0">
        {leadId && <LeadDrawerBody key={leadId} leadId={leadId} onClose={closeLead} backTo={leadBackTo} />}
      </DialogContent>
    </Dialog>
  );
}

function LeadDrawerBody({ leadId, onClose, backTo }: { leadId: string; onClose: () => void; backTo?: string | null }) {
  const queryClient = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const admin = isCrmAdmin(role);
  // Coordination opens leads from its reports to read them; calling and editing stay with the CRM roles
  const readOnly = isCoordination(role);
  const { data: lead, isLoading, isError, error } = useQuery({
    queryKey: ["crm", "lead", leadId],
    queryFn: () => api<LeadDetail>(`/crm/leads/${leadId}`),
  });
  const { data: bdms } = useBdms();
  const { data: services } = useServices();
  const router = useRouter();
  const { can } = useMe();
  // Quotations already written for this lead
  const { data: leadQuotations } = useQuery({
    queryKey: ["erp", "quotations", "lead", leadId],
    queryFn: () =>
      api<{ data: Array<{ id: string; quotation_number: string; status: string; grand_total: string; created_at: string }> }>(`/v1/quotations?lead_id=${leadId}&per_page=20`).then((r) => r.data),
    enabled: can(["quotations.view", "quotations.view_all"]),
  });

  const [outcome, setOutcome] = useState<string>("");
  const [note, setNote] = useState("");
  const [nextAt, setNextAt] = useState("");
  const [value, setValue] = useState("");
  const [lostReason, setLostReason] = useState(LOST_REASONS[0]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["crm"] });

  const followupMutation = useMutation({
    mutationFn: (body: object) => api(`/crm/leads/${leadId}/followups`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success("Follow-up saved");
      setOutcome(""); setNote(""); setNextAt(""); setValue("");
      refresh();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (body: object) => api(`/crm/leads/${leadId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { toast.success("Lead updated"); setEditing(false); refresh(); },
  });

  const assignMutation = useMutation({
    mutationFn: (toUserId: string) => api(`/crm/leads/${leadId}/assign`, { method: "POST", body: JSON.stringify({ toUserId: toUserId || null }) }),
    onSuccess: () => { toast.success("Lead reassigned"); refresh(); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api(`/crm/leads/${leadId}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("Lead deleted"); refresh(); onClose(); },
  });

  // The user's phone app dials the lead (or Exotel rings them first)
  const { call, pendingLeadId } = useClickToCall();

  const whatsapp = async () => {
    // Open the tab synchronously (popup blockers), then point it at wa.me once logged
    const tab = window.open("about:blank", "_blank");
    try {
      const message = `Hi ${lead?.name ?? ""}, `;
      const { url } = await api<{ url: string }>(`/crm/leads/${leadId}/whatsapp`, { method: "POST", body: JSON.stringify({ message }) });
      if (tab) tab.location.href = url; else window.location.href = url;
      queryClient.invalidateQueries({ queryKey: ["crm", "lead", leadId] });
    } catch (err) {
      tab?.close();
      toast.error((err as Error).message);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        <DialogTitle className="sr-only">Loading lead</DialogTitle>
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}
      </div>
    );
  }
  if (isError || !lead) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        <DialogTitle className="text-base mb-1">Lead unavailable</DialogTitle>
        {(error as Error)?.message ?? "Lead not found"}
      </div>
    );
  }

  const stage = stageMeta(lead.stage);
  const closed = lead.stage === "WON" || lead.stage === "LOST";
  const needsValue = outcome === "CONVERTED";
  const needsReason = outcome === "LOST" || outcome === "NOT_INTERESTED";

  const startEdit = () => {
    setForm({
      name: lead.name, phone: lead.phone ?? "", email: lead.email ?? "", city: lead.city ?? "",
      serviceId: lead.serviceId ?? "", estimatedValue: lead.estimatedValue ? String(lead.estimatedValue) : "", notes: lead.notes ?? "", stage: lead.stage,
    });
    setEditing(true);
  };

  return (
    <div>
      {/* Header */}
      <div className="p-6 pb-4 border-b border-border/60 space-y-3">
        {backTo && (
          <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-text hover:underline">
            <ArrowLeft className="size-4" />Back to {backTo}
          </button>
        )}
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-xl pr-8">
            {lead.contactName || lead.name}
            <span className={`badge ${stage.badge}`}>{stage.label}</span>
            {lead.statusLabel && lead.statusLabel !== stage.label && <span className="badge badge-gray" title="Status">{lead.statusLabel}</span>}
            {lead.pending && <span className="badge badge-red">Not contacted</span>}
            {lead.overdue && <span className="badge badge-amber">Follow-up overdue</span>}
            {lead.isManual && <span className="badge badge-gray">Manual</span>}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
          {lead.contactName && lead.contactName !== lead.name && <span className="flex items-center gap-1.5 font-medium text-foreground">{lead.name}</span>}
          {lead.phone && <span className="flex items-center gap-1.5"><Phone className="size-3.5" />{lead.phone}</span>}
          {lead.email && <span className="flex items-center gap-1.5"><Mail className="size-3.5" />{lead.email}</span>}
          {lead.city && <span className="flex items-center gap-1.5"><MapPin className="size-3.5" />{lead.city}</span>}
          {(lead.campaign || lead.source) && <span className="flex items-center gap-1.5"><Megaphone className="size-3.5" />{[lead.source, lead.campaign].filter(Boolean).join(" · ")}</span>}
          <span className="flex items-center gap-1.5"><Clock className="size-3.5" />Received {timeAgo(lead.createdAt)}</span>
          <span className="flex items-center gap-1.5"><UserRound className="size-3.5" />{lead.assignedName ?? "Unassigned"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!readOnly && lead.phone && (
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={pendingLeadId !== null} onClick={() => call(leadId)} title="Call from your phone">
              <Phone className="size-4" />{pendingLeadId ? "Calling…" : "Call"}
            </Button>
          )}
          {!readOnly && lead.phone && <Button size="sm" variant="outline" onClick={whatsapp}><MessageCircle className="size-4 text-emerald-600" />WhatsApp</Button>}
          {!readOnly && <Button size="sm" variant="outline" onClick={startEdit}><Pencil className="size-3.5" />Edit details</Button>}
          {can("quotations.create") && (
            <Button size="sm" variant="outline" onClick={() => { onClose(); router.push(`/quotations/new?lead=${leadId}`); }}>
              <FileSignature className="size-3.5" />Create quotation
            </Button>
          )}
          {admin && (
            <select
              value={lead.assignedTo ?? ""}
              onChange={(e) => assignMutation.mutate(e.target.value)}
              disabled={assignMutation.isPending}
              className={`${selectCls} ml-auto`}
              aria-label="Assigned BDM"
            >
              <option value="">Unassigned</option>
              {bdms?.map((b) => <option key={b.id} value={b.id}>{b.name}{b.onLeave ? " (on leave)" : ""}</option>)}
            </select>
          )}
        </div>
        {leadQuotations && leadQuotations.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-sm">
            <span className="section-label text-muted-foreground">Quotations</span>
            {leadQuotations.map((q) => (
              <Link
                key={q.id}
                href={`/quotations/${q.id}`}
                onClick={onClose}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 hover:bg-muted"
              >
                <FileSignature className="size-3.5 text-muted-foreground" />
                <span className="font-medium">{q.quotation_number}</span>
                <span className="text-muted-foreground">{inr(Number(q.grand_total))} · {q.status}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-5">
        {/* Left: follow-up + details */}
        <div className="md:col-span-3 p-6 space-y-5 md:border-r border-border/60">
          {readOnly ? null : editing ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                updateMutation.mutate({
                  name: form.name, phone: form.phone || null, email: form.email || null, city: form.city || null,
                  serviceId: form.serviceId || null, estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : 0,
                  notes: form.notes || null, stage: form.stage,
                });
              }}
            >
              <p className="section-label text-muted-foreground">Edit details</p>
              <div className="grid grid-cols-2 gap-3">
                {(["name", "phone", "email", "city"] as const).map((f) => (
                  <div key={f} className="space-y-1.5">
                    <Label className="capitalize">{f === "phone" ? "Mobile" : f}</Label>
                    <Input value={form[f]} onChange={(e) => setForm((s) => ({ ...s, [f]: e.target.value }))} required={f === "name"} />
                  </div>
                ))}
                <div className="space-y-1.5">
                  <Label>Service</Label>
                  <select value={form.serviceId} onChange={(e) => setForm((s) => ({ ...s, serviceId: e.target.value }))} className={`${selectCls} w-full`}>
                    <option value="">{lead.service && !lead.serviceId ? lead.service : "—"}</option>
                    {services?.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Value (₹)</Label>
                  <Input type="number" min={0} value={form.estimatedValue} onChange={(e) => setForm((s) => ({ ...s, estimatedValue: e.target.value }))} />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>Stage</Label>
                  <select value={form.stage} onChange={(e) => setForm((s) => ({ ...s, stage: e.target.value }))} className={`${selectCls} w-full`}>
                    {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>Notes</Label>
                  <textarea rows={4} value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} className={textareaCls} />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                <Button type="submit" disabled={updateMutation.isPending}>{updateMutation.isPending ? "Saving…" : "Save"}</Button>
              </div>
            </form>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!outcome) { toast.error("Choose the call outcome"); return; }
                followupMutation.mutate({
                  outcome,
                  note: note || undefined,
                  nextFollowupAt: !needsValue && !needsReason && nextAt ? new Date(nextAt).toISOString() : undefined,
                  estimatedValue: needsValue && value ? Number(value) : undefined,
                  lostReason: needsReason ? lostReason : undefined,
                });
              }}
            >
              <p className="section-label text-muted-foreground">{closed ? "Reopen / add a follow-up" : "Log call / follow-up"}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {OUTCOMES.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setOutcome(o.key)}
                    className={`px-2 py-2 rounded-lg text-xs font-semibold border transition-colors ${outcome === o.key ? "border-primary bg-primary/10 text-primary-text" : "border-input text-muted-foreground hover:text-foreground"}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did the customer say?" className={textareaCls} />
              {needsValue && (
                <div className="space-y-1.5">
                  <Label>Deal value (₹)</Label>
                  <Input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} placeholder={lead.estimatedValue ? String(lead.estimatedValue) : "0"} />
                </div>
              )}
              {needsReason && (
                <div className="space-y-1.5">
                  <Label>Reason</Label>
                  <select value={lostReason} onChange={(e) => setLostReason(e.target.value)} className={`${selectCls} w-full`}>
                    {LOST_REASONS.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </div>
              )}
              {!needsValue && !needsReason && (
                <div className="space-y-1.5">
                  <Label>Next follow-up</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {quickTimes().map((q) => (
                      <button key={q.label} type="button" onClick={() => setNextAt(toLocalInput(q.date))} className="px-2 h-7 rounded-md border border-input text-xs text-muted-foreground hover:text-foreground">
                        {q.label}
                      </button>
                    ))}
                  </div>
                  <input type="datetime-local" value={nextAt} onChange={(e) => setNextAt(e.target.value)} className={`${selectCls} w-full`} />
                </div>
              )}
              <Button type="submit" className="w-full" disabled={followupMutation.isPending}>
                {followupMutation.isPending ? "Saving…" : "Save follow-up"}
              </Button>
            </form>
          )}

          <div className="grid grid-cols-2 gap-2 text-sm">
            {[
              ["Service", lead.service ?? "—"],
              ["Value", inr(lead.estimatedValue)],
              ["Business type", lead.businessType ?? "—"],
              ["Sample shared", lead.sampleSharedAt ? fmtDateTime(lead.sampleSharedAt) : "Not yet"],
              ["Assigned", fmtDateTime(lead.assignedAt)],
              ["First contact", fmtDateTime(lead.firstContactAt)],
              ["Next follow-up", fmtDateTime(lead.nextFollowupAt)],
              [lead.stage === "LOST" ? "Lost reason" : "Closed", lead.stage === "LOST" ? lead.lostReason ?? "—" : fmtDateTime(lead.closedAt)],
              ...(lead.adName || lead.formName ? [["Ad / form", [lead.adName, lead.formName].filter(Boolean).join(" · ")]] : []),
            ].map(([k, v]) => (
              <div key={k} className="bg-muted/40 rounded-lg px-3 py-2">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{k}</p>
                <p className="font-medium truncate">{v}</p>
              </div>
            ))}
          </div>
          {lead.notes && !editing && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 text-sm whitespace-pre-wrap">{lead.notes}</div>
          )}
          {admin && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1"
              onClick={() => window.confirm(`Delete lead "${lead.name}"? This removes its follow-up history too.`) && deleteMutation.mutate()}
            >
              <Trash2 className="size-3" />Delete lead
            </button>
          )}
        </div>

        {/* Right: history */}
        <div className="md:col-span-2 p-6 space-y-4 bg-muted/20">
          <p className="section-label text-muted-foreground flex items-center gap-1.5"><History className="size-3.5" />History</p>
          {lead.followups.length === 0 && lead.assignments.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
          <ol className="space-y-3">
            {[
              ...lead.followups.map((f) => ({ at: f.createdAt, node: (
                <div key={f.id} className="rounded-lg border border-border/60 bg-background px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`badge ${outcomeMeta(f.outcome).badge}`}>{f.callActivity ?? outcomeMeta(f.outcome).label}</span>
                    {f.statusLabel && <span className="badge badge-gray" title="Status after this call">→ {f.statusLabel}</span>}
                    {f.source === "phone" && <span className="badge badge-gray" title="Logged on the phone app right after the call">Phone</span>}
                    {f.sampleShared === true && <span className="badge badge-green">Sample shared</span>}
                    {f.interested === true && f.sampleShared === false && <span className="badge badge-amber">No sample yet</span>}
                  </div>
                  <p className={`text-sm mt-1.5 whitespace-pre-wrap ${f.note ? "" : "text-muted-foreground italic"}`}>{f.note ?? "No remark"}</p>
                  {f.reason && <p className="text-xs text-red-700 mt-1">Reason: {f.reason}</p>}
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    {fmtDateTime(f.createdAt)} · {f.userName ?? "—"}
                    {!!f.callDurationSec && ` · call ${fmtCallDuration(f.callDurationSec)}`}
                    {f.nextFollowupAt && ` · next ${fmtDateTime(f.nextFollowupAt)}`}
                  </p>
                </div>
              ) })),
              ...lead.assignments.map((a) => ({ at: a.createdAt, node: (
                <div key={a.id} className="text-sm">
                  <p><span className="font-medium">{REASON_LABEL[a.reason] ?? a.reason}:</span> {a.fromUser?.name ?? "—"} → {a.toUser?.name ?? "Unassigned"}</p>
                  <p className="text-[11px] text-muted-foreground">{fmtDateTime(a.createdAt)}{a.byUser && ` · by ${a.byUser.name}`}{a.note && ` · ${a.note}`}</p>
                </div>
              ) })),
              ...lead.calls.map((c) => ({ at: c.startedAt, node: (
                <div key={c.id} className="text-sm">
                  <p className="flex items-center gap-1.5">
                    <Phone className={`size-3.5 ${c.durationSec > 0 ? "text-emerald-600" : c.direction === "missed" || c.direction === "rejected" ? "text-red-500" : "text-muted-foreground"}`} />
                    <span className="font-medium capitalize">{c.direction} call</span>
                    <span className="text-muted-foreground">
                      · {c.durationSec > 0 ? fmtCallDuration(c.durationSec) : c.status && c.status !== "completed" ? c.status.replace("-", " ") : c.direction === "outgoing" ? "not answered" : "0s"}
                    </span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {fmtDateTime(c.startedAt)} · {c.userName ?? "—"} · {c.source === "exotel" ? "company line" : "phone"}
                  </p>
                  {(c.recordingStatus || c.recordingUrl) && <div className="mt-1"><RecordingButton callId={c.id} status={c.recordingStatus} recordingUrl={c.recordingUrl} /></div>}
                  {c.summary && <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{c.summary}</p>}
                </div>
              ) })),
              ...lead.whatsapp.map((w) => ({ at: w.createdAt, node: (
                <div key={w.id} className="text-sm">
                  <p className="flex items-center gap-1.5"><MessageCircle className="size-3.5 text-emerald-600" />WhatsApp opened</p>
                  <p className="text-[11px] text-muted-foreground">{fmtDateTime(w.createdAt)}</p>
                </div>
              ) })),
            ]
              .sort((a, b) => b.at.localeCompare(a.at))
              .map((item, i) => (
                <li key={i} className="border-l-2 border-border pl-3">{item.node}</li>
              ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
