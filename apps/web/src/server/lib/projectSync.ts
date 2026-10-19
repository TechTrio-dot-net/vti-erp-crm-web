import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index';
import { projects, tasks, type ProjectStatus, type ProjectWorkflowStep, type TaskStatus, type WorkflowStatus } from '../db/schema';
import { emitKanbanUpdated } from './realtime';

/**
 * Project follow-up steps and tasks mirror each other: every step (shoot, video edit, post, ads) has a
 * task on the board, moving either one moves the other, and a project whose tasks are all completed
 * moves to Completed (and back to Active when one is reopened).
 */

export const TASK_FOR_STEP: Record<WorkflowStatus, TaskStatus> = { PENDING: 'BACKLOG', IN_PROGRESS: 'IN_PROGRESS', DONE: 'COMPLETED' };

function stepStatusFromTasks(statuses: TaskStatus[]): WorkflowStatus {
  if (statuses.every((s) => s === 'COMPLETED')) return 'DONE';
  if (statuses.some((s) => s !== 'BACKLOG' && s !== 'TO_DO')) return 'IN_PROGRESS';
  return 'PENDING';
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Creates the Backlog task for each step that doesn't have one yet */
export async function createStepTasks(
  tx: Tx | typeof db,
  project: { id: string; endDate?: Date | null; createdBy?: string | null },
  steps: ProjectWorkflowStep[]
): Promise<void> {
  if (!steps.length) return;
  const existing = await tx
    .select({ step: tasks.workflowStep })
    .from(tasks)
    .where(and(eq(tasks.projectId, project.id), inArray(tasks.workflowStep, steps.map((s) => s.key))));
  const have = new Set(existing.map((e) => e.step));
  const missing = steps.filter((s) => !have.has(s.key));
  if (!missing.length) return;
  await tx.insert(tasks).values(
    missing.map((step, i) => ({
      projectId: project.id,
      title: step.label,
      status: TASK_FOR_STEP[step.status],
      completedAt: step.status === 'DONE' ? new Date() : null,
      workflowStep: step.key,
      position: i + 1,
      deadline: project.endDate ?? null,
      createdBy: project.createdBy ?? null,
    }))
  );
}

/** Moves the tasks behind one step to match it (from the project page's Pending / In progress / Done) */
export async function setStepTasks(projectId: string, stepKey: string, status: WorkflowStatus): Promise<void> {
  const taskStatus = TASK_FOR_STEP[status];
  await db
    .update(tasks)
    .set({ status: taskStatus, completedAt: status === 'DONE' ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(tasks.projectId, projectId), eq(tasks.workflowStep, stepKey)));
}

/** Recomputes step statuses from their tasks, then completes or reopens the project */
export async function syncProjectFromTasks(projectId: string | null | undefined, actorId?: string): Promise<void> {
  if (!projectId) return;
  const [project] = await db
    .select({ workflow: projects.workflow, projectStatus: projects.projectStatus })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return;

  const projectTasks = await db
    .select({ status: tasks.status, step: tasks.workflowStep })
    .from(tasks)
    .where(eq(tasks.projectId, projectId));

  const now = new Date().toISOString();
  let workflowChanged = false;
  const workflow = project.workflow.map((step) => {
    const linked = projectTasks.filter((t) => t.step === step.key).map((t) => t.status);
    if (!linked.length) return step;
    const status = stepStatusFromTasks(linked);
    if (status === step.status) return step;
    workflowChanged = true;
    return { ...step, status, updatedAt: now, updatedBy: actorId ?? step.updatedBy };
  });

  let projectStatus: ProjectStatus = project.projectStatus;
  if (projectTasks.length) {
    const allDone = projectTasks.every((t) => t.status === 'COMPLETED');
    if (allDone && projectStatus !== 'COMPLETED') projectStatus = 'COMPLETED';
    else if (!allDone && projectStatus === 'COMPLETED') projectStatus = 'ACTIVE';
  }

  if (workflowChanged || projectStatus !== project.projectStatus) {
    await db.update(projects).set({ workflow, projectStatus, updatedAt: new Date() }).where(eq(projects.id, projectId));
    emitKanbanUpdated({ projectId });
  }
}

/** Project of a task, for syncing after the task changes */
export async function projectOfTask(taskId: string): Promise<string | undefined> {
  const [row] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return row?.projectId;
}
