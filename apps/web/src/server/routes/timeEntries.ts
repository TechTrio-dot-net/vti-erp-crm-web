import { Router, Response } from 'express';
import { and, desc, eq, getTableColumns, gte, lte, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index';
import { activeTimers, projects, tasks, timeEntries } from '../db/schema';
import { authMiddleware, requireRole, AuthRequest } from '../lib/auth';
import { HttpError, optionalDate, optionalId, sendError, uuidParam } from '../lib/http';
import { pick } from '../lib/scopes';
import { toApi } from '../lib/serialize';

const router = Router();
router.use(authMiddleware);
router.param('id', uuidParam);
router.param('userId', uuidParam);
router.param('projectId', uuidParam);

const TIMER_ROLES = ['SUPER_ADMIN', 'MANAGEMENT', 'PROJECT_MANAGER', 'DEVELOPER', 'DESIGNER', 'MARKETING', 'ADS_TEAM', 'SALES', 'SUPPORT', 'HR', 'TEAM_MEMBER', 'VTI_COORDINATION', 'COORDINATION'] as const;
const entryRelations = { user: pick.userName, task: pick.taskTitle, project: pick.projectName } as const;

function requireTimerAccess(req: AuthRequest, res: Response, next: () => void) {
  if (!req.user?.role || !TIMER_ROLES.includes(req.user.role as typeof TIMER_ROLES[number])) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }
  next();
}

function startTimeRange(query: AuthRequest['query']): SQL[] {
  const conditions: SQL[] = [];
  const start = optionalDate(query.startDate, 'startDate');
  const end = optionalDate(query.endDate, 'endDate');
  if (start) conditions.push(gte(timeEntries.startTime, start));
  if (end) conditions.push(lte(timeEntries.startTime, end));
  return conditions;
}

function findEntry(id: string) {
  return db.query.timeEntries.findFirst({ where: eq(timeEntries.id, id), with: entryRelations });
}

async function projectOfTask(taskId: unknown): Promise<string> {
  const id = optionalId(taskId, 'taskId');
  if (!id) throw new HttpError(404, 'Task not found');
  const [task] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task) throw new HttpError(404, 'Task not found');
  return task.projectId;
}

router.get('/active', async (req: AuthRequest, res) => {
  try {
    const [timer] = await db
      .select({
        taskId: activeTimers.taskId,
        projectId: activeTimers.projectId,
        startTime: activeTimers.startTime,
        taskTitle: tasks.title,
        projectName: projects.projectName,
      })
      .from(activeTimers)
      .leftJoin(tasks, eq(tasks.id, activeTimers.taskId))
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .where(eq(activeTimers.userId, req.user!.id))
      .limit(1);
    if (!timer) return res.json(null);
    res.json({
      ...timer,
      taskTitle: timer.taskTitle ?? undefined,
      projectName: timer.projectName ?? undefined,
    });
  } catch (err) {
    sendError(res, err, 'Failed to fetch active timer');
  }
});

router.get('/', async (req: AuthRequest, res) => {
  try {
    const conditions = startTimeRange(req.query);
    if (req.user?.role === 'TEAM_MEMBER') conditions.push(eq(timeEntries.userId, req.user!.id));
    const userId = optionalId(req.query.userId, 'userId');
    const taskId = optionalId(req.query.taskId, 'taskId');
    const projectId = optionalId(req.query.projectId, 'projectId');
    if (userId && req.user?.role === 'SUPER_ADMIN') conditions.push(eq(timeEntries.userId, userId));
    if (taskId) conditions.push(eq(timeEntries.taskId, taskId));
    if (projectId) conditions.push(eq(timeEntries.projectId, projectId));

    const rows = await db.query.timeEntries.findMany({
      where: and(...conditions),
      with: entryRelations,
      orderBy: [desc(timeEntries.startTime)],
    });
    res.json(toApi(rows));
  } catch (err) {
    sendError(res, err, 'Failed to fetch time entries');
  }
});

router.post('/', requireRole('SUPER_ADMIN', 'TEAM_MEMBER'), async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { taskId, notes } = req.body ?? {};
    const projectId = await projectOfTask(taskId);
    const start = optionalDate(req.body?.startTime, 'startTime');
    const end = optionalDate(req.body?.endTime, 'endTime');
    if (!start || !end) throw new HttpError(400, 'startTime and endTime are required');

    const [entry] = await db
      .insert(timeEntries)
      .values({
        userId: authReq.user!.id,
        taskId,
        projectId,
        startTime: start,
        endTime: end,
        totalMinutes: Math.round((end.getTime() - start.getTime()) / 60000),
        notes,
      })
      .returning({ id: timeEntries.id });
    res.status(201).json(toApi((await findEntry(entry.id))!));
  } catch (err) {
    sendError(res, err, 'Failed to create time entry');
  }
});

