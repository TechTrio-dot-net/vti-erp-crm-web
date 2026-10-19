"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { Users, ChevronRight, CheckSquare } from "lucide-react";

type TeamMember = { id: string; name: string; initials?: string; taskCount?: number; role?: string };

const HUE_PALETTE = [200, 230, 160, 280, 30, 340, 50, 100];
function avatarBg(name: string) {
  return `hsl(${HUE_PALETTE[name.charCodeAt(0) % HUE_PALETTE.length]} 55% 40%)`;
}

export default function TeamWorkloadPage() {
  const { data: dashboardData, isLoading } = useQuery({
    queryKey: ["dashboard", "team"],
    queryFn: () => api<{ teamWorkload: TeamMember[] }>("/dashboard/team"),
  });

  const team = dashboardData?.teamWorkload || [];
  const maxTasks = Math.max(...team.map((u) => u.taskCount ?? 0), 1);

  if (isLoading) return (
    <div className="flex items-center justify-center gap-3 text-muted-foreground py-20">
      <div className="size-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <span className="text-sm">Loading team…</span>
    </div>
  );

  return (
    <div className="page space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Team Workload</h1>
          <p className="page-subtitle">Monitor task distribution across your team</p>
        </div>
      </div>

      {team.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon"><Users className="size-6 text-muted-foreground" /></div>
            <p className="font-semibold">No team members</p>
            <p className="text-sm text-muted-foreground mt-1">Team workload will appear once tasks are assigned</p>
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
          {team.map((u) => {
            const pct = Math.round(((u.taskCount ?? 0) / maxTasks) * 100);
            const barColor = pct > 80 ? "bg-red-400" : pct > 55 ? "bg-amber-400" : "bg-emerald-400";
            return (
              <Link key={u.id} href={`/team/${u.id}`}>
                <div className="card card-lift animate-fade-up p-5 cursor-pointer h-full">
                  <div className="flex items-center gap-4 mb-4">
                    <div
                      className="size-12 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0"
                      style={{ background: avatarBg(u.name) }}
                    >
                      {u.initials || u.name.slice(0,2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground truncate">{u.name}</p>
                      {u.role && <p className="text-xs text-muted-foreground mt-0.5 capitalize">{u.role.replace(/_/g, " ")}</p>}
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <CheckSquare className="size-3.5" />
                        <span>{u.taskCount ?? 0} active tasks</span>
                      </div>
                      <span className="text-xs font-semibold text-muted-foreground">{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full ${barColor} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
