"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { Copy, Square, Plus, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type Task = {
  id: string; title: string; status: string; priority: string;
  deadline?: string;
  assignedTo?: { name: string; initials?: string };
  projectId?: { projectName: string };
};
type TaskDetail = Task & {
  description?: string;
  approvalStatus?: string;
  rejectionReason?: string;
  createdBy?: { name: string; initials?: string };
  assignedTo?: { id?: string; name: string; initials?: string };
};

// Mirrors the API permission matrix: tasks "full" may delete
const CAN_DELETE_TASKS = ["SUPER_ADMIN", "MANAGEMENT", "PROJECT_MANAGER", "MARKETING", "ADS_TEAM"];
const fieldCls = "w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/** Isolated so the once-per-interval tick re-renders only this text, not the whole board */
function ElapsedTime({ startTime }: { startTime: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  const mins = Math.max(0, Math.floor((now - new Date(startTime).getTime()) / 60000));
  return <>{`${Math.floor(mins / 60)}h ${mins % 60}m`}</>;
}

function TaskDetailDialog({ open, loading, task, users, onClose }: {
  open: boolean;
  loading: boolean;
  task?: TaskDetail;
  users: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const role = useAuthStore((st) => st.user?.role ?? "");
  const [form, setForm] = useState(() => ({
    title: task?.title ?? "",
    description: task?.description ?? "",
    status: task?.status ?? "BACKLOG",
    priority: task?.priority ?? "MEDIUM",
    assignedTo: task?.assignedTo?.id ?? "",
    deadline: task?.deadline ? task.deadline.slice(0, 10) : "",
  }));

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["task"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-me"] });
  };

  const saveMutation = useMutation({
    mutationFn: (body: object) => api(`/tasks/${task!.id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { toast.success("Task saved"); refresh(); onClose(); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api(`/tasks/${task!.id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("Task deleted"); refresh(); onClose(); },
  });

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{loading || !task ? "Loading…" : "Task details"}</DialogTitle>
        </DialogHeader>
        {task && (
          <form
            className="space-y-4 pt-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.title.trim()) { toast.error("Title is required"); return; }
              saveMutation.mutate({
                title: form.title.trim(),
                description: form.description.trim() || null,
                status: form.status,
                priority: form.priority,
                assignedTo: form.assignedTo || null,
                deadline: form.deadline || null,
              });
            }}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono bg-muted px-2 py-1 rounded">#{task.id?.slice(-6)}</span>
              <button type="button" onClick={() => navigator.clipboard.writeText(task.id)} className="hover:text-foreground" title="Copy task ID"><Copy className="size-3.5" /></button>
              <span>{(task.projectId as { projectName?: string })?.projectName || "No project"}</span>
              {task.createdBy?.name && <span>· created by {task.createdBy.name}</span>}
              {task.approvalStatus && <span className="badge badge-gray">Client: {task.approvalStatus.toLowerCase()}</span>}
            </div>
            {task.approvalStatus === "REJECTED" && task.rejectionReason && (
              <p className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">Client feedback: {task.rejectionReason}</p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="td-title">Title</Label>
              <Input id="td-title" value={form.title} onChange={set("title")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="td-desc">Description</Label>
              <textarea id="td-desc" value={form.description} onChange={set("description")} rows={3} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <select value={form.status} onChange={set("status")} className={fieldCls}>
                  {COLS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <select value={form.priority} onChange={set("priority")} className={fieldCls}>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Assigned to</Label>
                <select value={form.assignedTo} onChange={set("assignedTo")} className={fieldCls}>
                  <option value="">Unassigned</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Deadline</Label>
                <Input type="date" value={form.deadline} onChange={set("deadline")} />
              </div>
            </div>
            <DialogFooter className="pt-2 sm:justify-between">
              {CAN_DELETE_TASKS.includes(role) ? (
                <Button
                  type="button" variant="ghost" className="text-muted-foreground hover:text-destructive"
                  disabled={deleteMutation.isPending}
                  onClick={() => window.confirm(`Delete "${task.title}"?`) && deleteMutation.mutate()}
                >
                  <Trash2 className="size-4" />Delete
                </Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={onClose}>Close</Button>
                <Button type="submit" disabled={saveMutation.isPending}>{saveMutation.isPending ? "Saving…" : "Save"}</Button>
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

const COLS = [
  { key: "BACKLOG",     label: "Backlog",      color: "border-t-slate-400",   dot: "bg-slate-400"   },
  { key: "TO_DO",       label: "To Do",        color: "border-t-blue-400",    dot: "bg-blue-400"    },
  { key: "IN_PROGRESS", label: "In Progress",  color: "border-t-amber-400",   dot: "bg-amber-400"   },
  { key: "REVIEW",      label: "Review",       color: "border-t-purple-400",  dot: "bg-purple-400"  },
  { key: "COMPLETED",   label: "Completed",    color: "border-t-emerald-400", dot: "bg-emerald-400" },
] as const;

const PRIORITY_COLORS: Record<string, string> = {
  HIGH:   "priority-high",
  MEDIUM: "priority-medium",
  LOW:    "priority-low",
};
const PRIORITY_DOT: Record<string, string> = {
  HIGH: "bg-red-400", MEDIUM: "bg-amber-400", LOW: "bg-emerald-400",
};

export default function TasksKanbanPage() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams()!;
  const [projectFilter, setProjectFilter] = useState("");
  const [addOpen, setAddOpen]             = useState(false);
  // Deep links like /tasks?task=<id> (from project and team pages) open that task's details
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => searchParams.get("task"));
  const [newTitle, setNewTitle]           = useState("");
  const [newProjectId, setNewProjectId]   = useState("");
  const [newAssignee, setNewAssignee]     = useState("");
  const [newPriority, setNewPriority]     = useState("MEDIUM");
  const [newDeadline, setNewDeadline]     = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [addError, setAddError]           = useState("");

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ ACTIVE: { id: string; projectName: string }[]; ON_HOLD: unknown[]; COMPLETED: unknown[] }>("/projects"),
  });
  const { data: users } = useQuery({
    queryKey: ["users", "directory"],
    queryFn: () => api<Array<{ id: string; name: string; role?: string }>>("/users/directory"),
  });

  const addTaskMutation = useMutation({
    mutationFn: (body: object) => api("/tasks", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setAddOpen(false);
      setNewTitle(""); setNewProjectId(""); setNewAssignee("");
      setNewPriority("MEDIUM"); setNewDeadline(""); setNewDescription(""); setAddError("");
      toast.success("Task created successfully.");
    },
    onError: (err: Error) => {
      setAddError(err.message || "Failed to create task.");
    },
  });

  const { data: tasks, isLoading, isError } = useQuery({
    queryKey: ["tasks", projectFilter],
    queryFn: () => api<Task[]>(`/tasks${projectFilter ? `?projectId=${projectFilter}` : ""}`),
  });

  const { data: taskDetail, isLoading: taskDetailLoading } = useQuery({
    queryKey: ["task", selectedTaskId],
    queryFn: () => api<TaskDetail>(`/tasks/${selectedTaskId}`),
    enabled: !!selectedTaskId,
  });

  // The timer only changes through this user's own start/stop actions, which refresh it below,
  // so no polling — just re-check when the tab regains focus (e.g. after using another tab).
  const { data: activeTimer } = useQuery({
    queryKey: ["time-entries-active"],
    queryFn: () => api<{ taskId: string; startTime: string; taskTitle?: string; projectName?: string } | null>("/time-entries/active"),
    refetchOnWindowFocus: true,
  });

  const refreshTimer = () => {
    queryClient.invalidateQueries({ queryKey: ["time-entries-active"] });
    queryClient.invalidateQueries({ queryKey: ["time-entries"] });
  };

  const stopTimerMutation = useMutation({
    mutationFn: () => api("/time-entries/stop", { method: "POST" }),
    onSuccess: refreshTimer,
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api(`/tasks/${id}/reorder`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ["tasks", projectFilter] });
      const previous = queryClient.getQueryData<Task[]>(["tasks", projectFilter]);
      queryClient.setQueryData<Task[]>(["tasks", projectFilter], (old) =>
        (old || []).map((t) => (t.id === id ? { ...t, status } : t))
      );
      return { previous };
    },
    onSuccess: (_, { id, status }) => {
      if (status === "COMPLETED") {
        confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 }, colors: ["#34d399", "#6366f1", "#f59e0b", "#38bdf8"] });
        toast.success("Task completed! 🎉", { description: "Great work — it'll disappear from the board in 24 hours." });
      }
      if (status === "IN_PROGRESS") {
        api("/time-entries/start", { method: "POST", body: JSON.stringify({ taskId: id }) })
          .then(refreshTimer)
          .catch(() => {});
      } else if (status === "COMPLETED") {
        api("/time-entries/stop", { method: "POST" })
          .then(refreshTimer)
          .catch(() => {});
      }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["tasks", projectFilter], context.previous);
      }
      toast.error("Failed to move task. Please try again.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  // Changes made by others arrive through useRealtime in the dashboard layout


  if (isError) return (
    <div className="page flex flex-col items-center justify-center min-h-[40vh] gap-3 text-center">
      <div className="size-12 rounded-2xl bg-muted flex items-center justify-center">
        <Square className="size-6 text-muted-foreground" />
      </div>
      <p className="font-semibold text-foreground">Could not load tasks</p>
      <p className="text-sm text-muted-foreground">Check your connection or try refreshing the page.</p>
    </div>
  );

  if (isLoading || !tasks) return (
    <div className="page space-y-4">
      <div className="page-header">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {[0,1,2,3,4].map(i => (
          <div key={i} className="kanban-col flex-shrink-0 border-t-2 border-t-slate-300" style={{ width: 240 }}>
            <div className="kanban-col-header">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>
            <div className="p-2.5 space-y-2">
              {[0,1,2].map(j => (
                <div key={j} className="card p-3 space-y-2">
                  <Skeleton className="h-3 w-16 rounded-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const allProjects = [...(projects?.ACTIVE || []), ...(projects?.ON_HOLD || []), ...(projects?.COMPLETED || [])] as { id: string; projectName: string }[];
  const grouped = COLS.reduce((acc, col) => {
    acc[col.key] = (tasks || []).filter((t) => t.status === col.key);
    return acc;
  }, {} as Record<string, Task[]>);

  return (
    <div className="page space-y-4">
      {/* Active timer */}
      {activeTimer && (
        <div className="timer-bar animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="timer-dot" />
            <div>
              <p className="font-semibold text-sm text-foreground">{activeTimer.taskTitle || "Task"}</p>
              <p className="text-xs text-muted-foreground">{activeTimer.projectName && `${activeTimer.projectName} · `}<ElapsedTime startTime={activeTimer.startTime} /></p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => stopTimerMutation.mutate()} disabled={stopTimerMutation.isPending}>
            <Square className="size-3" />Stop timer
          </Button>
        </div>
      )}

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Tasks Board</h1>
          <p className="page-subtitle">Drag cards to update status · Timer auto-starts on In Progress</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}
            className="h-9 rounded-lg border border-input bg-card px-3 text-sm min-w-[160px]"
          >
            <option value="">All Projects</option>
            {allProjects.map((p) => <option key={p.id} value={p.id}>{p.projectName}</option>)}
          </select>
          <Button onClick={() => setAddOpen(true)}><Plus className="size-4" />Add Task</Button>
        </div>
      </div>

      {/* Kanban */}
      <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 520 }}>
        {COLS.map(({ key, label, color, dot }) => {
          const items = grouped[key] || [];
          return (
            <div
              key={key}
              className={`kanban-col flex-shrink-0 border-t-2 ${color}`}
              style={{ width: 240 }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("taskId");
                if (id) {
                  const task = Object.values(grouped).flat().find((t) => t.id === id);
                  if (task && task.status !== key) moveMutation.mutate({ id: task.id, status: key });
                }
              }}
            >
              <div className="kanban-col-header">
                <div className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${dot}`} />
                  <span className="text-sm font-semibold text-foreground">{label}</span>
                </div>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{items.length}</span>
              </div>

              <div className="flex-1 p-2.5 space-y-2 overflow-y-auto">
                {items.length === 0 && (
                  <div className="flex items-center justify-center h-16 rounded-lg border-2 border-dashed border-border/50 mt-1">
                    <p className="text-xs text-muted-foreground">Drop here</p>
                  </div>
                )}
                {items.map((t) => {
                  const isOverdue = t.deadline && new Date(t.deadline) < new Date();
                  return (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("taskId", t.id)}
                      onClick={() => setSelectedTaskId(t.id)}
                      className="kanban-card"
                    >
                      {/* Priority + copy */}
                      <div className="flex items-center justify-between mb-2">
                        <span className={`badge ${PRIORITY_COLORS[t.priority] || "badge-gray"} flex items-center gap-1`}>
                          <span className={`size-1.5 rounded-full ${PRIORITY_DOT[t.priority] || "bg-gray-400"}`} />
                          {t.priority}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); if (t.id) navigator.clipboard.writeText(t.id); }}
                          className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
                        >
                          <Copy className="size-3" />
                        </button>
                      </div>

                      {/* Title */}
                      <p className="text-sm font-semibold leading-snug mb-2">{t.title}</p>

                      {/* Project */}
                      {(t.projectId as { projectName?: string })?.projectName && (
                        <p className="text-xs text-muted-foreground mb-2 truncate">
                          {(t.projectId as { projectName?: string }).projectName}
                        </p>
                      )}

                      {/* Footer */}
                      <div className="flex items-center justify-between mt-1">
                        {(t.assignedTo as { name?: string })?.name ? (
                          <div className="avatar avatar-sm" style={{ width: 22, height: 22, fontSize: 9 }}>
                            {((t.assignedTo as { initials?: string; name?: string })?.initials || (t.assignedTo as { name?: string }).name?.slice(0,2) || "?").toUpperCase()}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">Unassigned</span>
                        )}
                        {t.deadline && (
                          <span className={`text-[10px] font-medium ${isOverdue ? "text-red-500" : "text-muted-foreground"}`}>
                            {isOverdue ? "⚠ " : ""}{new Date(t.deadline).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Task Dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => { if (!o) { setAddOpen(false); setAddError(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add Task</DialogTitle></DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newTitle.trim()) { setAddError("Task title is required."); return; }
              if (!newProjectId) { setAddError("Please select a project."); return; }
              addTaskMutation.mutate({
                title: newTitle.trim(),
                projectId: newProjectId,
                assignedTo: newAssignee || undefined,
                priority: newPriority,
                deadline: newDeadline || undefined,
                description: newDescription.trim() || undefined,
                status: "BACKLOG",
              });
            }}
            className="space-y-4 pt-1"
          >
            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="t-title">Title *</Label>
              <Input
                id="t-title"
                value={newTitle}
                onChange={(e) => { setNewTitle(e.target.value); setAddError(""); }}
                placeholder="e.g. Design landing page hero section"
                autoComplete="off"
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="t-desc">Description</Label>
              <textarea
                id="t-desc"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Optional details about this task…"
                rows={2}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Project + Assignee */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="t-project">Project *</Label>
                <select
                  id="t-project"
                  value={newProjectId}
                  onChange={(e) => { setNewProjectId(e.target.value); setAddError(""); }}
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select project…</option>
                  {allProjects.map((p) => <option key={p.id} value={p.id}>{p.projectName}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="t-priority">Priority</Label>
                <select
                  id="t-priority"
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value)}
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="t-deadline">Deadline</Label>
                <Input
                  id="t-deadline"
                  type="date"
                  value={newDeadline}
                  onChange={(e) => setNewDeadline(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                />
              </div>

              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="t-assignee">Assign to</Label>
                <select
                  id="t-assignee"
                  value={newAssignee}
                  onChange={(e) => setNewAssignee(e.target.value)}
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Unassigned</option>
                  {users?.filter((u) => u.role !== "CLIENT").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>

            {addError && (
              <p className="text-sm text-destructive bg-destructive/8 border border-destructive/20 px-3 py-2.5 rounded-lg">
                {addError}
              </p>
            )}

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={addTaskMutation.isPending}>
                {addTaskMutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <span className="size-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                    Creating…
                  </span>
                ) : "Create Task"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Task detail / edit */}
      <TaskDetailDialog
        key={taskDetail?.id ?? "none"}
        open={!!selectedTaskId}
        loading={taskDetailLoading}
        task={taskDetail}
        users={users ?? []}
        onClose={() => setSelectedTaskId(null)}
      />
    </div>
  );
}
