"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Check, Clapperboard, Loader2, Megaphone, Send } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type WorkflowStatus = "PENDING" | "IN_PROGRESS" | "DONE";
export type WorkflowStep = { key: string; label: string; status: WorkflowStatus; updatedAt: string | null };

/** Mirrors WORKFLOW_STEPS in apps/api/src/routes/projects.ts */
export const WORKFLOW_STEPS = [
  { key: "shoot",      label: "Shoot",      icon: Camera },
  { key: "video_edit", label: "Video Edit", icon: Clapperboard },
  { key: "post",       label: "Post",       icon: Send },
  { key: "ads",        label: "Ads",        icon: Megaphone },
] as const;

/** Project types pick their usual steps; social media also posts and runs ads */
export const PROJECT_TYPES = [
  { key: "video",  label: "Video production", steps: ["shoot", "video_edit"] },
  { key: "social", label: "Social media",     steps: ["shoot", "video_edit", "post", "ads"] },
  { key: "custom", label: "Custom",           steps: [] as string[] },
] as const;

export const STATUS_META: Record<WorkflowStatus, { label: string; chip: string; dot: string }> = {
  PENDING:     { label: "Pending",     chip: "bg-muted text-muted-foreground",                                   dot: "bg-muted-foreground/40" },
  IN_PROGRESS: { label: "In progress", chip: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300", dot: "bg-amber-500" },
  DONE:        { label: "Done",        chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300", dot: "bg-emerald-500" },
};

const stepIcon = (key: string) => WORKFLOW_STEPS.find((s) => s.key === key)?.icon ?? Check;

/** Steps in production order, whatever order they were saved in */
export const orderSteps = <T extends { key: string }>(steps: T[]) =>
  [...steps].sort((a, b) => WORKFLOW_STEPS.findIndex((s) => s.key === a.key) - WORKFLOW_STEPS.findIndex((s) => s.key === b.key));

/** Compact row of step chips for cards and tables */
export function WorkflowChips({ steps }: { steps?: WorkflowStep[] | null }) {
  if (!steps?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {orderSteps(steps).map((s) => {
        const Icon = stepIcon(s.key);
        return (
          <span key={s.key} title={`${s.label}: ${STATUS_META[s.status].label}`} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_META[s.status].chip}`}>
            {s.status === "DONE" ? <Check className="size-3" /> : <Icon className="size-3" />}
            {s.label}
          </span>
        );
      })}
    </div>
  );
}

/** Checkboxes for which steps a new project tracks, with type presets */
export function WorkflowStepPicker({ value, onChange }: { value: string[]; onChange: (steps: string[]) => void }) {
  const type = PROJECT_TYPES.find((t) => t.key !== "custom" && t.steps.length === value.length && t.steps.every((k) => value.includes(k)))?.key ?? "custom";
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {PROJECT_TYPES.filter((t) => t.key !== "custom").map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange([...t.steps])}
            className={`px-3 h-8 rounded-lg text-xs font-semibold border transition-colors ${type === t.key ? "border-primary bg-primary/10 text-primary-text" : "border-input text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {WORKFLOW_STEPS.map(({ key, label, icon: Icon }) => {
          const on = value.includes(key);
          return (
            <label key={key} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer text-sm transition-colors ${on ? "border-primary bg-primary/5" : "border-input hover:bg-muted/50"}`}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => onChange(on ? value.filter((k) => k !== key) : [...value, key])}
                className="size-4 accent-[var(--primary)]"
              />
              <Icon className="size-4 text-muted-foreground" />
              <span className="font-medium">{label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** Project follow-ups: each step moves Pending → In progress → Done */
export function WorkflowTracker({ projectId, steps, editable }: { projectId: string; steps: WorkflowStep[]; editable: boolean }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ key, status }: { key: string; status: WorkflowStatus }) =>
      api(`/projects/${projectId}/workflow/${key}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["coordination"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (err: Error) => toast.error("Couldn't update the follow-up", { description: err.message }),
  });

  const ordered = orderSteps(steps);
  const done = ordered.filter((s) => s.status === "DONE").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${ordered.length ? (done / ordered.length) * 100 : 0}%` }} />
        </div>
        <span className="text-sm text-muted-foreground tabular-nums">{done} / {ordered.length} done</span>
      </div>
      <div className="space-y-2">
        {ordered.map((step) => {
          const Icon = stepIcon(step.key);
          const pending = mutation.isPending && mutation.variables?.key === step.key;
          return (
            <div key={step.key} className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5">
              <div className={`size-8 rounded-lg flex items-center justify-center ${STATUS_META[step.status].chip}`}>
                {step.status === "DONE" ? <Check className="size-4" /> : <Icon className="size-4" />}
              </div>
              <div className="flex-1 min-w-[8rem]">
                <p className="font-medium text-sm">{step.label}</p>
                <p className="text-xs text-muted-foreground">
                  {step.updatedAt ? `Updated ${new Date(step.updatedAt).toLocaleString()}` : "Not started"}
                </p>
              </div>
              {editable ? (
                <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1" role="radiogroup" aria-label={`${step.label} status`}>
                  {(Object.keys(STATUS_META) as WorkflowStatus[]).map((status) => (
                    <button
                      key={status}
                      type="button"
                      role="radio"
                      aria-checked={step.status === status}
                      disabled={mutation.isPending || step.status === status}
                      onClick={() => mutation.mutate({ key: step.key, status })}
                      className={`text-xs font-semibold px-2.5 py-1.5 rounded-md transition-all ${step.status === status ? `${STATUS_META[status].chip} shadow-sm` : "text-muted-foreground hover:bg-background"}`}
                    >
                      {STATUS_META[status].label}
                    </button>
                  ))}
                  {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground mx-1" />}
                </div>
              ) : (
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-md ${STATUS_META[step.status].chip}`}>{STATUS_META[step.status].label}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

/** Starts a project for a client with the production steps to follow up */
/** Starts a project for a client with the production steps to follow up */
export function CreateProjectDialog({ client, onClose }: { client: { id: string; companyName: string } | null; onClose: () => void }) {
  return (
    <Dialog open={!!client} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Create project{client ? ` — ${client.companyName}` : ""}</DialogTitle></DialogHeader>
        {/* Mounted per client, so every opening starts from a fresh form */}
        {client && <CreateProjectForm key={client.id} client={client} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function CreateProjectForm({ client, onClose }: { client: { id: string; companyName: string }; onClose: () => void }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState(`${client.companyName} – Project`);
  const [steps, setSteps] = useState<string[]>(["shoot", "video_edit"]);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");

  const mutation = useMutation({
    mutationFn: (body: object) => api<{ id: string }>("/projects", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (project) => {
      toast.success("Project created", { action: { label: "Open", onClick: () => router.push(`/projects/${project.id}`) } });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["coordination"] });
      onClose();
    },
  });

  return (
    <form
      className="space-y-4 pt-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!steps.length) { toast.error("Choose at least one step to follow up"); return; }
        mutation.mutate({
          projectName: name.trim(),
          clientId: client.id,
          workflow: steps,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          description: description.trim() || undefined,
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="cp-name">Project name *</Label>
        <Input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label>Follow-up steps *</Label>
        <WorkflowStepPicker value={steps} onChange={setSteps} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cp-start">Start date</Label>
          <Input id="cp-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cp-end">Delivery date</Label>
          <Input id="cp-end" type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cp-desc">Notes</Label>
        <textarea
          id="cp-desc"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What was finalised with the client"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      {mutation.isError && <p className="text-sm text-destructive">{mutation.error.message}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Creating…" : "Create project"}</Button>
      </DialogFooter>
    </form>
  );
}
