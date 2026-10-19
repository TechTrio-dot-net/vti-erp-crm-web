"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock, FolderKanban, FolderPlus, Hourglass, IndianRupee, Timer, Trophy, XCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { compactInr, fmtDate, inr, isCoordination, isCrmAdmin } from "@/lib/crm";
import { useCrmUi } from "@/store/crm";
import { Button } from "@/components/ui/button";
import { DataTable, ErrorState, LoadingBlock, PageHeader, StatCard } from "@/components/crm/ui";
import { CreateProjectDialog, STATUS_META, WORKFLOW_STEPS, WorkflowChips, type WorkflowStep } from "@/components/projects/Workflow";

type Dashboard = {
  totals: {
    clients: number; crmClients: number; wonThisMonth: number; wonValueThisMonth: number; lostThisMonth: number;
    activeProjects: number; onHoldProjects: number; completedProjects: number; overdueProjects: number;
  };
  steps: Array<{ key: string; label: string; pending: number; inProgress: number; done: number }>;
  awaitingProject: Array<{ id: string; companyName: string; phone: string | null; dealValue: number; wonAt: string | null; bdmName: string | null }>;
  production: Array<{ id: string; projectName: string; clientName: string; projectStatus: string; endDate: string | null; workflow: WorkflowStep[] }>;
  recentWon: Array<{ id: string; name: string; service: string | null; value: number | null; closedAt: string; bdmName: string | null }>;
  bdmHours: Array<{ userId: string; name: string; minutes: number }>;
};

const hours = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;

