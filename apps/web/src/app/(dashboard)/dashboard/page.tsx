"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FolderKanban, Target, Building2, IndianRupee,
  TrendingUp, TrendingDown, ArrowRight, Activity,
  CheckSquare, Clock, AlertTriangle, CalendarClock,
  Bell, Flame, WifiOff,
} from "lucide-react";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";
import { KpiDetails, type KpiKind } from "@/components/dashboard/KpiDetails";

function formatRevenue(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000)   return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)     return `₹${(n / 1000).toFixed(0)}K`;
  return `₹${n}`;
}

const STAGE_COLORS: Record<string, string> = {
  AWARENESS: "badge badge-gray", CONTACTED: "badge badge-blue",
  PROPOSAL: "badge badge-purple", NEGOTIATION: "badge badge-amber",
  WON: "badge badge-green", LOST: "badge badge-red",
};

const PRIORITY_COLORS: Record<string, string> = {
  HIGH: "priority-high", MEDIUM: "priority-medium", LOW: "priority-low",
};

const STATUS_LABEL: Record<string, string> = {
  BACKLOG: "Backlog", TO_DO: "To Do", IN_PROGRESS: "In Progress", REVIEW: "Review",
};

const STATUS_DOT: Record<string, string> = {
  BACKLOG: "bg-slate-400", TO_DO: "bg-blue-400", IN_PROGRESS: "bg-amber-400", REVIEW: "bg-purple-400",
};

