import { Router } from 'express';
import { and, eq, ilike, lte, or, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { db } from '../db/index';
import { clients, files, projects, tasks } from '../db/schema';
import { authMiddleware, AuthRequest } from '../lib/auth';
import { optionalDate, optionalId, sendError } from '../lib/http';
import { inClientProjects, inMemberProjects, pick } from '../lib/scopes';
import { toApi } from '../lib/serialize';

const router = Router();
router.use(authMiddleware);

const MEMBER_SCOPED_ROLES = ['DEVELOPER', 'DESIGNER', 'TEAM_MEMBER', 'MARKETING', 'ADS_TEAM', 'SUPPORT'];

router.get('/', async (req: AuthRequest, res) => {
  try {
    const { q, status, priority } = req.query;
    const query = typeof q === 'string' ? q.trim() : '';
    if (query.length < 2) {
      return res.json({ projects: [], tasks: [], files: [], clients: [] });
    }

    // Same project visibility as the project list
    const role = req.user!.role;
    const projectScope = (column: PgColumn): SQL | undefined => {
      if (role === 'CLIENT') return inClientProjects(column, req.user!.clientId);
      if (MEMBER_SCOPED_ROLES.includes(role)) return inMemberProjects(column, req.user!.id);
      return undefined;
    };

    // Case-insensitive substring match; escape LIKE wildcards in user input
    const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

    const taskConditions: (SQL | undefined)[] = [
      or(ilike(tasks.title, pattern), ilike(tasks.description, pattern)),
      projectScope(tasks.projectId),
    ];
    const assignedTo = optionalId(req.query.assignedTo, 'assignedTo');
    const deadline = optionalDate(req.query.deadline, 'deadline');
    const projectFilter = optionalId(req.query.project, 'project');
    if (typeof status === 'string' && status) taskConditions.push(eq(tasks.status, status as typeof tasks.$inferSelect.status));
    if (typeof priority === 'string' && priority) taskConditions.push(eq(tasks.priority, priority as typeof tasks.$inferSelect.priority));
    if (assignedTo) taskConditions.push(eq(tasks.assignedTo, assignedTo));
    if (deadline) taskConditions.push(lte(tasks.deadline, deadline));
    if (projectFilter) taskConditions.push(eq(tasks.projectId, projectFilter));

    const canSearchClients = role === 'SUPER_ADMIN' || role === 'TEAM_MEMBER';

    const [projectRows, taskRows, fileRows, clientRows] = await Promise.all([
      db.query.projects.findMany({
        where: and(ilike(projects.projectName, pattern), projectScope(projects.id)),
        with: { client: { columns: { id: true, companyName: true } } },
        limit: 10,
      }),
      db.query.tasks.findMany({
        where: and(...taskConditions),
        with: { project: pick.projectName, assignee: pick.userName },
        limit: 15,
      }),
      db.query.files.findMany({
        where: and(ilike(files.filename, pattern), projectScope(files.projectId)),
        with: { project: pick.projectName },
        limit: 10,
      }),
      canSearchClients
        ? db
            .select()
            .from(clients)
            .where(or(ilike(clients.companyName, pattern), ilike(clients.contactName, pattern), ilike(clients.contactEmail, pattern)))
            .limit(10)
        : Promise.resolve([]),
    ]);

    res.json({
      projects: toApi(projectRows),
      tasks: toApi(taskRows),
      files: toApi(fileRows),
      clients: toApi(clientRows),
    });
  } catch (err) {
    sendError(res, err, 'Search failed');
  }
});

export default router;
