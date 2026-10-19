import { Router } from 'express';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index';
import { activities, clients, projects, projectTeamMembers, tasks, type ProjectWorkflowStep, type WorkflowStatus } from '../db/schema';
import { authMiddleware, requirePermission, AuthRequest } from '../lib/auth';
import { HttpError, isUuid, pickColumns, sendError, uuidParam } from '../lib/http';
import { inMemberProjects, isProjectMember, pick } from '../lib/scopes';
import { toApi } from '../lib/serialize';
import { emitKanbanUpdated } from '../lib/realtime';
import { createStepTasks, setStepTasks, syncProjectFromTasks } from '../lib/projectSync';

const router = Router();
router.use(authMiddleware);
router.param('id', uuidParam);

const MEMBER_SCOPED_ROLES = ['DEVELOPER', 'DESIGNER', 'TEAM_MEMBER', 'MARKETING', 'ADS_TEAM', 'SUPPORT'];
const EDITABLE_FIELDS = ['projectName', 'clientId', 'startDate', 'endDate', 'projectStatus', 'description'] as const;
const projectRelations = { client: pick.clientName, members: pick.teamMembers, creator: pick.userName } as const;

/** Production follow-ups a project can track; social media projects add Post and Ads */
const WORKFLOW_STEPS: Record<string, string> = { shoot: 'Shoot', video_edit: 'Video Edit', post: 'Post', ads: 'Ads' };
const WORKFLOW_STATUSES: WorkflowStatus[] = ['PENDING', 'IN_PROGRESS', 'DONE'];

function parseWorkflow(value: unknown): ProjectWorkflowStep[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((k) => typeof k === 'string' && k in WORKFLOW_STEPS)) {
    throw new HttpError(400, 'Invalid follow-up steps');
  }
  return Object.keys(WORKFLOW_STEPS)
    .filter((key) => value.includes(key))
    .map((key) => ({ key, label: WORKFLOW_STEPS[key], status: 'PENDING', updatedAt: null, updatedBy: null }));
}

function parseTeamMembers(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(isUuid)) throw new HttpError(400, 'Invalid teamMembers');
  return [...new Set(value)];
}

function findProject(id: string) {
  return db.query.projects.findFirst({ where: eq(projects.id, id), with: projectRelations });
}

/** Enforces the same visibility rules as the project list for a single project */
async function canViewProject(req: AuthRequest, project: { id: string; clientId: string }): Promise<boolean> {
  const role = req.user!.role;
  if (role === 'CLIENT') return !!req.user!.clientId && project.clientId === req.user!.clientId;
  if (MEMBER_SCOPED_ROLES.includes(role)) return isProjectMember(project.id, req.user!.id);
  return true;
}

router.get('/', requirePermission('projects', 'read'), async (req: AuthRequest, res) => {
  try {
    let where: SQL | undefined;
    if (req.user!.role === 'CLIENT') {
      where = req.user!.clientId ? eq(projects.clientId, req.user!.clientId) : sql`false`;
    } else if (MEMBER_SCOPED_ROLES.includes(req.user!.role)) {
      where = inMemberProjects(projects.id, req.user!.id);
    }
    // MANAGEMENT, SUPER_ADMIN, PROJECT_MANAGER, SALES see all projects

    const rows = toApi(
      await db.query.projects.findMany({ where, with: projectRelations, orderBy: [desc(projects.updatedAt)] })
    );
    res.json({
      ACTIVE: rows.filter((p) => p.projectStatus === 'ACTIVE'),
      ON_HOLD: rows.filter((p) => p.projectStatus === 'ON_HOLD'),
      COMPLETED: rows.filter((p) => p.projectStatus === 'COMPLETED'),
    });
  } catch (err) {
    sendError(res, err, 'Failed to fetch projects');
  }
});

router.get('/:id', requirePermission('projects', 'read'), async (req: AuthRequest, res) => {
  try {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, req.params.id as string),
      with: { ...projectRelations, tasks: { with: { assignee: pick.userName }, orderBy: [asc(tasks.position)] } },
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });
    if (!(await canViewProject(req, project))) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    res.json({ ...toApi(project), tasks: toApi(project.tasks) });
  } catch (err) {
    sendError(res, err, 'Failed to fetch project');
  }
});

