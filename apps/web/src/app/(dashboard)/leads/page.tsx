"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Plus, Target, TrendingUp, IndianRupee, CheckCircle2, WifiOff, Search,
  Pencil, Trash2, UserPlus, AlertCircle, Building2,
} from "lucide-react";
import { Skeleton, SkeletonCard, SkeletonTable } from "@/components/ui/skeleton";

const STAGES = [
  { key: "AWARENESS",   label: "Awareness",   color: "badge-gray"   },
  { key: "CONTACTED",   label: "Contacted",   color: "badge-blue"   },
  { key: "PROPOSAL",    label: "Proposal",    color: "badge-purple" },
  { key: "NEGOTIATION", label: "Negotiation", color: "badge-amber"  },
  { key: "WON",         label: "Won",         color: "badge-green"  },
  { key: "LOST",        label: "Lost",        color: "badge-red"    },
] as const;

const VIEWS = [
  { key: "open",   label: "Open pipeline" },
  { key: "closed", label: "Won & lost" },
  { key: "all",    label: "All leads" },
] as const;

type View = (typeof VIEWS)[number]["key"];

type Lead = {
  id: string;
  company: string;
  companyName: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  service: string;
  estimatedValue: number;
  stage: string;
  notes?: string | null;
  clientId?: string | null;
  assignedTo?: { id: string; name: string } | null;
  owner?: { name: string } | null;
  lastContactAt?: string | null;
  needsFollowUp: boolean;
};

type LeadsResponse = {
  leads: Lead[];
  stages: Array<{ stage: string; count: number; value: number }>;
  wonMTD: number;
};

type StaffMember = { id: string; name: string; role: string };

type LeadForm = {
  companyName: string; contactName: string; email: string; phone: string;
  service: string; source: string; estimatedValue: string; stage: string; assignedTo: string; notes: string;
};

const EMPTY_FORM: LeadForm = {
  companyName: "", contactName: "", email: "", phone: "",
  service: "", source: "", estimatedValue: "", stage: "AWARENESS", assignedTo: "", notes: "",
};

const stageMeta = (stage: string) => STAGES.find((s) => s.key === stage) ?? { key: stage, label: stage, color: "badge-gray" };

function fmt(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)   return `₹${(n / 1000).toFixed(0)}K`;
  return `₹${n}`;
}