router.post('/start', requireTimerAccess, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { taskId } = req.body ?? {};
    const projectId = await projectOfTask(taskId);
    // Upsert so a user can only have one active timer at a time
    const startTime = new Date();
    await db
      .insert(activeTimers)
      .values({ userId: authReq.user!.id, taskId, projectId, startTime })
      .onConflictDoUpdate({ target: activeTimers.userId, set: { taskId, projectId, startTime } });
    res.json({ started: true, taskId });
  } catch (err) {
    sendError(res, err, 'Failed to start timer');
  }
});

router.post('/stop', requireTimerAccess, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const [timer] = await db.delete(activeTimers).where(eq(activeTimers.userId, authReq.user!.id)).returning();
    if (!timer) return res.status(400).json({ message: 'No active timer' });
    const endTime = new Date();

    const [entry] = await db
      .insert(timeEntries)
      .values({
        userId: authReq.user!.id,
        taskId: timer.taskId,
        projectId: timer.projectId,
        startTime: timer.startTime,
        endTime,
        totalMinutes: Math.round((endTime.getTime() - timer.startTime.getTime()) / 60000),
      })
      .returning({ id: timeEntries.id });
    res.json(toApi((await findEntry(entry.id))!));
  } catch (err) {
    sendError(res, err, 'Failed to stop timer');
  }
});

router.get('/reports/user/:userId', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const where = and(eq(timeEntries.userId, req.params.userId as string), ...startTimeRange(req.query));
    const [perTask, [total]] = await Promise.all([
      db
        .select({ taskId: timeEntries.taskId, totalMinutes: sql<number>`sum(${timeEntries.totalMinutes})::int`, task: getTableColumns(tasks) })
        .from(timeEntries)
        .innerJoin(tasks, eq(tasks.id, timeEntries.taskId))
        .where(where)
        .groupBy(timeEntries.taskId, tasks.id),
      db.select({ total: sql<number>`coalesce(sum(${timeEntries.totalMinutes}), 0)::int` }).from(timeEntries).where(where),
    ]);
    res.json({
      entries: perTask.map((e) => ({ _id: e.taskId, totalMinutes: e.totalMinutes, task: toApi(e.task) })),
      totalMinutes: total.total,
    });
  } catch (err) {
    sendError(res, err, 'Failed to fetch report');
  }
});

router.get('/reports/project/:projectId', requireRole('SUPER_ADMIN', 'TEAM_MEMBER'), async (req, res) => {
  try {
    const where = and(eq(timeEntries.projectId, req.params.projectId as string), ...startTimeRange(req.query));
    const [entries, [total]] = await Promise.all([
      db.query.timeEntries.findMany({ where, with: { user: pick.userName, task: pick.taskTitle } }),
      db.select({ total: sql<number>`coalesce(sum(${timeEntries.totalMinutes}), 0)::int` }).from(timeEntries).where(where),
    ]);
    res.json({ entries: toApi(entries), totalMinutes: total.total });
  } catch (err) {
    sendError(res, err, 'Failed to fetch report');
  }
});

/** Loads an entry and enforces that team members only touch their own */
async function loadOwnEntry(req: AuthRequest, res: Response) {
  const [entry] = await db
    .select({ id: timeEntries.id, userId: timeEntries.userId })
    .from(timeEntries)
    .where(eq(timeEntries.id, req.params.id as string))
    .limit(1);
  if (!entry) {
    res.status(404).json({ message: 'Entry not found' });
    return null;
  }
  if (req.user!.role === 'TEAM_MEMBER' && entry.userId !== req.user!.id) {
    res.status(403).json({ message: 'Forbidden' });
    return null;
  }
  return entry;
}

router.patch('/:id', requireRole('SUPER_ADMIN', 'TEAM_MEMBER'), async (req, res) => {
  try {
    const entry = await loadOwnEntry(req as AuthRequest, res);
    if (!entry) return;
    const startTime = optionalDate(req.body?.startTime, 'startTime');
    const endTime = optionalDate(req.body?.endTime, 'endTime');
    const updates: Partial<typeof timeEntries.$inferInsert> = { startTime, endTime, updatedAt: new Date() };
    if (req.body?.notes !== undefined) updates.notes = req.body.notes;
    if (startTime && endTime) {
      updates.totalMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);
    }
    await db.update(timeEntries).set(updates).where(eq(timeEntries.id, entry.id));
    res.json(toApi((await findEntry(entry.id))!));
  } catch (err) {
    sendError(res, err, 'Failed to update entry');
  }
});

router.delete('/:id', requireRole('SUPER_ADMIN', 'TEAM_MEMBER'), async (req, res) => {
  try {
    const entry = await loadOwnEntry(req as AuthRequest, res);
    if (!entry) return;
    await db.delete(timeEntries).where(eq(timeEntries.id, entry.id));
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to delete entry');
  }
});

export default router;
