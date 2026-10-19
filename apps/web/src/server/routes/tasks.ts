import { Router } from 'express';
import { and, asc, eq, gte, isNull, ne, or, type SQL } from 'drizzle-orm';
import { db } from '../db/index';
import { projects, tasks, users } from '../db/schema';
import { authMiddleware, requirePermission, requireRole, AuthRequest } from '../lib/auth';
import { optionalId, pickColumns, sendError, uuidParam } from '../lib/http';
import { inClientProjects, inCreatedProjects, pick } from '../lib/scopes';
import { toApi } from '../lib/serialize';
import { emitKanbanUpdated } from '../lib/realtime';
import { background } from '../lib/background';
import { projectOfTask, syncProjectFromTasks } from '../lib/projectSync';
import { notifyUsers } from '../services/activityService';
import {
  sendEmail,
  taskAssignedTemplate,
  taskCompletedTemplate,
  approvalRequiredTemplate,
  approvalApprovedTemplate,
  approvalRejectedTemplate,
} from '../services/emailService';

const router = Router();
router.use(authMiddleware);
router.param('id', uuidParam);

const EDITABLE_FIELDS = [
  'projectId',
  'title',
  'description',
  'assignedTo',
  'priority',
  'deadline',
  'status',
  'tags',
  'position',
  'attachments',
] as const;

const listRelations = { assignee: pick.userNameEmail, project: pick.projectName } as const;

function findTaskWithRelations(id: string) {
  return db.query.tasks.findFirst({ where: eq(tasks.id, id), with: listRelations });
}

async function userName(id: string): Promise<string | undefined> {
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, id)).limit(1);
  return u?.name;
}

/** Side effects run after the response is sent; failures are logged, never surfaced to the caller */
function inBackground(label: string, work: () => Promise<unknown>) {
  void background(work(), `Tasks: ${label}`);
}

router.get('/', requirePermission('tasks', 'read'), async (req: AuthRequest, res) => {
  try {
    const role = req.user!.role;
    const conditions: (SQL | undefined)[] = [];
    if (role === 'CLIENT') {
      conditions.push(inClientProjects(tasks.projectId, req.user!.clientId));
    } else if (['DEVELOPER', 'DESIGNER', 'TEAM_MEMBER'].includes(role)) {
      conditions.push(eq(tasks.assignedTo, req.user!.id));
    } else if (role === 'SALES') {
      conditions.push(inCreatedProjects(tasks.projectId, req.user!.id));
    }
    // MANAGEMENT, SUPER_ADMIN, PROJECT_MANAGER, MARKETING, ADS_TEAM, SUPPORT see all tasks

    const { status, priority } = req.query;
    const projectId = optionalId(req.query.projectId, 'projectId');
    const assignedTo = optionalId(req.query.assignedTo, 'assignedTo');
    if (projectId) conditions.push(eq(tasks.projectId, projectId));
    if (assignedTo) conditions.push(eq(tasks.assignedTo, assignedTo));
    if (typeof status === 'string' && status) conditions.push(eq(tasks.status, status as typeof tasks.$inferSelect.status));
    if (typeof priority === 'string' && priority) conditions.push(eq(tasks.priority, priority as typeof tasks.$inferSelect.priority));

    // Hide COMPLETED tasks older than 24 hours (keep in DB, just don't show)
    if (!status) {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      conditions.push(
        or(
          ne(tasks.status, 'COMPLETED'),
          gte(tasks.completedAt, cutoff),
          and(isNull(tasks.completedAt), gte(tasks.updatedAt, cutoff))
        )
      );
    }

    const rows = await db.query.tasks.findMany({
      where: and(...conditions),
      with: listRelations,
      orderBy: [asc(tasks.position), asc(tasks.createdAt)],
    });
    res.json(toApi(rows));
  } catch (err) {
    sendError(res, err, 'Failed to fetch tasks');
  }
});

router.get('/:id', requirePermission('tasks', 'read'), async (req: AuthRequest, res) => {
  try {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, req.params.id as string),
      with: { assignee: pick.userNameEmail, project: pick.projectNameClient, creator: pick.userName },
    });
    if (!task) return res.status(404).json({ message: 'Task not found' });
    if (req.user?.role === 'CLIENT' && task.project?.clientId !== req.user.clientId) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    res.json(toApi(task));
  } catch (err) {
    sendError(res, err, 'Failed to fetch task');
  }
});