export default function CoordinationDashboardPage() {
  const router = useRouter();
  const role = useAuthStore((s) => s.user?.role);
  const openLead = useCrmUi((s) => s.openLead);
  const [projectFor, setProjectFor] = useState<{ id: string; companyName: string } | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["coordination", "dashboard"],
    queryFn: () => api<Dashboard>("/coordination/dashboard"),
    refetchInterval: 60_000,
  });
  // The four CRM reports coordination can open (admins see them too)
  const showReports = isCoordination(role) || isCrmAdmin(role);

  if (isError) return <div className="page"><ErrorState message="Could not load the dashboard" /></div>;
  if (isLoading || !data) return <div className="page space-y-5"><PageHeader title="Dashboard" /><LoadingBlock rows={8} /></div>;

  const t = data.totals;
  const steps = WORKFLOW_STEPS.map((s) => data.steps.find((x) => x.key === s.key) ?? { key: s.key, label: s.label, pending: 0, inProgress: 0, done: 0 });
  const maxBdm = Math.max(1, ...data.bdmHours.map((b) => b.minutes));

  return (
    <div className="page space-y-6">
      <PageHeader title="Dashboard" subtitle="Won clients, their projects and every production follow-up in one place">
        <Button variant="outline" onClick={() => router.push("/clients")}><FolderPlus className="size-4" />Clients</Button>
        <Button onClick={() => router.push("/projects")}><FolderKanban className="size-4" />Projects</Button>
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Won this month" value={t.wonThisMonth} sub={compactInr(t.wonValueThisMonth)} tone="green" icon={Trophy} />
        <StatCard label="Awaiting a project" value={data.awaitingProject.length} sub="Won clients with no project" tone="amber" icon={Hourglass} />
        <StatCard label="Active projects" value={t.activeProjects} sub={`${t.onHoldProjects} on hold · ${t.completedProjects} completed`} tone="blue" icon={FolderKanban} />
        <StatCard label="Past delivery date" value={t.overdueProjects} sub="Open projects" tone="red" icon={AlertTriangle} />
        <StatCard label="Lost this month" value={t.lostThisMonth} sub={`${t.crmClients} of ${t.clients} clients came from CRM`} tone="purple" icon={XCircle} />
      </div>

      {/* Follow-up pipeline */}
      <div className="card p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <p className="text-[15px] font-semibold">Production follow-ups</p>
            <p className="text-xs text-muted-foreground">Open projects only — completed projects are not counted</p>
          </div>
          {(Object.keys(STATUS_META) as Array<keyof typeof STATUS_META>).map((k) => (
            <span key={k} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`size-2.5 rounded-sm ${STATUS_META[k].dot}`} />{STATUS_META[k].label}
            </span>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {steps.map((s) => {
            const Icon = WORKFLOW_STEPS.find((w) => w.key === s.key)!.icon;
            const total = s.pending + s.inProgress + s.done;
            return (
              <div key={s.key} className="rounded-xl border border-border/60 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Icon className="size-4 text-muted-foreground" />
                  <p className="font-semibold text-sm flex-1">{s.label}</p>
                  <span className="text-xs text-muted-foreground tabular-nums">{total} open project{total === 1 ? "" : "s"}</span>
                </div>
                <div className="flex h-2.5 rounded-full overflow-hidden bg-muted" role="img" aria-label={`${s.label}: ${s.done} done, ${s.inProgress} in progress, ${s.pending} pending`}>
                  {total > 0 && (
                    <>
                      <div className={STATUS_META.DONE.dot} style={{ width: `${(s.done / total) * 100}%` }} />
                      <div className={STATUS_META.IN_PROGRESS.dot} style={{ width: `${(s.inProgress / total) * 100}%` }} />
                    </>
                  )}
                </div>
                <div className="grid grid-cols-3 text-center text-xs">
                  <div><p className="text-lg font-bold tabular-nums">{s.pending}</p><p className="text-muted-foreground">Pending</p></div>
                  <div><p className="text-lg font-bold tabular-nums text-amber-600">{s.inProgress}</p><p className="text-muted-foreground">In progress</p></div>
                  <div><p className="text-lg font-bold tabular-nums text-emerald-600">{s.done}</p><p className="text-muted-foreground">Done</p></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <DataTable
          title="Won clients awaiting a project"
          rows={data.awaitingProject}
          empty="Every won client has a project"
          columns={[
            { key: "companyName", label: "Client", className: "font-semibold" },
            { key: "wonAt", label: "Won", render: (r) => fmtDate(r.wonAt) },
            { key: "bdmName", label: "BDM" },
            { key: "dealValue", label: "Value", align: "right", render: (r) => inr(r.dealValue) },
            {
              key: "action", label: "", align: "right",
              render: (r) => (
                <Button size="sm" onClick={() => setProjectFor({ id: r.id, companyName: r.companyName })}>
                  <FolderPlus className="size-3.5" />Create project
                </Button>
              ),
            },
          ]}
        />

        <DataTable
          title="In production"
          rows={data.production}
          empty="No open projects"
          onRowClick={(r) => router.push(`/projects/${r.id}`)}
          columns={[
            { key: "projectName", label: "Project", className: "font-semibold", render: (r) => (
              <div>
                <p>{r.projectName}</p>
                <p className="text-xs text-muted-foreground font-normal">{r.clientName}{r.projectStatus === "ON_HOLD" ? " · On hold" : ""}</p>
              </div>
            ) },
            { key: "workflow", label: "Follow-ups", render: (r) => r.workflow.length ? <WorkflowChips steps={r.workflow} /> : <span className="text-xs text-muted-foreground">No steps</span> },
            { key: "endDate", label: "Delivery", align: "right", render: (r) => {
              const late = r.endDate && new Date(r.endDate) < new Date();
              return <span className={late ? "text-destructive font-semibold" : undefined}>{fmtDate(r.endDate)}</span>;
            } },
          ]}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <DataTable
            title="Recently closed deals"
            rows={data.recentWon}
            empty="No won leads yet"
            onRowClick={(r) => openLead(r.id)}
            columns={[
              { key: "closedAt", label: "Closed", render: (r) => fmtDate(r.closedAt) },
              { key: "name", label: "Lead", className: "font-semibold" },
              { key: "service", label: "Service" },
              { key: "bdmName", label: "BDM" },
              { key: "value", label: "Value", align: "right", render: (r) => inr(r.value) },
            ]}
          />
        </div>

        <div className="card">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-border/50">
            <Timer className="size-4 text-muted-foreground" />
            <p className="text-[15px] font-semibold flex-1">BDM hours · last 7 days</p>
          </div>
          {data.bdmHours.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No BDM sessions this week</p>
          ) : (
            <ul className="p-5 space-y-3">
              {data.bdmHours.map((b) => (
                <li key={b.userId} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{b.name}</span>
                    <span className="tabular-nums text-muted-foreground">{hours(b.minutes)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${(b.minutes / maxBdm) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {showReports && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { href: "/crm/closed",        label: "Closed Lead Report",    icon: CheckCircle2 },
            { href: "/crm/bdm-time",      label: "BDM Time Analysis",     icon: Clock },
            { href: "/crm-admin/lost",    label: "Lost Leads Report",     icon: XCircle },
            { href: "/crm-admin/targets", label: "Weekly Target Summary", icon: IndianRupee },
          ].map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="card card-lift p-4 flex items-center gap-3 text-sm font-semibold">
              <Icon className="size-4 text-muted-foreground" />
              <span className="flex-1">{label}</span>
              <ArrowRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}

      <CreateProjectDialog client={projectFor} onClose={() => setProjectFor(null)} />
    </div>
  );
}