router.patch('/:id', requirePermission('projects', 'update'), async (req, res) => {
  try {
    const id = req.params.id as string;
    const updates: Partial<typeof projects.$inferInsert> = pickColumns(projects, req.body, EDITABLE_FIELDS);
    const teamMembers = parseTeamMembers(req.body?.teamMembers);

    const found = await db.transaction(async (tx) => {
      if (updates.clientId) {
        const [client] = await tx
          .select({ contactName: clients.contactName, contactEmail: clients.contactEmail })
          .from(clients)
          .where(eq(clients.id, updates.clientId))
          .limit(1);
        if (!client) throw new HttpError(400, 'Client not found');
        updates.clientName = client.contactName;
        updates.clientEmail = client.contactEmail;
      }
      // updatedAt is always set so the statement is valid even when only teamMembers changed
      const [row] = await tx
        .update(projects)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(projects.id, id))
        .returning({ id: projects.id });
      if (!row) return false;
      if (teamMembers) {
        await tx.delete(projectTeamMembers).where(eq(projectTeamMembers.projectId, id));
        if (teamMembers.length) {
          await tx.insert(projectTeamMembers).values(teamMembers.map((userId) => ({ projectId: id, userId })));
        }
      }
      return true;
    });
    if (!found) return res.status(404).json({ message: 'Project not found' });
    res.json(toApi((await findProject(id))!));
    emitKanbanUpdated({ projectId: id });
  } catch (err) {
    sendError(res, err, 'Failed to update project');
  }
});

router.delete('/:id', requirePermission('projects', 'delete'), async (req, res) => {
  try {
    const [deleted] = await db
      .delete(projects)
      .where(eq(projects.id, req.params.id as string))
      .returning({ id: projects.id });
    if (!deleted) return res.status(404).json({ message: 'Project not found' });
    res.json({ ok: true });
    emitKanbanUpdated({ projectId: deleted.id });
  } catch (err) {
    sendError(res, err, 'Failed to delete project');
  }
});

router.get('/:id/timeline', requirePermission('projects', 'read'), async (req: AuthRequest, res) => {
  try {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, req.params.id as string),
      columns: { id: true, projectName: true, clientId: true },
      with: { tasks: { with: { assignee: pick.userName }, orderBy: [asc(tasks.deadline)] } },
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });
    if (!(await canViewProject(req, project))) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    res.json({ project: { id: project.id, projectName: project.projectName }, tasks: toApi(project.tasks) });
  } catch (err) {
    sendError(res, err, 'Failed to fetch timeline');
  }
});

router.get('/:id/activity', requirePermission('projects', 'read'), async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const [project] = await db
      .select({ id: projects.id, clientId: projects.clientId })
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    if (!project) return res.status(404).json({ message: 'Project not found' });
    if (!(await canViewProject(req, project))) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const rows = await db.query.activities.findMany({
      where: eq(activities.projectId, id),
      with: { actor: pick.userName },
      orderBy: [desc(activities.createdAt)],
      limit: 50,
    });
    res.json(toApi(rows));
  } catch (err) {
    sendError(res, err, 'Failed to fetch activity');
  }
});

router.patch('/:id/stage', requirePermission('projects', 'update'), async (req, res) => {
  try {
    const { projectStatus } = pickColumns(projects, { projectStatus: req.body?.stage }, ['projectStatus']);
    if (!projectStatus || !['ACTIVE', 'ON_HOLD', 'COMPLETED'].includes(projectStatus)) {
      return res.status(400).json({ message: 'Invalid stage' });
    }
    const [updated] = await db
      .update(projects)
      .set({ projectStatus })
      .where(eq(projects.id, req.params.id as string))
      .returning({ id: projects.id });
    if (!updated) return res.status(404).json({ message: 'Project not found' });
    res.json(toApi((await findProject(updated.id))!));
    emitKanbanUpdated({ projectId: updated.id });
  } catch (err) {
    sendError(res, err, 'Failed to update project');
  }
});

