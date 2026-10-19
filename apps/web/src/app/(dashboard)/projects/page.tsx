"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { Plus, Users, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkflowChips, type WorkflowStep } from "@/components/projects/Workflow";

type Project = {
  id: string;
  projectName: string;
  projectStatus: string;
  clientName: string;
  clientEmail?: string | null;
  clientId?: { companyName?: string };
  workflow?: WorkflowStep[];
  teamMembers?: Array<{ name: string }>;
  createdBy?: { name: string };
};

type ProjectsData = {
  ACTIVE: Project[];
  ON_HOLD: Project[];
  COMPLETED: Project[];
};

const STAGES = ["ACTIVE", "ON_HOLD", "COMPLETED"] as const;

const STAGE_CONFIG = {
  ACTIVE: {
    label: "Active",
    dot: "bg-emerald-400",
    headerBorder: "border-t-emerald-400",
    count: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  ON_HOLD: {
    label: "On Hold",
    dot: "bg-amber-400",
    headerBorder: "border-t-amber-400",
    count: "bg-amber-50 text-amber-700 border-amber-200",
  },
  COMPLETED: {
    label: "Completed",
    dot: "bg-sky-400",
    headerBorder: "border-t-sky-400",
    count: "bg-sky-50 text-sky-700 border-sky-200",
  },
} as const;

export default function ProjectsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<ProjectsData>("/projects"),
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) =>
      api(`/projects/${id}/stage`, {
        method: "PATCH",
        body: JSON.stringify({ stage }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  // Changes made by others arrive through useRealtime in the dashboard layout

  if (isLoading || !data)
    return (
      <div className="space-y-6 animate-fade-up">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[0,1,2].map(i => (
            <div key={i} className="rounded-xl border border-border/60 bg-muted/20 border-t-2 border-t-slate-300 p-3 space-y-2.5" style={{ minHeight: 300 }}>
              <div className="flex items-center justify-between pb-3 border-b border-border/50">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-8 rounded-full" />
              </div>
              {[0,1,2].map(j => (
                <div key={j} className="card p-3.5 space-y-1.5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Projects</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Drag cards between columns to update status</p>
        </div>
        <Link
          href="/projects/new"
          className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Plus className="size-4" />
          New project
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {STAGES.map((stage) => {
          const projects = data[stage] || [];
          const cfg = STAGE_CONFIG[stage];
          return (
            <div
              key={stage}
              className={`rounded-xl border border-border/60 bg-muted/20 flex flex-col border-t-2 ${cfg.headerBorder}`}
              style={{ minHeight: 420 }}
            >
              {/* Column header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${cfg.dot}`} />
                  <span className="font-semibold text-sm text-foreground">{cfg.label}</span>
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.count}`}>
                  {projects.length}
                </span>
              </div>

              {/* Cards */}
              <div
                className="flex-1 p-3 space-y-2.5 overflow-auto"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("projectId");
                  if (id) {
                    const proj =
                      data.ACTIVE.find((x) => x.id === id) ||
                      data.ON_HOLD.find((x) => x.id === id) ||
                      data.COMPLETED.find((x) => x.id === id);
                    if (proj && proj.projectStatus !== stage) {
                      moveMutation.mutate({ id: proj.id, stage });
                    }
                  }
                }}
              >
                {projects.length === 0 && (
                  <div className="flex items-center justify-center h-24 rounded-lg border-2 border-dashed border-border/50">
                    <p className="text-xs text-muted-foreground">Drop here</p>
                  </div>
                )}
                {projects.map((p) => (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("projectId", p.id)}
                    className="bg-card border border-border/60 rounded-lg p-3.5 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all group"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="font-semibold text-sm text-foreground leading-snug">{p.projectName}</div>
                      <Link
                        href={`/projects/${p.id}`}
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="size-3.5" />
                      </Link>
                    </div>
                    <div className="text-xs text-muted-foreground mb-3">{p.clientId?.companyName ?? p.clientName}</div>
                    {p.workflow && p.workflow.length > 0 && <div className="mb-3"><WorkflowChips steps={p.workflow} /></div>}
                    {p.teamMembers && p.teamMembers.length > 0 && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Users className="size-3 shrink-0" />
                        <span className="truncate">
                          {p.teamMembers.slice(0, 3).map((m) => m.name.split(" ")[0]).join(", ")}
                          {p.teamMembers.length > 3 && ` +${p.teamMembers.length - 3}`}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
