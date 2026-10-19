import { Router } from 'express';
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index';
import { clients, projects, tasks, timeEntries, users } from '../db/schema';
import { authMiddleware, requirePermission, AuthRequest } from '../lib/auth';
import { optionalDate, optionalId, sendError } from '../lib/http';
import { inMemberProjects, pick } from '../lib/scopes';
import { toApi } from '../lib/serialize';

const router = Router();
router.use(authMiddleware);

const TEAM_FILTERED_ROLES = ['TEAM_MEMBER', 'DEVELOPER', 'DESIGNER', 'MARKETING', 'ADS_TEAM', 'SUPPORT'];
const TEAM_ROLES = ['TEAM_MEMBER', 'DEVELOPER', 'DESIGNER', 'MARKETING', 'ADS_TEAM', 'SUPPORT', 'SALES'] as const;

router.get('/project-progress', requirePermission('reports', 'read', 'project'), async (req: AuthRequest, res) => {
  try {
    const where = TEAM_FILTERED_ROLES.includes(req.user?.role || '') ? inMemberProjects(projects.id, req.user!.id) : undefined;

    // One grouped query instead of loading every task of every project
    const rows = await db
      .select({
        projectId: projects.id,
        projectName: projects.projectName,
        status: projects.projectStatus,
        client: { id: clients.id, companyName: clients.companyName },
        totalTasks: sql<number>`count(${tasks.id})::int`,
        completedTasks: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'COMPLETED')::int`,
      })
      .from(projects)
      .leftJoin(clients, eq(clients.id, projects.clientId))
      .leftJoin(tasks, eq(tasks.projectId, projects.id))
      .where(where)
      .groupBy(projects.id, clients.id);

    res.json(
      rows.map((p) => ({
        projectId: p.projectId,
        projectName: p.projectName,
        client: toApi(p.client),
        totalTasks: p.totalTasks,
        completedTasks: p.completedTasks,
        progress: p.totalTasks > 0 ? Math.round((p.completedTasks / p.totalTasks) * 100) : 0,
        status: p.status,
      }))
    );
  } catch (err) {
    sendError(res, err, 'Failed to fetch project progress report');
  }
});

router.get('/team-productivity', requirePermission('reports', 'read', 'hr'), async (_req: AuthRequest, res) => {
  try {
    const rows = await db
      .select({
        userId: users.id,
        name: users.name,
        initials: users.initials,
        totalTasks: sql<number>`count(${tasks.id})::int`,
        completedTasks: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'COMPLETED')::int`,
        inProgressTasks: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'IN_PROGRESS')::int`,
      })
      .from(users)
      .leftJoin(tasks, eq(tasks.assignedTo, users.id))
      .where(inArray(users.role, [...TEAM_ROLES]))
      .groupBy(users.id);

    res.json(
      rows.map((u) => ({
        ...u,
        completionRate: u.totalTasks > 0 ? Math.round((u.completedTasks / u.totalTasks) * 100) : 0,
      }))
    );
  } catch (err) {
    sendError(res, err, 'Failed to fetch team productivity report');
  }
});

router.get('/time-tracking', requirePermission('reports', 'read', 'personal'), async (req: AuthRequest, res) => {
  try {
    const conditions: SQL[] = [];
    const userId = optionalId(req.query.userId, 'userId');
    const projectId = optionalId(req.query.projectId, 'projectId');
    const start = optionalDate(req.query.startDate, 'startDate');
    const end = optionalDate(req.query.endDate, 'endDate');
    if (['DEVELOPER', 'DESIGNER', 'TEAM_MEMBER'].includes(req.user?.role || '')) {
      // Personal-only roles can't widen the report with ?userId=
      conditions.push(eq(timeEntries.userId, req.user!.id));
    } else if (userId) {
      conditions.push(eq(timeEntries.userId, userId));
    }
    if (projectId) conditions.push(eq(timeEntries.projectId, projectId));
    if (start) conditions.push(gte(timeEntries.startTime, start));
    if (end) conditions.push(lte(timeEntries.startTime, end));

    const entries = await db.query.timeEntries.findMany({
      where: and(...conditions),
      with: { user: pick.userName, project: pick.projectName, task: pick.taskTitle },
      orderBy: [desc(timeEntries.startTime)],
      limit: 200,
    });

    const totalMinutes = entries.reduce((s, e) => s + (e.totalMinutes || 0), 0);
    res.json({
      entries: toApi(entries),
      totalMinutes,
      totalHours: Math.round((totalMinutes / 60) * 100) / 100,
    });
  } catch (err) {
    sendError(res, err, 'Failed to fetch time tracking report');
  }
});

export default router;