const selectCls = "w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export default function LeadsPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>("open");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [form, setForm] = useState<LeadForm>(EMPTY_FORM);
  const [converting, setConverting] = useState<Lead | null>(null);
  const [convertEmail, setConvertEmail] = useState("");
  const [deleting, setDeleting] = useState<Lead | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["leads", view],
    queryFn: () => api<LeadsResponse>(`/leads?view=${view}`),
  });

  const { data: staff } = useQuery({
    queryKey: ["users", "directory"],
    queryFn: () => api<StaffMember[]>("/users/directory"),
    staleTime: 5 * 60_000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["leads"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const saveMutation = useMutation({
    mutationFn: (body: object) =>
      editing
        ? api(`/leads/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : api("/leads", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success(editing ? "Lead updated" : "Lead added");
      setFormOpen(false);
      refresh();
    },
  });

  const stageMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) =>
      api(`/leads/${id}`, { method: "PATCH", body: JSON.stringify({ stage }) }),
    onMutate: async ({ id, stage }) => {
      await queryClient.cancelQueries({ queryKey: ["leads", view] });
      const previous = queryClient.getQueryData<LeadsResponse>(["leads", view]);
      queryClient.setQueryData<LeadsResponse>(["leads", view], (old) =>
        old ? { ...old, leads: old.leads.map((l) => (l.id === id ? { ...l, stage } : l)) } : old
      );
      return { previous };
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["leads", view], ctx.previous);
      toast.error(err.message);
    },
    onSettled: refresh,
  });

  const convertMutation = useMutation({
    mutationFn: ({ id, contactEmail }: { id: string; contactEmail: string }) =>
      api<{ client: { companyName: string } }>(`/leads/${id}/convert`, { method: "POST", body: JSON.stringify({ contactEmail }) }),
    onSuccess: (res) => {
      toast.success(`${res.client.companyName} is now a client`, { description: "The lead was marked as won." });
      setConverting(null);
      refresh();
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/leads/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Lead deleted");
      setDeleting(null);
      refresh();
    },
  });

  const visibleLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.leads ?? []).filter(
      (l) =>
        (!stageFilter || l.stage === stageFilter) &&
        (!q || [l.company, l.contactName, l.email, l.service].some((v) => v?.toLowerCase().includes(q)))
    );
  }, [data, search, stageFilter]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    saveMutation.reset();
    setFormOpen(true);
  };

  const openEdit = (l: Lead) => {
    setEditing(l);
    setForm({
      companyName: l.companyName, contactName: l.contactName ?? "", email: l.email ?? "", phone: l.phone ?? "",
      service: l.service === "—" ? "" : l.service, source: l.source ?? "",
      estimatedValue: l.estimatedValue ? String(l.estimatedValue) : "", stage: l.stage,
      assignedTo: l.assignedTo?.id ?? "", notes: l.notes ?? "",
    });
    saveMutation.reset();
    setFormOpen(true);
  };

  const submitForm = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({
      companyName: form.companyName.trim(),
      contactName: form.contactName.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      service: form.service.trim() || "General",
      source: form.source.trim() || null,
      estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : 0,
      stage: form.stage,
      assignedTo: form.assignedTo || undefined,
      notes: form.notes.trim() || null,
    });
  };

  const setField = (field: keyof LeadForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  if (isError) return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 text-center animate-fade-up">
      <div className="size-12 rounded-2xl bg-muted flex items-center justify-center">
        <WifiOff className="size-6 text-muted-foreground" />
      </div>
      <p className="font-semibold text-foreground">Could not load leads</p>
      <p className="text-sm text-muted-foreground">Check your connection or try refreshing.</p>
    </div>
  );

  if (isLoading || !data) return (
    <div className="page space-y-6">
      <div className="page-header">
        <div className="space-y-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0,1,2,3].map(i => <SkeletonCard key={i} />)}
      </div>
      <SkeletonTable rows={5} />
    </div>
  );

  const stat = (stage: string) => data.stages.find((s) => s.stage === stage) ?? { count: 0, value: 0 };
  const openStages = STAGES.filter((s) => s.key !== "WON" && s.key !== "LOST");
  const pipelineValue = openStages.reduce((sum, s) => sum + stat(s.key).value, 0);
  const openCount = openStages.reduce((sum, s) => sum + stat(s.key).count, 0);
  const closedCount = stat("WON").count + stat("LOST").count;
  const winRate = closedCount ? Math.round((stat("WON").count / closedCount) * 100) : 0;
  const followUps = data.leads.filter((l) => l.needsFollowUp).length;

  return (
    <div className="page space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Lead Pipeline</h1>
          <p className="page-subtitle">Track prospects from first touch to signed contract</p>
        </div>
        <Button onClick={openCreate}><Plus className="size-4" />Add Lead</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger">
        {[
          { label: "Open Leads",     value: openCount,                   sub: followUps ? `${followUps} need follow-up` : "All followed up", icon: Target,       chip: "icon-chip-blue",  kpi: "kpi-blue"  },
          { label: "Pipeline Value", value: fmt(pipelineValue),          sub: "Across open stages",       icon: IndianRupee,  chip: "icon-chip-green", kpi: "kpi-green" },
          { label: "In Negotiation", value: stat("NEGOTIATION").count,    sub: fmt(stat("NEGOTIATION").value), icon: TrendingUp, chip: "icon-chip-amber", kpi: "kpi-amber" },
          { label: "Won (MTD)",      value: data.wonMTD,                 sub: `${winRate}% win rate overall`, icon: CheckCircle2, chip: "icon-chip-sky",   kpi: "kpi-sky"   },
        ].map(({ label, value, sub, icon: Icon, chip, kpi }) => (
          <div key={label} className={`card animate-fade-up ${kpi} p-5`}>
            <div className="flex items-start justify-between mb-3">
              <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
              <div className={`icon-chip size-9 ${chip}`}><Icon className="size-4" /></div>
            </div>
            <div className="text-3xl font-bold tabular-nums">{value}</div>
            <p className="text-xs text-muted-foreground mt-1">{sub}</p>
          </div>
        ))}
      </div>

      {/* Stage funnel — click a stage to filter */}
      <div className="card p-5">
        <p className="section-label text-muted-foreground mb-4">Pipeline Stages</p>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {STAGES.map(({ key, label, color }) => {
            const { count, value } = stat(key);
            const active = stageFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setStageFilter(active ? null : key);
                  if (!active) setView(key === "WON" || key === "LOST" ? "closed" : "open");
                }}
                className={`funnel-step rounded-lg text-left transition-colors ${active ? "bg-primary/10 ring-1 ring-primary/40" : "bg-muted/30 hover:bg-muted/60"}`}
              >
                <span className={`badge ${color} mb-2`}>{label}</span>
                <span className="text-2xl font-bold tabular-nums">{count}</span>
                <span className="text-xs text-muted-foreground mt-1">{fmt(value)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-border/50">
          <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => { setView(v.key); setStageFilter(null); }}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === v.key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[200px] max-w-sm ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company, contact, service…" className="h-9 pl-9" />
          </div>
          <span className="badge badge-gray">{visibleLeads.length} shown</span>
        </div>

        {visibleLeads.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Target className="size-6 text-muted-foreground" /></div>
            <p className="font-semibold">{data.leads.length ? "No leads match" : "No leads here yet"}</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              {data.leads.length ? "Try a different search or stage." : "Add a lead to start tracking your pipeline"}
            </p>
            {!data.leads.length && <Button onClick={openCreate}><Plus className="size-4" />Add Lead</Button>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr>
                <th>Company</th><th>Service</th><th>Est. Value</th>
                <th>Stage</th><th>Owner</th><th>Last Contact</th><th></th>
              </tr></thead>
              <tbody>
                {visibleLeads.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="avatar avatar-sm" style={{ background: `hsl(${(l.company.charCodeAt(0) * 17) % 360} 55% 42%)` }}>
                          {l.company.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <button type="button" onClick={() => openEdit(l)} className="font-semibold text-foreground hover:text-primary-text text-left">
                            {l.company}
                          </button>
                          {(l.contactName || l.email) && (
                            <p className="text-xs text-muted-foreground truncate max-w-[220px]">
                              {[l.contactName, l.email].filter(Boolean).join(" · ")}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="text-muted-foreground">{l.service}</td>
                    <td className="font-semibold tabular-nums">{fmt(l.estimatedValue || 0)}</td>
                    <td>
                      <select
                        value={l.stage}
                        onChange={(e) => stageMutation.mutate({ id: l.id, stage: e.target.value })}
                        className={`badge ${stageMeta(l.stage).color} border-0 cursor-pointer pr-1 focus:outline-none focus:ring-2 focus:ring-ring`}
                        aria-label={`Stage for ${l.company}`}
                      >
                        {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                    </td>
                    <td className="text-muted-foreground">{l.owner?.name ?? "—"}</td>
                    <td className="text-muted-foreground whitespace-nowrap">
                      {l.lastContactAt ? new Date(l.lastContactAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}
                      {l.needsFollowUp && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600">
                          <AlertCircle className="size-3" />Follow up
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        {l.clientId ? (
                          <span className="badge badge-green flex items-center gap-1"><Building2 className="size-3" />Client</span>
                        ) : l.stage !== "LOST" && (
                          <Button
                            variant="ghost" size="sm" className="h-7 px-2 text-primary-text"
                            onClick={() => { setConverting(l); setConvertEmail(l.email ?? ""); }}
                            title="Convert to client"
                          >
                            <UserPlus className="size-3.5" />Convert
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-foreground" onClick={() => openEdit(l)} title="Edit">
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => setDeleting(l)} title="Delete">
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / edit lead */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? `Edit lead — ${editing.company}` : "Add New Lead"}</DialogTitle></DialogHeader>
          <form onSubmit={submitForm} className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2"><Label>Company *</Label><Input value={form.companyName} onChange={setField("companyName")} placeholder="Acme Inc" required /></div>
              <div className="space-y-1.5"><Label>Contact name</Label><Input value={form.contactName} onChange={setField("contactName")} placeholder="John Doe" /></div>
              <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={setField("email")} placeholder="john@acme.com" /></div>
              <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={setField("phone")} placeholder="Optional" /></div>
              <div className="space-y-1.5"><Label>Source</Label><Input value={form.source} onChange={setField("source")} placeholder="Referral, website…" /></div>
              <div className="space-y-1.5"><Label>Service</Label><Input value={form.service} onChange={setField("service")} placeholder="e.g. Website redesign" /></div>
              <div className="space-y-1.5"><Label>Estimated value (₹)</Label><Input type="number" min={0} value={form.estimatedValue} onChange={setField("estimatedValue")} placeholder="0" /></div>
              <div className="space-y-1.5">
                <Label>Stage</Label>
                <select value={form.stage} onChange={setField("stage")} className={selectCls}>
                  {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Owner</Label>
                <select value={form.assignedTo} onChange={setField("assignedTo")} className={selectCls}>
                  <option value="">{editing ? "Unchanged" : "Me"}</option>
                  {staff?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Notes</Label>
                <textarea value={form.notes} onChange={setField("notes")} rows={3} placeholder="Call notes, requirements, next steps…" className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            </div>
            {saveMutation.isError && <p className="text-sm text-destructive">{saveMutation.error.message}</p>}
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving…" : editing ? "Save Changes" : "Create Lead"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Convert to client */}
      <Dialog open={!!converting} onOpenChange={(o) => !o && setConverting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Convert to client</DialogTitle></DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); if (converting) convertMutation.mutate({ id: converting.id, contactEmail: convertEmail.trim() }); }}
            className="space-y-4 pt-1"
          >
            <p className="text-sm text-muted-foreground">
              Creates a client record for <strong className="text-foreground">{converting?.company}</strong> and marks this lead as won.
              If a client with this email already exists, the lead is linked to it.
            </p>
            <div className="space-y-1.5">
              <Label>Client contact email *</Label>
              <Input type="email" value={convertEmail} onChange={(e) => setConvertEmail(e.target.value)} placeholder="contact@company.com" required />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConverting(null)}>Cancel</Button>
              <Button type="submit" disabled={convertMutation.isPending}>{convertMutation.isPending ? "Converting…" : "Convert"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete lead</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground pt-1">
            Delete <strong className="text-foreground">{deleting?.company}</strong>? This can&apos;t be undone.
          </p>
          <DialogFooter className="pt-4">
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleting && deleteMutation.mutate(deleting.id)}>
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
