"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuthStore } from "@/store/auth";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calendar, Users, CheckSquare, Copy, Trash2, ListChecks, Settings2 } from "lucide-react";
import { COORDINATION_ROLES } from "@/lib/crm";
import { WorkflowStepPicker, WorkflowTracker, type WorkflowStep } from "@/components/projects/Workflow";

const PROJECT_STATUSES = [
  { value: "ACTIVE", label: "Active", cls: "bg-emerald-100 text-emerald-700" },
  { value: "ON_HOLD", label: "On hold", cls: "bg-amber-100 text-amber-700" },
  { value: "COMPLETED", label: "Completed", cls: "bg-slate-200 text-slate-700" },
];
// Mirrors the API permission matrix (projects: update = full/manage, delete = full)
const CAN_UPDATE = ["SUPER_ADMIN", "MANAGEMENT", "PROJECT_MANAGER", ...COORDINATION_ROLES];
const CAN_DELETE = ["SUPER_ADMIN", "MANAGEMENT", ...COORDINATION_ROLES];

type ProjectDetail = {
  id: string;
  projectName: string;
  projectStatus: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  workflow?: WorkflowStep[];
  clientId?: { companyName?: string; contactEmail?: string };
  teamMembers?: Array<{ name: string; initials?: string }>;
  createdBy?: { name: string };
  tasks?: Array<{
    id: string;
    title: string;
    status?: string;
    assignedTo?: { name: string; initials?: string };
  }>;
};

export default function ProjectDetailPage() {
  const params = useParams()!;
  const router = useRouter();
  const id = params.id as string;

  const queryClient = useQueryClient();
  const role = useAuthStore((st) => st.user?.role ?? "");

  const { data: project, isLoading, isError } = useQuery({
    queryKey: ["project", id],
    queryFn: () => api<ProjectDetail>(`/projects/${id}`),
    enabled: !!id,
  });

  const statusMutation = useMutation({
    mutationFn: (stage: string) => api(`/projects/${id}/stage`, { method: "PATCH", body: JSON.stringify({ stage }) }),
    onSuccess: () => {
      toast.success("Project status updated");
      queryClient.invalidateQueries({ queryKey: ["project", id] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const [editingSteps, setEditingSteps] = useState<string[] | null>(null);
  const stepsMutation = useMutation({
    mutationFn: (steps: string[]) => api(`/projects/${id}/workflow`, { method: "PUT", body: JSON.stringify({ steps }) }),
    onSuccess: () => {
      toast.success("Follow-up steps updated");
      setEditingSteps(null);
      queryClient.invalidateQueries({ queryKey: ["project", id] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (err: Error) => toast.error("Couldn't update the steps", { description: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api(`/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Project deleted");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push("/projects");
    },
  });

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="font-semibold">Project not available</p>
        <p className="text-sm text-muted-foreground">It may have been deleted, or you don&apos;t have access.</p>
        <Button variant="outline" onClick={() => router.push("/projects")}><ArrowLeft className="size-4" />Back to projects</Button>
      </div>
    );
  }

  if (isLoading || !project) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-12">
        <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        Loading...
      </div>
    );
  }

  const completedCount = project.tasks?.filter((t) => t.status === "COMPLETED").length ?? 0;
  const totalCount = project.tasks?.length ?? 0;
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">{project.projectName}</h1>
          <p className="text-muted-foreground mt-1">
            {(project.clientId as { companyName?: string })?.companyName || "—"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {CAN_UPDATE.includes(role) ? (
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
              {PROJECT_STATUSES.map((st) => (
                <button
                  key={st.value}
                  type="button"
                  disabled={statusMutation.isPending || project.projectStatus === st.value}
                  onClick={() => statusMutation.mutate(st.value)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-all ${project.projectStatus === st.value ? `${st.cls} shadow-sm` : "text-muted-foreground hover:bg-background"}`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          ) : (
            <span className="badge badge-gray">{project.projectStatus.replace(/_/g, " ")}</span>
          )}
          {CAN_DELETE.includes(role) && (
            <Button
              variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (window.confirm(`Delete "${project.projectName}"? Its tasks, content posts and campaigns are deleted too.`)) deleteMutation.mutate();
              }}
            >
              <Trash2 className="size-4" />Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <CheckSquare className="size-5 text-primary-text" />
              </div>
              <div>
                <div className="text-2xl font-bold">{progress}%</div>
                <p className="text-sm text-muted-foreground">Progress</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Calendar className="size-5 text-primary-text" />
              </div>
              <div>
                <div className="text-sm font-medium">
                  {project.startDate
                    ? new Date(project.startDate).toLocaleDateString()
                    : "—"}{" "}
                  →{" "}
                  {project.endDate
                    ? new Date(project.endDate).toLocaleDateString()
                    : "—"}
                </div>
                <p className="text-sm text-muted-foreground">Timeline</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Users className="size-5 text-primary-text" />
              </div>
              <div>
                <div className="text-sm font-medium">
                  {project.teamMembers?.length ?? 0} members
                </div>
                <p className="text-sm text-muted-foreground">Team</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2"><ListChecks className="size-4" />Production follow-ups</CardTitle>
          {CAN_UPDATE.includes(role) && editingSteps === null && (
            <Button variant="ghost" size="sm" onClick={() => setEditingSteps((project.workflow ?? []).map((st) => st.key))}>
              <Settings2 className="size-3.5" />{project.workflow?.length ? "Edit steps" : "Add steps"}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {editingSteps !== null ? (
            <div className="space-y-3">
              <WorkflowStepPicker value={editingSteps} onChange={setEditingSteps} />
              <p className="text-xs text-muted-foreground">Steps you keep keep their status; removed steps are dropped.</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditingSteps(null)}>Cancel</Button>
                <Button size="sm" disabled={stepsMutation.isPending} onClick={() => stepsMutation.mutate(editingSteps)}>
                  {stepsMutation.isPending ? "Saving…" : "Save steps"}
                </Button>
              </div>
            </div>
          ) : project.workflow?.length ? (
            <WorkflowTracker projectId={id} steps={project.workflow} editable={CAN_UPDATE.includes(role)} />
          ) : (
            <p className="text-muted-foreground text-sm py-4 text-center">No follow-up steps on this project yet.</p>
          )}
        </CardContent>
      </Card>

      {project.description && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground whitespace-pre-wrap">{project.description}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Tasks</CardTitle>
          <span className="text-sm text-muted-foreground">
            {completedCount} / {totalCount} completed
          </span>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {project.tasks?.map((t) => (
              <Link
                key={t.id}
                href={`/tasks?task=${t.id}`}
                className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
              >
                <div
                  className={`size-2 rounded-full shrink-0 ${
                    t.status === "COMPLETED"
                      ? "bg-green-500"
                      : t.status === "IN_PROGRESS"
                      ? "bg-amber-500"
                      : "bg-muted-foreground/50"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{t.title}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span>{(t.assignedTo as { name?: string })?.name || "Unassigned"}</span>
                    <span className="font-mono text-[10px]">#{t.id?.slice(-6) ?? "—"}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    if (t.id) navigator.clipboard.writeText(t.id);
                  }}
                  className="shrink-0 p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  title="Copy Task ID"
                >
                  <Copy className="size-3.5" />
                </button>
                <span className="text-xs px-2 py-1 rounded-full bg-muted capitalize">
                  {t.status?.replace("_", " ") || "—"}
                </span>
              </Link>
            ))}
            {(!project.tasks || project.tasks.length === 0) && (
              <p className="text-muted-foreground py-8 text-center">No tasks yet</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
