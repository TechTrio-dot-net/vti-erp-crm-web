"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { COORDINATION_ROLES, fmtDate } from "@/lib/crm";
import { CreateProjectDialog } from "@/components/projects/Workflow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Building2, Mail, Phone, ExternalLink, WifiOff, Search, Pencil, Trash2, FolderKanban, FolderPlus, Trophy, ListChecks } from "lucide-react";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

type Client = {
  id: string;
  companyName: string;
  contactName?: string;
  contactEmail: string | null;
  phone?: string | null;
  address?: string | null;
  portalLogin?: string;
  projectCount: number;
  activeProjectCount: number;
  /** Won CRM deals behind this client (closed leads become clients automatically) */
  fromCrm: boolean;
  dealValue: number;
  wonAt: string | null;
  bdmName: string | null;
  /** Production follow-ups not yet done across its projects */
  openSteps: number;
};

/** Roles that start projects from a client card */
const PROJECT_CREATORS = [...COORDINATION_ROLES, "SUPER_ADMIN", "MANAGEMENT", "PROJECT_MANAGER"];

const FILTERS = [
  { key: "all",      label: "All clients" },
  { key: "crm",      label: "Won in CRM" },
  { key: "awaiting", label: "Awaiting project" },
] as const;

type ClientForm = { companyName: string; contactName: string; contactEmail: string; phone: string; address: string };
const EMPTY_FORM: ClientForm = { companyName: "", contactName: "", contactEmail: "", phone: "", address: "" };

const HUE_PALETTE = [200, 230, 160, 280, 30, 340, 50, 100];
function avatarColor(name: string) {
  return `hsl(${HUE_PALETTE[name.charCodeAt(0) % HUE_PALETTE.length]} 55% 40%)`;
}

function fmt(n: number) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
}