// ── Personal dashboard ─────────────────────────────────────────────────────
function PersonalDashboard() {
  const user = useAuthStore((s) => s.user);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard-me"],
    queryFn: () => api<{
      myTasks: Array<{ id: string; title: string; status: string; priority: string; deadline?: string; projectId?: { projectName: string } }>;
      stats: { total: number; overdue: number; dueToday: number; weekHours: number; completedThisMonth: number; byStatus: Record<string, number> };
      recentNotifs: Array<{ _id: string; title: string; body: string; createdAt: string }>;
    }>("/dashboard/me"),
  });

  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

  if (isError) return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 text-center animate-fade-up">
      <div className="size-12 rounded-2xl bg-muted flex items-center justify-center">
        <WifiOff className="size-6 text-muted-foreground" />
      </div>
      <p className="font-semibold text-foreground">Could not load dashboard</p>
      <p className="text-sm text-muted-foreground">Check your connection or try refreshing the page.</p>
    </div>
  );

  if (isLoading || !data) return (
    <div className="space-y-6 animate-fade-up">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0,1,2,3].map(i => <SkeletonCard key={i} />)}
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card p-5 space-y-3">
          <Skeleton className="h-5 w-36" />
          {[0,1,2,3].map(i => <Skeleton key={i} className="h-6" />)}
        </div>
        <div className="card p-5 space-y-3">
          <Skeleton className="h-5 w-24" />
          {[0,1,2,3,4].map(i => <Skeleton key={i} className="h-10" />)}
        </div>
      </div>
    </div>
  );

  const { myTasks, stats, recentNotifs } = data;
  const overdueTasks = myTasks.filter((t) => t.deadline && new Date(t.deadline) < new Date());
  const upcomingTasks = myTasks.filter((t) => t.status !== "COMPLETED").slice(0, 6);

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Good {greeting}, {user?.name?.split(" ")[0]} 👋
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">{today}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border border-border/60 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <p className="text-sm font-medium text-muted-foreground">My Tasks</p>
              <div className="size-9 rounded-xl icon-bg-blue flex items-center justify-center shrink-0">
                <CheckSquare className="size-4" />
              </div>
            </div>
            <div className="text-3xl font-bold tabular-nums">{stats.total}</div>
            <p className="text-xs text-muted-foreground mt-1.5">Active assignments</p>
          </CardContent>
        </Card>

        <Card className="border border-border/60 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <p className="text-sm font-medium text-muted-foreground">Due Today</p>
              <div className="size-9 rounded-xl icon-bg-amber flex items-center justify-center shrink-0">
                <CalendarClock className="size-4" />
              </div>
            </div>
            <div className="text-3xl font-bold tabular-nums">{stats.dueToday}</div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {stats.overdue > 0
                ? <span className="text-red-500 font-semibold">{stats.overdue} overdue</span>
                : "All on schedule"}
            </p>
          </CardContent>
        </Card>

        <Card className="border border-border/60 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <p className="text-sm font-medium text-muted-foreground">Hours This Week</p>
              <div className="size-9 rounded-xl icon-bg-purple flex items-center justify-center shrink-0">
                <Clock className="size-4" />
              </div>
            </div>
            <div className="text-3xl font-bold tabular-nums">{stats.weekHours}h</div>
            <p className="text-xs text-muted-foreground mt-1.5">Time logged</p>
          </CardContent>
        </Card>

        <Card className="border border-border/60 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <p className="text-sm font-medium text-muted-foreground">Completed</p>
              <div className="size-9 rounded-xl icon-bg-green flex items-center justify-center shrink-0">
                <Flame className="size-4" />
              </div>
            </div>
            <div className="text-3xl font-bold tabular-nums">{stats.completedThisMonth}</div>
            <p className="text-xs text-muted-foreground mt-1.5">This month</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Status breakdown */}
        <Card className="border border-border/60 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[15px] font-semibold">Tasks by Status</CardTitle>
              <Link href="/tasks" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                Open board <ArrowRight className="size-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {stats.total === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No active tasks. 🎉</p>
            ) : (
              Object.keys(STATUS_LABEL).map((s) => {
                const count = stats.byStatus?.[s] || 0;
                const pct = stats.total ? Math.round((count / stats.total) * 100) : 0;
                return (
                  <div key={s} className="mb-3 last:mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`size-2 rounded-full ${STATUS_DOT[s]}`} />
                        <span className="text-sm text-foreground">{STATUS_LABEL[s]}</span>
                      </div>
                      <span className="text-sm font-semibold tabular-nums">{count}</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-700 ${STATUS_DOT[s]}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* My tasks list */}
        <Card className="border border-border/60 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[15px] font-semibold">My Tasks</CardTitle>
              <Link href="/tasks" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                View all <ArrowRight className="size-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {upcomingTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No tasks assigned. Enjoy the calm! 🎉</p>
            ) : (
              <div className="space-y-0.5">
                {upcomingTasks.map((t) => {
                  const isOverdue = t.deadline && new Date(t.deadline) < new Date();
                  return (
                    <Link key={t.id} href="/tasks" className="flex items-start gap-3 py-2.5 border-b border-border/40 last:border-0 hover:bg-muted/30 rounded transition-colors">
                      <span className={`badge mt-0.5 shrink-0 ${PRIORITY_COLORS[t.priority] || "badge-gray"}`}>{t.priority}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{t.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {(t.projectId as { projectName?: string })?.projectName || "—"}
                          {t.deadline && (
                            <span className={`ml-2 ${isOverdue ? "text-red-500 font-semibold" : ""}`}>
                              · {isOverdue ? "⚠ " : ""}{new Date(t.deadline).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                            </span>
                          )}
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Overdue alert */}
      {overdueTasks.length > 0 && (
        <Card className="border border-red-200 bg-red-50/50 dark:border-red-900/40 dark:bg-red-950/20 shadow-sm">
          <CardHeader className="pb-2 pt-4 px-5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-red-500" />
              <CardTitle className="text-[15px] font-semibold text-red-600 dark:text-red-400">
                {overdueTasks.length} Overdue {overdueTasks.length === 1 ? "Task" : "Tasks"}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            {overdueTasks.map((t) => (
              <Link key={t.id} href="/tasks" className="flex items-center gap-2 py-1.5 text-sm hover:underline">
                <span className="size-1.5 rounded-full bg-red-500 shrink-0" />
                <span className="font-medium text-foreground">{t.title}</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {new Date(t.deadline!).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Recent notifications */}
      {recentNotifs.length > 0 && (
        <Card className="border border-border/60 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="size-4 text-muted-foreground" />
                <CardTitle className="text-[15px] font-semibold">Recent Notifications</CardTitle>
              </div>
              <Link href="/notifications" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                View all <ArrowRight className="size-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5 space-y-0.5">
            {recentNotifs.slice(0, 5).map((n) => (
              <div key={n._id} className="flex items-start gap-3 py-2.5 border-b border-border/40 last:border-0">
                <div className="size-2 rounded-full bg-primary mt-1.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{n.title}</p>
                  {n.body && <p className="text-xs text-muted-foreground mt-0.5 truncate">{n.body}</p>}
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                  {new Date(n.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** A dashboard card that opens the list of records behind its number */
function KpiButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Show ${label.toLowerCase()}`}
      className="group text-left rounded-xl transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>div]:h-full [&>div]:group-hover:shadow-md"
    >
      {children}
    </button>
  );
}

// ── Admin dashboard ────────────────────────────────────────────────────────
function AdminDashboard() {
  const [details, setDetails] = useState<KpiKind | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<{
      kpis: Record<string, number>;
      leads: Array<{ company: string; service: string; estimatedValue: number; stage: string }>;
      teamWorkload: Array<{ name: string; initials: string; taskCount?: number; capacity?: number }>;
      activities: Array<{ date: string; userName: string; description: string; status: string }>;
    }>("/dashboard"),
  });

  if (isError) return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 text-center animate-fade-up">
      <div className="size-12 rounded-2xl bg-muted flex items-center justify-center">
        <WifiOff className="size-6 text-muted-foreground" />
      </div>
      <p className="font-semibold text-foreground">Could not load dashboard</p>
      <p className="text-sm text-muted-foreground">Check your connection or try refreshing the page.</p>
    </div>
  );

  if (isLoading || !data) return (
    <div className="space-y-6 animate-fade-up">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0,1,2,3].map(i => <SkeletonCard key={i} />)}
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card p-5 space-y-3">
          <Skeleton className="h-5 w-32" />
          {[0,1,2,3].map(i => <Skeleton key={i} className="h-12" />)}
        </div>
        <div className="card p-5 space-y-4">
          <Skeleton className="h-5 w-32" />
          {[0,1,2].map(i => <Skeleton key={i} className="h-10" />)}
        </div>
      </div>
    </div>
  );

  const { kpis, leads, teamWorkload, activities } = data;
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="space-y-6 animate-fade-up">
      {details && <KpiDetails kind={details} onClose={() => setDetails(null)} />}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-0.5">{today}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger">
        <KpiButton label="Active Projects" onClick={() => setDetails("projects")}>
          <Card className="border border-border/60 bg-card kpi-card-blue shadow-sm animate-fade-up">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <p className="text-sm font-medium text-muted-foreground">Active Projects</p>
                <div className="size-9 rounded-xl icon-bg-blue flex items-center justify-center shrink-0"><FolderKanban className="size-4" /></div>
              </div>
              <div className="text-3xl font-bold text-foreground tabular-nums">{kpis.activeProjects}</div>
              <p className="text-xs text-muted-foreground mt-1.5"><span className="text-emerald-600 font-semibold">{kpis.onTrack}</span> on track</p>
            </CardContent>
          </Card>
        </KpiButton>

        <KpiButton label="Open Leads" onClick={() => setDetails("leads")}>
          <Card className="border border-border/60 bg-card kpi-card-purple shadow-sm animate-fade-up">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <p className="text-sm font-medium text-muted-foreground">Open Leads</p>
                <div className="size-9 rounded-xl icon-bg-purple flex items-center justify-center shrink-0"><Target className="size-4" /></div>
              </div>
              <div className="text-3xl font-bold text-foreground tabular-nums">{kpis.openLeads}</div>
              <p className="text-xs text-muted-foreground mt-1.5"><span className="text-amber-600 font-semibold">{kpis.needFollowUp}</span> need follow-up</p>
            </CardContent>
          </Card>
        </KpiButton>

        <KpiButton label="Active Clients" onClick={() => setDetails("clients")}>
          <Card className="border border-border/60 bg-card kpi-card-green shadow-sm animate-fade-up">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <p className="text-sm font-medium text-muted-foreground">Active Clients</p>
                <div className="size-9 rounded-xl icon-bg-green flex items-center justify-center shrink-0"><Building2 className="size-4" /></div>
              </div>
              <div className="text-3xl font-bold text-foreground tabular-nums">{kpis.activeClients}</div>
              <p className="text-xs text-muted-foreground mt-1.5">With an active project</p>
            </CardContent>
          </Card>
        </KpiButton>

        <KpiButton label="Revenue (MTD)" onClick={() => setDetails("revenue")}>
          <Card className="border border-border/60 bg-card kpi-card-amber shadow-sm animate-fade-up">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <p className="text-sm font-medium text-muted-foreground">Revenue (MTD)</p>
                <div className="size-9 rounded-xl icon-bg-amber flex items-center justify-center shrink-0"><IndianRupee className="size-4" /></div>
              </div>
              <div className="text-3xl font-bold text-foreground tabular-nums">{formatRevenue(kpis.revenueMTD)}</div>
              <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                {kpis.revenueChange >= 0 ? <TrendingUp className="size-3 text-emerald-600" /> : <TrendingDown className="size-3 text-red-500" />}
                <span className={kpis.revenueChange >= 0 ? "text-emerald-600 font-semibold" : "text-red-500 font-semibold"}>
                  {kpis.revenueChange >= 0 ? "+" : ""}{kpis.revenueChange}%
                </span> vs last month
              </p>
            </CardContent>
          </Card>
        </KpiButton>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card className="border border-border/60 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[15px] font-semibold">Lead Pipeline</CardTitle>
              <Link href="/leads" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">View all <ArrowRight className="size-3" /></Link>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {leads.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No active leads</p>
            ) : (
              <div className="space-y-1">
                {leads.map((l, i) => (
                  <div key={`${l.company}-${i}`} className="flex justify-between items-center py-2.5 border-b border-border/40 last:border-0">
                    <div className="min-w-0 flex-1 mr-3">
                      <div className="font-medium text-sm truncate">{l.company}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{l.service} · {formatRevenue(l.estimatedValue)}</div>
                    </div>
                    <span className={STAGE_COLORS[l.stage] || "badge badge-gray"}>{l.stage.charAt(0) + l.stage.slice(1).toLowerCase()}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border border-border/60 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[15px] font-semibold">Team Workload</CardTitle>
              <Link href="/team" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">View all <ArrowRight className="size-3" /></Link>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="space-y-4">
              {teamWorkload.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No team members yet</p>}
              {teamWorkload.map((u) => {
                const pct = u.capacity ? Math.round(((u.taskCount || 0) / u.capacity) * 100) : 0;
                const capped = Math.min(pct, 100);
                const barColor = capped > 85 ? "bg-red-400" : capped > 65 ? "bg-amber-400" : "bg-emerald-400";
                return (
                  <div key={u.name}>
                    <div className="flex items-center gap-3 mb-1.5">
                      <div className="size-8 rounded-full bg-gradient-to-br from-primary/20 to-primary/40 border border-border/60 flex items-center justify-center text-xs font-bold text-primary-text shrink-0">{u.initials}</div>
                      <span className="text-sm font-medium flex-1">{u.name?.split(" ")[0]}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{u.taskCount ?? 0} open</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden ml-11">
                      <div className={`h-full ${barColor} rounded-full transition-all duration-700`} style={{ width: `${capped}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border border-border/60 shadow-sm">
        <CardHeader className="pb-3 pt-5 px-5">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-muted-foreground" />
            <CardTitle className="text-[15px] font-semibold">Recent Activity</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  <th className="text-left py-2.5 px-5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-24">Date</th>
                  <th className="text-left py-2.5 px-5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Description</th>
                  <th className="text-left py-2.5 px-5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-28">Status</th>
                </tr>
              </thead>
              <tbody>
                {activities.length === 0 && (
                  <tr><td colSpan={3} className="py-6 px-5 text-center text-sm text-muted-foreground">No activity yet</td></tr>
                )}
                {activities.map((a, i) => (
                  <tr key={i} className="border-b border-border/40 last:border-0 hover-row">
                    <td className="py-3 px-5 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(a.date).toLocaleDateString("en-IN", { month: "short", day: "numeric" })}
                    </td>
                    <td className="py-3 px-5 text-muted-foreground">{a.description}</td>
                    <td className="py-3 px-5"><span className="badge badge-gray">{a.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Route ──────────────────────────────────────────────────────────────────
const ADMIN_ROLES = ["SUPER_ADMIN", "MANAGEMENT", "PROJECT_MANAGER"];

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  return ADMIN_ROLES.includes(user.role) ? <AdminDashboard /> : <PersonalDashboard />;
}