router.post('/', requirePermission('tasks', 'create'), async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const values = pickColumns(tasks, req.body, EDITABLE_FIELDS);
    const [created] = await db
      .insert(tasks)
      .values({ ...values, createdBy: authReq.user!.id } as typeof tasks.$inferInsert)
      .returning({ id: tasks.id });
    const task = (await findTaskWithRelations(created.id))!;
    await syncProjectFromTasks(task.projectId, authReq.user!.id);
    res.status(201).json(toApi(task));
    emitKanbanUpdated({ id: task.id });

    if (task.assignee) {
      const assignee = task.assignee;
      inBackground('assignment notification', async () => {
        const creatorName = (await userName(authReq.user!.id)) || 'Someone';
        const projectName = task.project?.projectName || '';
        await notifyUsers([assignee.id], {
          title: 'New task assigned',
          body: `${creatorName} assigned you "${task.title}" in ${projectName}`,
          type: 'task-assigned',
          link: '/tasks',
        });
        if (assignee.email) {
          await sendEmail(
            assignee.email,
            'New Task Assigned',
            taskAssignedTemplate({
              taskName: task.title,
              projectName,
              deadline: task.deadline?.toLocaleString(),
              assignedBy: creatorName === 'Someone' ? 'Team' : creatorName,
            }),
            'task-assigned'
          );
        }
      });
    }
  } catch (err) {
    sendError(res, err, 'Failed to create task');
  }
});

router.patch('/:id', requirePermission('tasks', 'update'), async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const id = req.params.id as string;
    const [prev] = await db
      .select({ status: tasks.status, assignedTo: tasks.assignedTo, projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);
    if (!prev) return res.status(404).json({ message: 'Task not found' });

    const updates: Partial<typeof tasks.$inferInsert> = pickColumns(tasks, req.body, EDITABLE_FIELDS);
    const becameCompleted = updates.status === 'COMPLETED' && prev.status !== 'COMPLETED';
    const enteredReview = updates.status === 'REVIEW' && prev.status !== 'REVIEW';
    const reassignedTo = updates.assignedTo && updates.assignedTo !== prev.assignedTo ? updates.assignedTo : null;
    if (becameCompleted) updates.completedAt = new Date();
    else if (updates.status && updates.status !== 'COMPLETED') updates.completedAt = null;

    if (Object.keys(updates).length > 0) {
      await db.update(tasks).set(updates).where(eq(tasks.id, id));
    }
    const task = await findTaskWithRelations(id);
    if (!task) return res.status(404).json({ message: 'Task not found' });
    // Status or project changes move the follow-up step and can complete (or reopen) the project
    if (updates.status || updates.projectId) {
      await syncProjectFromTasks(task.projectId, authReq.user!.id);
      if (updates.projectId && prev.projectId !== updates.projectId) await syncProjectFromTasks(prev.projectId, authReq.user!.id);
    }
    res.json(toApi(task));
    emitKanbanUpdated({ id });

    const projectName = task.project?.projectName || '';
    if (becameCompleted) {
      inBackground('completion notification', async () => {
        const [completedByName, admins] = await Promise.all([
          userName(authReq.user!.id),
          db.select({ id: users.id, email: users.email }).from(users).where(eq(users.role, 'SUPER_ADMIN')),
        ]);
        await notifyUsers(
          admins.map((a) => a.id),
          {
            title: 'Task completed',
            body: `${completedByName || 'Someone'} completed "${task.title}" in ${projectName}`,
            type: 'task-completed',
            link: '/tasks',
          }
        );
        const html = taskCompletedTemplate({
          taskName: task.title,
          projectName,
          completedBy: completedByName || 'Unknown',
          completedAt: new Date().toLocaleString(),
        });
        await Promise.all(admins.flatMap((a) => (a.email ? [sendEmail(a.email, 'Task Completed', html, 'task-completed')] : [])));
      });
    }

    // Notify new assignee when task is reassigned
    if (reassignedTo) {
      inBackground('reassignment notification', async () => {
        const assignerName = await userName(authReq.user!.id);
        await notifyUsers([reassignedTo], {
          title: 'Task assigned to you',
          body: `${assignerName || 'Someone'} assigned you "${task.title}" in ${projectName}`,
          type: 'task-assigned',
          link: '/tasks',
        });
        if (task.assignee?.email) {
          await sendEmail(
            task.assignee.email,
            'Task Assigned to You',
            taskAssignedTemplate({
              taskName: task.title,
              projectName,
              deadline: task.deadline?.toLocaleString(),
              assignedBy: assignerName || 'Team',
            }),
            'task-assigned'
          );
        }
      });
    }

    if (enteredReview) {
      inBackground('approval request email', async () => {
        const [proj] = await db
          .select({ clientEmail: projects.clientEmail })
          .from(projects)
          .where(eq(projects.id, task.projectId))
          .limit(1);
        if (proj?.clientEmail) {
          await sendEmail(
            proj.clientEmail,
            'Client Approval Required',
            approvalRequiredTemplate({ taskName: task.title, projectName }),
            'approval-required'
          );
        }
      });
    }
  } catch (err) {
    sendError(res, err, 'Failed to update task');
  }
});

