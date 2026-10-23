"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { stageMeta } from "@/lib/crm";
import { useCrmUi } from "@/store/crm";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type KpiKind = "projects" | "leads" | "clients" | "revenue";

type ProjectRow = { id: string; name: string; client: string; status: string; endDate: string | null };
type LeadRow = {
  id: string; company: string; contact: string | null; phone: string | null; stage: string; owner: string | null;
  lastContactAt: string | null; createdAt: string; value: number | null; needsFollowUp: boolean;
};
type ClientRow = { id: string; company: string; contact: string; phone: string | null; email: string | null; activeProjects: number };
type RevenueRow = { id: string; number: string; client: string | null; paidAt: string; total: number };

const TITLES: Record<KpiKind, { title: string; empty: string; all?: { href: string; label: string } }> = {
  projects: { title: "Active projects", empty: "No active or on-hold projects.", all: { href: "/projects", label: "All projects" } },
  leads: { title: "Open leads", empty: "No open leads.", all: { href: "/crm/leads", label: "All leads" } },
  clients: { title: "Active clients", empty: "No clients with an active project.", all: { href: "/clients", label: "All clients" } },
  revenue: { title: "Revenue this month", empty: "No invoices paid this month yet." },
};

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
const rupees = (n: number | null) => (n ? `₹${Math.round(n).toLocaleString("en-IN")}` : "—");

/** The records behind a dashboard card, from the same filters the card counts with */
export function KpiDetails({ kind, onClose }: { kind: KpiKind; onClose: () => void }) {
  const meta = TITLES[kind];
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard", "details", kind],
    queryFn: () => api<{ rows: unknown[] }>(`/dashboard/details/${kind}`),
  });
  const rows = data?.rows ?? [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {meta.title}
            {data && <span className="ml-2 text-sm font-normal text-muted-foreground">{rows.length}{rows.length >= 500 ? "+" : ""}</span>}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6"><Loader2 className="size-4 animate-spin" />Loading…</div>
          ) : isError ? (
            <p className="text-sm text-red-600 py-6">{(error as Error).message}</p>
          ) : !rows.length ? (
            <p className="text-sm text-muted-foreground py-6">{meta.empty}</p>
          ) : kind === "projects" ? (
            <ProjectList rows={rows as ProjectRow[]} />
          ) : kind === "leads" ? (
            <LeadList rows={rows as LeadRow[]} backTo={meta.title} />
          ) : kind === "clients" ? (
            <ClientList rows={rows as ClientRow[]} />
          ) : (
            <RevenueList rows={rows as RevenueRow[]} />
          )}
        </div>
        {meta.all && (
          <div className="pt-3 border-t border-border/60">
            <Link href={meta.all.href} onClick={onClose} className="text-sm text-primary-text hover:underline inline-flex items-center gap-1">
              {meta.all.label} <ArrowRight className="size-3.5" />
            </Link>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const rowClass = "w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/60 transition-colors";

function ProjectList({ rows }: { rows: ProjectRow[] }) {
  return (
    <div className="divide-y divide-border/40">
      {rows.map((p) => (
        <Link key={p.id} href={`/projects/${p.id}`} className={rowClass}>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{p.name}</p>
            <p className="text-xs text-muted-foreground truncate">{p.client}{p.endDate && ` · due ${day(p.endDate)}`}</p>
          </div>
          <span className={`badge ${p.status === "ACTIVE" ? "badge-green" : "badge-amber"}`}>{p.status === "ACTIVE" ? "On track" : "On hold"}</span>
        </Link>
      ))}
    </div>
  );
}

function LeadList({ rows, backTo }: { rows: LeadRow[]; backTo: string }) {
  const openLead = useCrmUi((s) => s.openLead);
  return (
    <div className="divide-y divide-border/40">
      {/* The list stays open behind the lead, so the drawer's Back comes straight back to it */}
      {rows.map((l) => (
        <button key={l.id} type="button" className={rowClass} onClick={() => openLead(l.id, backTo)}>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{l.company}</p>
            <p className="text-xs text-muted-foreground truncate">
              {[l.contact, l.phone, l.owner ?? "Unassigned"].filter(Boolean).join(" · ")}
              {" · last contact "}{l.lastContactAt ? day(l.lastContactAt) : "never"}
            </p>
          </div>
          {l.needsFollowUp && <span className="badge badge-amber">Needs follow-up</span>}
          <span className="text-xs tabular-nums text-muted-foreground w-20 text-right">{rupees(l.value)}</span>
          <span className={`badge ${stageMeta(l.stage).badge}`}>{stageMeta(l.stage).label}</span>
        </button>
      ))}
    </div>
  );
}

function ClientList({ rows }: { rows: ClientRow[] }) {
  return (
    <div className="divide-y divide-border/40">
      {rows.map((c) => (
        <div key={c.id} className="flex items-center gap-3 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{c.company}</p>
            <p className="text-xs text-muted-foreground truncate">{[c.contact, c.phone, c.email].filter(Boolean).join(" · ")}</p>
          </div>
          <span className="text-xs text-muted-foreground">{c.activeProjects} active project{c.activeProjects === 1 ? "" : "s"}</span>
        </div>
      ))}
    </div>
  );
}

function RevenueList({ rows }: { rows: RevenueRow[] }) {
  const total = rows.reduce((sum, r) => sum + (r.total || 0), 0);
  return (
    <div>
      <div className="divide-y divide-border/40">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{r.number}</p>
              <p className="text-xs text-muted-foreground truncate">{r.client ?? "—"} · paid {day(r.paidAt)}</p>
            </div>
            <span className="text-sm font-semibold tabular-nums">{rupees(r.total)}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-between px-3 pt-3 mt-1 border-t border-border/60 text-sm font-semibold">
        <span>Total</span><span className="tabular-nums">{rupees(total)}</span>
      </div>
    </div>
  );
}
