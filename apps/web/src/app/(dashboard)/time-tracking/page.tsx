"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Clock, ArrowRight, Timer, CalendarDays } from "lucide-react";

type TimeEntry = {
  id: string; totalMinutes: number; startTime: string; endTime: string;
  notes?: string;
  taskId?: { title: string };
  projectId?: { projectName: string };
};

function fmtDuration(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function TimeTrackingPage() {
  const { data: entries, isLoading } = useQuery({
    queryKey: ["time-entries"],
    queryFn: () => api<TimeEntry[]>("/time-entries"),
  });

  const totalMinutes = (entries || []).reduce((s, e) => s + e.totalMinutes, 0);
  const todayEntries = (entries || []).filter((e) => {
    const d = new Date(e.startTime);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  });
  const todayMinutes = todayEntries.reduce((s, e) => s + e.totalMinutes, 0);

  return (
    <div className="page space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Time Tracking</h1>
          <p className="page-subtitle">Timer auto-starts when you move tasks to In Progress on the board</p>
        </div>
        <Link href="/tasks">
          <Button variant="outline">
            Go to Tasks <ArrowRight className="size-4" />
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 stagger">
        <div className="card animate-fade-up kpi-blue p-5">
          <div className="flex items-start justify-between mb-3">
            <p className="text-[13px] font-medium text-muted-foreground">Total Logged</p>
            <div className="icon-chip size-9 icon-chip-blue"><Clock className="size-4" /></div>
          </div>
          <div className="text-3xl font-bold tabular-nums">{fmtDuration(totalMinutes)}</div>
          <p className="text-xs text-muted-foreground mt-1">{(entries || []).length} entries</p>
        </div>
        <div className="card animate-fade-up kpi-green p-5">
          <div className="flex items-start justify-between mb-3">
            <p className="text-[13px] font-medium text-muted-foreground">Today</p>
            <div className="icon-chip size-9 icon-chip-green"><CalendarDays className="size-4" /></div>
          </div>
          <div className="text-3xl font-bold tabular-nums">{fmtDuration(todayMinutes)}</div>
          <p className="text-xs text-muted-foreground mt-1">{todayEntries.length} sessions today</p>
        </div>
        <div className="card animate-fade-up kpi-amber p-5 col-span-2 lg:col-span-1">
          <div className="flex items-start justify-between mb-3">
            <p className="text-[13px] font-medium text-muted-foreground">Avg. per Session</p>
            <div className="icon-chip size-9 icon-chip-amber"><Timer className="size-4" /></div>
          </div>
          <div className="text-3xl font-bold tabular-nums">
            {(entries || []).length > 0 ? fmtDuration(Math.round(totalMinutes / (entries || []).length)) : "—"}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Per tracked entry</p>
        </div>
      </div>

      {/* Entries table */}
      <div className="card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <p className="text-[15px] font-semibold">Recent Entries</p>
          {entries && entries.length > 0 && (
            <span className="badge badge-gray">{entries.length} total</span>
          )}
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center gap-3 text-muted-foreground py-12">
            <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : !entries?.length ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Clock className="size-6 text-muted-foreground" /></div>
            <p className="font-semibold">No time entries yet</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">Move tasks to In Progress on the Kanban board to start tracking</p>
            <Link href="/tasks"><Button variant="outline">Go to Tasks <ArrowRight className="size-4" /></Button></Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Task</th><th>Project</th><th>Duration</th><th>Date</th></tr></thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="font-semibold">{(e.taskId as { title?: string })?.title || "—"}</td>
                    <td className="text-muted-foreground">{(e.projectId as { projectName?: string })?.projectName || "—"}</td>
                    <td>
                      <span className="badge badge-blue">{fmtDuration(e.totalMinutes)}</span>
                    </td>
                    <td className="text-muted-foreground">{new Date(e.startTime).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