/** Moves one follow-up step (shoot, video edit, post, ads) to Pending, In progress or Done */
router.patch('/:id/workflow/:key', requirePermission('projects', 'update'), async (req: AuthRequest, res) => {
  try {
    const status = req.body?.status as WorkflowStatus;
    if (!WORKFLOW_STATUSES.includes(status)) return res.status(400).json({ message: 'Invalid status' });
    const id = req.params.id as string;
    const [project] = await db.select({ workflow: projects.workflow }).from(projects).where(eq(projects.id, id)).limit(1);
    if (!project) return res.status(404).json({ message: 'Project not found' });
    if (!project.workflow.some((step) => step.key === req.params.key)) return res.status(404).json({ message: 'Step not found' });

    const workflow = project.workflow.map((step) =>
      step.key === req.params.key ? { ...step, status, updatedAt: new Date().toISOString(), updatedBy: req.user!.id } : step
    );
    await db.update(projects).set({ workflow, updatedAt: new Date() }).where(eq(projects.id, id));
    // The step's task follows it on the board, and the project completes once every task is done
    await setStepTasks(id, req.params.key as string, status);
    await syncProjectFromTasks(id, req.user!.id);
    res.json(toApi((await findProject(id))!));
    emitKanbanUpdated({ projectId: id });
  } catch (err) {
    sendError(res, err, 'Failed to update follow-up');
  }
});

/** Adds or removes follow-up steps on an existing project; steps kept keep their status */
router.put('/:id/workflow', requirePermission('projects', 'update'), async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const wanted = parseWorkflow(req.body?.steps);
    const [project] = await db.select({ workflow: projects.workflow }).from(projects).where(eq(projects.id, id)).limit(1);
    if (!project) return res.status(404).json({ message: 'Project not found' });
    const workflow = wanted.map((step) => project.workflow.find((s) => s.key === step.key) ?? step);
    const removed = project.workflow.filter((s) => !workflow.some((w) => w.key === s.key)).map((s) => s.key);
    await db.transaction(async (tx) => {
      await tx.update(projects).set({ workflow, updatedAt: new Date() }).where(eq(projects.id, id));
      if (removed.length) await tx.delete(tasks).where(and(eq(tasks.projectId, id), inArray(tasks.workflowStep, removed)));
      await createStepTasks(tx, { id, createdBy: req.user!.id }, workflow);
    });
    await syncProjectFromTasks(id, req.user!.id);
    res.json(toApi((await findProject(id))!));
    emitKanbanUpdated({ projectId: id });
  } catch (err) {
    sendError(res, err, 'Failed to update follow-ups');
  }
});

router.post('/', requirePermission('projects', 'create'), async (req, res) => {
  try {
    const values = pickColumns(projects, req.body, ['projectName', 'clientId', 'startDate', 'endDate', 'description']);
    const teamMembers = parseTeamMembers(req.body?.teamMembers ?? []) ?? [];
    const workflow = parseWorkflow(req.body?.workflow);
    if (!values.projectName?.trim()) return res.status(400).json({ message: 'Project name is required' });
    if (!values.clientId) return res.status(400).json({ message: 'Client not found' });

    const [client] = await db
      .select({ contactName: clients.contactName, contactEmail: clients.contactEmail })
      .from(clients)
      .where(eq(clients.id, values.clientId))
      .limit(1);
    if (!client) return res.status(400).json({ message: 'Client not found' });

    const id = await db.transaction(async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({
          ...values,
          clientId: values.clientId!,
          projectName: values.projectName!,
          clientName: client.contactName,
          clientEmail: client.contactEmail,
          workflow,
          createdBy: (req as AuthRequest).user!.id,
        })
        .returning({ id: projects.id });
      // Each follow-up step starts as a task in the Backlog
      await createStepTasks(tx, { id: project.id, endDate: values.endDate ?? null, createdBy: (req as AuthRequest).user!.id }, workflow);
      if (teamMembers.length) {
        await tx.insert(projectTeamMembers).values(teamMembers.map((userId) => ({ projectId: project.id, userId })));
      }
      return project.id;
    });

    res.status(201).json(toApi((await findProject(id))!));
    emitKanbanUpdated({ projectId: id });
  } catch (err) {
    sendError(res, err, 'Failed to create project');
  }
});

export default router;