router.patch('/:id/reorder', requirePermission('tasks', 'update'), async (req, res) => {
  try {
    const status = req.body?.status as typeof tasks.$inferSelect.status;
    const position = typeof req.body?.position === 'number' ? req.body.position : undefined;
    // Single write; completedAt follows the target status only
    const [moved] = await db
      .update(tasks)
      .set({ status, position, completedAt: status === 'COMPLETED' ? new Date() : null })
      .where(eq(tasks.id, req.params.id as string))
      .returning({ id: tasks.id });
    if (!moved) return res.status(404).json({ message: 'Task not found' });
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, moved.id),
      with: { assignee: pick.userName, project: pick.projectName },
    });
    await syncProjectFromTasks(task?.projectId, (req as AuthRequest).user!.id);
    res.json(toApi(task!));
    emitKanbanUpdated({ id: moved.id });
  } catch (err) {
    sendError(res, err, 'Failed to reorder task');
  }
});

/** Loads a task for a client approval decision, enforcing that it belongs to the client's project */
async function loadForClientDecision(req: AuthRequest, res: import('express').Response) {
  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, req.params.id as string),
    columns: { id: true, title: true },
    with: { project: pick.projectNameClient, assignee: pick.userNameEmail },
  });
  if (!task) {
    res.status(404).json({ message: 'Task not found' });
    return null;
  }
  if (!req.user!.clientId || task.project?.clientId !== req.user!.clientId) {
    res.status(403).json({ message: 'Forbidden' });
    return null;
  }
  return task;
}

router.post('/:id/approve', requireRole('CLIENT'), async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const task = await loadForClientDecision(authReq, res);
    if (!task) return;
    await db
      .update(tasks)
      .set({ approvalStatus: 'APPROVED', approvedBy: authReq.user!.id, approvedAt: new Date() })
      .where(eq(tasks.id, task.id));
    res.json({ ok: true });

    if (task.assignee?.email) {
      void sendEmail(
        task.assignee.email,
        'Deliverable Approved',
        approvalApprovedTemplate({ taskName: task.title, projectName: task.project?.projectName || '' }),
        'approval-approved'
      );
    }
  } catch (err) {
    sendError(res, err, 'Failed to approve');
  }
});

router.post('/:id/reject', requireRole('CLIENT'), async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const task = await loadForClientDecision(authReq, res);
    if (!task) return;
    await db
      .update(tasks)
      .set({
        approvalStatus: 'REJECTED',
        approvedBy: authReq.user!.id,
        approvedAt: new Date(),
        rejectionReason: reason,
        status: 'IN_PROGRESS',
        completedAt: null,
      })
      .where(eq(tasks.id, task.id));
    await syncProjectFromTasks(await projectOfTask(task.id));
    res.json({ ok: true });
    emitKanbanUpdated({ id: task.id });

    if (task.assignee?.email) {
      void sendEmail(
        task.assignee.email,
        'Deliverable Rejected',
        approvalRejectedTemplate({ taskName: task.title, projectName: task.project?.projectName || '', reason }),
        'approval-rejected'
      );
    }
  } catch (err) {
    sendError(res, err, 'Failed to reject');
  }
});

router.delete('/:id', requirePermission('tasks', 'delete'), async (req, res) => {
  try {
    const [deleted] = await db
      .delete(tasks)
      .where(eq(tasks.id, req.params.id as string))
      .returning({ id: tasks.id, projectId: tasks.projectId });
    if (!deleted) return res.status(404).json({ message: 'Task not found' });
    await syncProjectFromTasks(deleted.projectId);
    res.json({ ok: true });
    emitKanbanUpdated({ id: deleted.id });
  } catch (err) {
    sendError(res, err, 'Failed to delete task');
  }
});

export default router;
