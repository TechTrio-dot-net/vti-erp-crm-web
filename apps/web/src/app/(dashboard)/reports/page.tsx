"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, Users, Clock, TrendingUp } from "lucide-react";

type ProjectProgress = Array<{
  projectId: string;
  projectName: string;
  client?: { companyName?: string };
  totalTasks: number;
  completedTasks: number;
  progress: number;
  status: string;
}>;

type TeamProductivity = Array<{
  userId: string;
  name: string;
  initials?: string;
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  completionRate: number;
}>;

type TimeReport = {
  entries: Array<{
    id: string;
    date: string;
    minutes: number;
    userId?: { name: string };
    projectId?: { projectName: string };
    taskId?: { title: string };
  }>;
  totalMinutes: number;
  totalHours: number;
};

const HUE = [200, 230, 160, 280, 30, 340, 50, 100];
function avatarHue(name: string) {
  return `hsl(${HUE[name.charCodeAt(0) % HUE.length]} 55% 42%)`;
}

function fmtMins(m: number) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}

export default function ReportsPage() {
  const { data: projectData, isLoading: loadingProjects } = useQuery({
    queryKey: ["reports", "project-progress"],
    queryFn: () => api<ProjectProgress>("/reports/project-progress"),
  });

  const { data: teamData, isLoading: loadingTeam } = useQuery({
    queryKey: ["reports", "team-productivity"],
    queryFn: () => api<TeamProductivity>("/reports/team-productivity"),
  });

  const { data: timeData, isLoading: loadingTime } = useQuery({
    queryKey: ["reports", "time-tracking"],
    queryFn: () => api<TimeReport>("/reports/time-tracking"),
  });

  return (
    <div className="page space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">Project progress, team productivity, and time tracking insights</p>
        </div>
      </div>

      <Tabs defaultValue="projects" className="space-y-5">
        <TabsList className="h-10 p-1 rounded-xl bg-muted/60 border border-border/50">
          <TabsTrigger value="projects" className="gap-1.5 text-sm rounded-lg">
            <BarChart3 className="size-3.5" />Projects
          </TabsTrigger>
          <TabsTrigger value="team" className="gap-1.5 text-sm rounded-lg">
            <Users className="size-3.5" />Team
          </TabsTrigger>
          <TabsTrigger value="time" className="gap-1.5 text-sm rounded-lg">
            <Clock className="size-3.5" />Time
          </TabsTrigger>
        </TabsList>

        {/* ── Projects tab ── */}
        <TabsContent value="projects" className="mt-0">
          {loadingProjects ? (
            <div className="flex items-center justify-center gap-3 text-muted-foreground py-16">
              <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">Loading projects…</span>
            </div>
          ) : !projectData?.length ? (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-icon"><BarChart3 className="size-6 text-muted-foreground" /></div>
                <p className="font-semibold">No project data yet</p>
                <p className="text-sm text-muted-foreground mt-1">Create projects and tasks to see progress here</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 stagger">
              {projectData.map((p) => {
                const pct = Math.round(p.progress ?? 0);
                const statusColor = p.status === "COMPLETED" ? "badge-green" : p.status === "ON_HOLD" ? "badge-amber" : "badge-blue";
                return (
                  <div key={p.projectId} className="card animate-fade-up p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground truncate">{p.projectName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {(p.client as { companyName?: string })?.companyName || "No client"}
                        </p>
                      </div>
                      <span className={`badge ${statusColor} ml-2 shrink-0`}>{p.status}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className="text-muted-foreground">{p.completedTasks} / {p.totalTasks} tasks</span>
                      <span className="font-bold text-primary-text tabular-nums">{pct}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Team tab ── */}
        <TabsContent value="team" className="mt-0">
          {loadingTeam ? (
            <div className="flex items-center justify-center gap-3 text-muted-foreground py-16">
              <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">Loading team…</span>
            </div>
          ) : !teamData?.length ? (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-icon"><Users className="size-6 text-muted-foreground" /></div>
                <p className="font-semibold">No team data yet</p>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Completed</th>
                      <th>In Progress</th>
                      <th>Total</th>
                      <th>Completion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamData.map((u) => (
                      <tr key={u.userId}>
                        <td>
                          <div className="flex items-center gap-3">
                            <div
                              className="avatar avatar-sm text-white font-bold"
                              style={{ background: avatarHue(u.name) }}
                            >
                              {u.initials || u.name?.slice(0, 2)?.toUpperCase() || "?"}
                            </div>
                            <span className="font-semibold">{u.name}</span>
                          </div>
                        </td>
                        <td><span className="badge badge-green">{u.completedTasks}</span></td>
                        <td><span className="badge badge-blue">{u.inProgressTasks}</span></td>
                        <td className="text-muted-foreground">{u.totalTasks}</td>
                        <td>
                          <div className="flex items-center gap-3">
                            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden min-w-[80px]">
                              <div
                                className="h-full rounded-full bg-primary transition-all"
                                style={{ width: `${u.completionRate}%` }}
                              />
                            </div>
                            <span className="text-sm font-bold tabular-nums text-primary-text w-10 text-right">{u.completionRate}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── Time tab ── */}
        <TabsContent value="time" className="mt-0 space-y-4">
          {loadingTime ? (
            <div className="flex items-center justify-center gap-3 text-muted-foreground py-16">
              <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">Loading time data…</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 stagger">
                <div className="card animate-fade-up kpi-blue p-5">
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-[13px] font-medium text-muted-foreground">Total Tracked</p>
                    <div className="icon-chip size-9 icon-chip-blue"><Clock className="size-4" /></div>
                  </div>
                  <div className="text-3xl font-bold tabular-nums">{timeData?.totalHours ?? 0}h</div>
                  <p className="text-xs text-muted-foreground mt-1">{fmtMins(timeData?.totalMinutes ?? 0)} total</p>
                </div>
                <div className="card animate-fade-up kpi-green p-5">
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-[13px] font-medium text-muted-foreground">Entries</p>
                    <div className="icon-chip size-9 icon-chip-green"><TrendingUp className="size-4" /></div>
                  </div>
                  <div className="text-3xl font-bold tabular-nums">{timeData?.entries?.length ?? 0}</div>
                  <p className="text-xs text-muted-foreground mt-1">recorded sessions</p>
                </div>
                <div className="card animate-fade-up kpi-amber p-5 col-span-2 lg:col-span-1">
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-[13px] font-medium text-muted-foreground">Avg. per Entry</p>
                    <div className="icon-chip size-9 icon-chip-amber"><Clock className="size-4" /></div>
                  </div>
                  <div className="text-3xl font-bold tabular-nums">
                    {(timeData?.entries?.length ?? 0) > 0
                      ? fmtMins(Math.round((timeData?.totalMinutes ?? 0) / timeData!.entries.length))
                      : "—"}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">per tracked session</p>
                </div>
              </div>

              <div className="card">
                <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
                  <p className="text-[15px] font-semibold">Recent Entries</p>
                  {(timeData?.entries?.length ?? 0) > 0 && (
                    <span className="badge badge-gray">{timeData!.entries.length} total</span>
                  )}
                </div>
                {!timeData?.entries?.length ? (
                  <div className="empty-state">
                    <div className="empty-state-icon"><Clock className="size-6 text-muted-foreground" /></div>
                    <p className="font-semibold">No time entries yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead>
                        <tr><th>Task</th><th>Project</th><th>Member</th><th>Duration</th><th>Date</th></tr>
                      </thead>
                      <tbody>
                        {timeData.entries.slice(0, 20).map((e) => (
                          <tr key={e.id}>
                            <td className="font-semibold">{(e.taskId as { title?: string })?.title || "—"}</td>
                            <td className="text-muted-foreground">{(e.projectId as { projectName?: string })?.projectName || "—"}</td>
                            <td className="text-muted-foreground">{(e.userId as { name?: string })?.name || "—"}</td>
                            <td><span className="badge badge-blue">{fmtMins(e.minutes)}</span></td>
                            <td className="text-muted-foreground">
                              {new Date(e.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