export default function ClientsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState<ClientForm>(EMPTY_FORM);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [projectFor, setProjectFor] = useState<Client | null>(null);
  const role = useAuthStore((st) => st.user?.role ?? "");
  const canCreateProject = PROJECT_CREATORS.includes(role);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["clients"],
    queryFn: () => api<Client[]>("/clients"),
  });

  const saveMutation = useMutation({
    mutationFn: (body: object) =>
      editing
        ? api(`/clients/${editing.id}`, { method: "PUT", body: JSON.stringify(body) })
        : api("/clients", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success(editing ? "Client updated" : "Client added");
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setFormOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/clients/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Client deleted");
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setDeleting(null);
    },
    onError: (err: Error) => {
      toast.error("Couldn't delete client", { description: err.message });
      setDeleting(null);
    },
  });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter(
      (c) =>
        (filter === "all" || (filter === "crm" && c.fromCrm) || (filter === "awaiting" && c.fromCrm && c.projectCount === 0)) &&
        (!q || [c.companyName, c.contactName, c.contactEmail, c.phone].some((v) => v?.toLowerCase().includes(q)))
    );
  }, [data, search, filter]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    saveMutation.reset();
    setFormOpen(true);
  };

  const openEdit = (c: Client) => {
    setEditing(c);
    setForm({ companyName: c.companyName, contactName: c.contactName ?? "", contactEmail: c.contactEmail ?? "", phone: c.phone ?? "", address: c.address ?? "" });
    saveMutation.reset();
    setFormOpen(true);
  };

  const setField = (field: keyof ClientForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  if (isError) return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 text-center animate-fade-up">
      <div className="size-12 rounded-2xl bg-muted flex items-center justify-center">
        <WifiOff className="size-6 text-muted-foreground" />
      </div>
      <p className="font-semibold text-foreground">Could not load clients</p>
      <p className="text-sm text-muted-foreground">Check your connection or try refreshing.</p>
    </div>
  );

  if (isLoading || !data) return (
    <div className="page space-y-6">
      <div className="page-header">
        <div className="space-y-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-44" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[0,1,2,3,4,5].map(i => <SkeletonCard key={i} />)}
      </div>
    </div>
  );

  const crmCount = data.filter((c) => c.fromCrm).length;
  const awaitingCount = data.filter((c) => c.fromCrm && c.projectCount === 0).length;

  return (
    <div className="page space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Client Directory</h1>
          <p className="page-subtitle">
            {data.length} client{data.length !== 1 ? "s" : ""} · {crmCount} won in CRM
            {awaitingCount > 0 && <> · <span className="text-amber-600 font-semibold">{awaitingCount} awaiting a project</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-64 max-w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients…" className="h-9 pl-9" />
          </div>
          <Button onClick={openCreate}><Plus className="size-4" />Add Client</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter clients">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 h-8 rounded-lg text-xs font-semibold border transition-colors ${filter === f.key ? "border-primary bg-primary/10 text-primary-text" : "border-input text-muted-foreground hover:text-foreground"}`}
          >
            {f.label}
            {f.key === "crm" && ` (${crmCount})`}
            {f.key === "awaiting" && ` (${awaitingCount})`}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon"><Building2 className="size-6 text-muted-foreground" /></div>
            <p className="font-semibold">{data.length ? "No clients match" : "No clients yet"}</p>
            {!data.length && (
              <>
                <p className="text-sm text-muted-foreground mt-1 mb-4">Leads closed as won in the CRM appear here automatically</p>
                <Button onClick={openCreate}><Plus className="size-4" />Add Client</Button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
          {visible.map((c) => (
            <div key={c.id} className="card card-lift animate-fade-up p-5 flex flex-col gap-4">
              <div className="flex items-start gap-4">
                <div
                  className="size-12 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0"
                  style={{ background: avatarColor(c.companyName) }}
                >
                  {c.companyName.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground truncate">{c.companyName}</p>
                  {c.contactName && <p className="text-sm text-muted-foreground truncate mt-0.5">{c.contactName}</p>}
                  {c.fromCrm && (
                    <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300 px-1.5 py-0.5 text-[11px] font-semibold">
                      <Trophy className="size-3" />Won {c.wonAt ? fmtDate(c.wonAt) : ""}{c.bdmName ? ` · ${c.bdmName}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex items-center shrink-0 -mr-2 -mt-1">
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-foreground" onClick={() => openEdit(c)} title="Edit">
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => setDeleting(c)} title="Delete">
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-muted/40 rounded-lg py-2">
                  <p className="text-sm font-bold tabular-nums flex items-center justify-center gap-1"><FolderKanban className="size-3 text-muted-foreground" />{c.projectCount}</p>
                  <p className="text-[11px] text-muted-foreground">{c.activeProjectCount} active</p>
                </div>
                <div className="bg-muted/40 rounded-lg py-2">
                  <p className="text-sm font-bold tabular-nums">{c.fromCrm ? fmt(c.dealValue) : "—"}</p>
                  <p className="text-[11px] text-muted-foreground">deal value</p>
                </div>
                <div className="bg-muted/40 rounded-lg py-2">
                  <p className={`text-sm font-bold tabular-nums flex items-center justify-center gap-1 ${c.openSteps > 0 ? "text-amber-600" : ""}`}><ListChecks className="size-3 text-muted-foreground" />{c.openSteps}</p>
                  <p className="text-[11px] text-muted-foreground">open follow-ups</p>
                </div>
              </div>

              <div className="space-y-2 pt-3 border-t border-border/50">
                {c.contactEmail && (
                  <a href={`mailto:${c.contactEmail}`} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                    <Mail className="size-3.5 shrink-0" />
                    <span className="truncate">{c.contactEmail}</span>
                  </a>
                )}
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                    <Phone className="size-3.5 shrink-0" />
                    <span className="truncate">{c.phone}</span>
                  </a>
                )}
                {c.portalLogin && (
                  <div className="flex items-center gap-2 text-sm">
                    <ExternalLink className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="text-primary-text font-medium truncate">{c.portalLogin}</span>
                  </div>
                )}
              </div>

              {canCreateProject && (
                <Button
                  variant={c.fromCrm && c.projectCount === 0 ? "default" : "outline"}
                  size="sm"
                  className="mt-auto"
                  onClick={() => setProjectFor(c)}
                >
                  <FolderPlus className="size-4" />Create project
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <CreateProjectDialog client={projectFor} onClose={() => setProjectFor(null)} />

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? `Edit client — ${editing.companyName}` : "Add Client"}</DialogTitle></DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveMutation.mutate({
                companyName: form.companyName.trim(),
                contactName: form.contactName.trim() || form.companyName.trim(),
                contactEmail: form.contactEmail.trim() || null,
                phone: form.phone.trim() || null,
                address: form.address.trim() || null,
              });
            }}
            className="space-y-3 pt-1"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2"><Label>Company name *</Label><Input value={form.companyName} onChange={setField("companyName")} placeholder="Acme Inc" required /></div>
              <div className="space-y-1.5"><Label>Contact name</Label><Input value={form.contactName} onChange={setField("contactName")} placeholder="John Doe" /></div>
              <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.contactEmail} onChange={setField("contactEmail")} placeholder="john@acme.com" /></div>
              <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={setField("phone")} placeholder="Email or phone is required" /></div>
              <div className="space-y-1.5"><Label>Address</Label><Input value={form.address} onChange={setField("address")} placeholder="Optional" /></div>
            </div>
            {saveMutation.isError && <p className="text-sm text-destructive">{saveMutation.error.message}</p>}
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving…" : editing ? "Save Changes" : "Add Client"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete client</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground pt-1">
            Delete <strong className="text-foreground">{deleting?.companyName}</strong>?
            {deleting && deleting.projectCount > 0 && " This client has projects — remove or reassign those first."}
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
