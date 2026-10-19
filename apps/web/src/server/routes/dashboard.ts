import { Router } from 'express';
import { and, asc, count, desc, eq, gte, inArray, lt, ne, notInArray, sql, sum, type SQL } from 'drizzle-orm';
import { db } from '../db/index';
import { activities, adCampaigns, clients, contentCalendar, invoices, leads, notifications, projects, tasks, timeEntries, users } from '../db/schema';
import { authMiddleware, requireRole, AuthRequest } from '../lib/auth';
import { sendError } from '../lib/http';
import { inClientProjects, inMemberProjects, pick } from '../lib/scopes';
import { toApi } from '../lib/serialize';

const router = Router();
router.use(authMiddleware);

const TEAM_FILTERED_ROLES = ['TEAM_MEMBER', 'DEVELOPER', 'DESIGNER', 'MARKETING', 'ADS_TEAM', 'SUPPORT'];
const COMPANY_VIEW_ROLES = ['SUPER_ADMIN', 'MANAGEMENT', 'PROJECT_MANAGER'];
const WORKLOAD_ROLES = ['TEAM_MEMBER', 'DEVELOPER', 'DESIGNER', 'MARKETING', 'ADS_TEAM', 'SUPPORT', 'SALES'] as const;

/** Team members with their count of open tasks — one grouped query instead of a count per user */
function teamWorkloadQuery() {
  return db
    .select({
      id: users.id,
      name: users.name,
      initials: users.initials,
      role: users.role,
      taskCount: sql<number>`count(${tasks.id})::int`,
    })
    .from(users)
    .leftJoin(tasks, and(eq(tasks.assignedTo, users.id), ne(tasks.status, 'COMPLETED')))
    .where(inArray(users.role, [...WORKLOAD_ROLES]))
    .groupBy(users.id);
}

router.get('/team', async (req: AuthRequest, res) => {
  try {
    const projectScope: SQL[] = [eq(projects.projectStatus, 'ACTIVE')];
    if (TEAM_FILTERED_ROLES.includes(req.user!.role)) {
      projectScope.push(inMemberProjects(projects.id, req.user!.id));
    }
    const visibleActiveProjects = db.select({ id: projects.id }).from(projects).where(and(...projectScope));
    const openTasksIn = (extra: SQL) =>
      db
        .select({ count: count() })
        .from(tasks)
        .where(and(inArray(tasks.projectId, visibleActiveProjects), ne(tasks.status, 'COMPLETED'), extra));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [[activeProjects], [dueToday], [overdue], teamWorkload, recentTime] = await Promise.all([
      db.select({ count: count() }).from(projects).where(and(...projectScope)),
      openTasksIn(and(gte(tasks.deadline, today), lt(tasks.deadline, tomorrow))!),
      openTasksIn(lt(tasks.deadline, today)),
      teamWorkloadQuery(),
      db.query.timeEntries.findMany({
        where: eq(timeEntries.userId, req.user!.id),
        with: { task: pick.taskTitle },
        orderBy: [desc(timeEntries.startTime)],
        limit: 5,
      }),
    ]);

    res.json({
      activeProjects: activeProjects.count,
      tasksDueToday: dueToday.count,
      overdueTasks: overdue.count,
      teamWorkload: toApi(teamWorkload),
      recentTimeEntries: toApi(recentTime),
    });
  } catch (err) {
    sendError(res, err, 'Failed to fetch team dashboard');
  }
});

router.get('/client', requireRole('CLIENT'), async (req: AuthRequest, res) => {
  try {
    const clientId = req.user!.clientId;
    const inMyProjects = (column: Parameters<typeof inClientProjects>[0]) => inClientProjects(column, clientId);

    const [clientProjects, openTasks, calendar, ads, pendingApprovals] = await Promise.all([
      db.query.projects.findMany({
        where: clientId ? eq(projects.clientId, clientId) : sql`false`,
        with: { members: pick.teamMembers },
      }),
      db.query.tasks.findMany({
        where: and(inMyProjects(tasks.projectId), ne(tasks.status, 'COMPLETED')),
        with: { project: pick.projectName, assignee: pick.userName },
        limit: 20,
      }),
      db.query.contentCalendar.findMany({
        where: and(inMyProjects(contentCalendar.projectId), eq(contentCalendar.status, 'APPROVAL')),
        with: { project: pick.projectName },
        limit: 10,
      }),
      db.query.adCampaigns.findMany({
        where: inMyProjects(adCampaigns.projectId),
        with: { project: pick.projectName },
        limit: 10,
      }),
      db.query.tasks.findMany({
        where: and(inMyProjects(tasks.projectId), eq(tasks.status, 'REVIEW')),
        with: { project: pick.projectName },
        limit: 10,
      }),
    ]);

    res.json({
      projects: toApi(clientProjects),
      tasks: toApi(openTasks),
      calendar: toApi(calendar),
      ads: toApi(ads),
      pendingApprovals: toApi(pendingApprovals),
    });
  } catch (err) {
    sendError(res, err, 'Failed to fetch client dashboard');
  }
});

// Personal dashboard — my tasks, time, overdue
router.get('/me', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const mineOpen = and(eq(tasks.assignedTo, userId), ne(tasks.status, 'COMPLETED'));

    const [myTasks, [overdue], [dueToday], [week], [monthCompleted], recentNotifs] = await Promise.all([
      db.query.tasks.findMany({
        columns: { id: true, title: true, status: true, priority: true, deadline: true, projectId: true },
        where: mineOpen,
        with: { project: pick.projectName },
        orderBy: [asc(tasks.deadline)],
      }),
      db.select({ count: count() }).from(tasks).where(and(mineOpen, lt(tasks.deadline, now))),
      db
        .select({ count: count() })
        .from(tasks)
        .where(and(mineOpen, gte(tasks.deadline, todayStart), lt(tasks.deadline, new Date(todayStart.getTime() + 86_400_000)))),
      db
        .select({ minutes: sum(timeEntries.totalMinutes).mapWith(Number) })
        .from(timeEntries)
        .where(and(eq(timeEntries.userId, userId), gte(timeEntries.startTime, weekStart))),
      db
        .select({ count: count() })
        .from(tasks)
        .where(and(eq(tasks.assignedTo, userId), eq(tasks.status, 'COMPLETED'), gte(tasks.completedAt, monthStart))),
      db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(6),
    ]);

    const byStatus = myTasks.reduce((acc: Record<string, number>, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    }, {});

    res.json({
      myTasks: toApi(myTasks),
      stats: {
        total: myTasks.length,
        overdue: overdue.count,
        dueToday: dueToday.count,
        weekHours: Math.round(((week?.minutes || 0) / 60) * 10) / 10,
        completedThisMonth: monthCompleted.count,
        byStatus,
      },
      recentNotifs: toApi(recentNotifs),
    });
  } catch (err) {
    sendError(res, err, 'Failed to fetch personal dashboard');
  }
});

/**
 * What the admin dashboard's cards count, shared by the figures and the lists behind them so the two always
 * agree: the projects a user may see, and whether they see company-wide CRM and revenue figures.
 */
function dashboardScope(req: AuthRequest) {
  const scope: SQL[] = [];
  if (TEAM_FILTERED_ROLES.includes(req.user!.role)) {
    scope.push(inMemberProjects(projects.id, req.user!.id));
  } else if (req.user!.role === 'CLIENT') {
    scope.push(req.user!.clientId ? eq(projects.clientId, req.user!.clientId) : sql`false`);
  }
  // Company-wide CRM and revenue figures are for management only (clients and staff get project-scoped data)
  const seesCompany = COMPANY_VIEW_ROLES.includes(req.user!.role);
  const now = new Date();
  return {
    scope,
    seesCompany,
    company: seesCompany ? undefined : sql`false`,
    activeProject: inArray(projects.projectStatus, ['ACTIVE', 'ON_HOLD']),
    openLead: notInArray(leads.stage, ['WON', 'LOST']),
    followUpCutoff: new Date(now.getTime() - 7 * 86_400_000),
    monthStart: new Date(now.getFullYear(), now.getMonth(), 1),
    nextMonthStart: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    lastMonthStart: new Date(now.getFullYear(), now.getMonth() - 1, 1),
  };
}

const invoiceTotal = sql<number>`coalesce(${invoices.grandTotal}, ${invoices.amount})::float8`;
const DETAIL_LIMIT = 500;

/** The records behind one dashboard card: active projects, open leads, clients, or this month's paid invoices */
router.get('/details/:kind', async (req: AuthRequest, res) => {
  try {
    const d = dashboardScope(req);
    switch (req.params.kind) {
      case 'projects': {
        const rows = await db
          .select({ id: projects.id, name: projects.projectName, client: projects.clientName, status: projects.projectStatus, endDate: projects.endDate })
          .from(projects)
          .where(and(d.activeProject, ...d.scope))
          .orderBy(sql`${projects.endDate} asc nulls last`, asc(projects.projectName))
          .limit(DETAIL_LIMIT);
        return res.json({ rows });
      }
      case 'leads': {
        const needsFollowUp = sql<boolean>`coalesce(${leads.lastContactAt}, ${leads.createdAt}) < ${d.followUpCutoff}`;
        const rows = await db
          .select({
            id: leads.id, company: leads.companyName, contact: leads.contactName, phone: leads.phone, stage: leads.stage,
            owner: users.name, lastContactAt: leads.lastContactAt, createdAt: leads.createdAt, value: leads.estimatedValue, needsFollowUp,
          })
          .from(leads)
          .leftJoin(users, eq(users.id, leads.assignedTo))
          .where(and(d.openLead, d.company))
          .orderBy(desc(needsFollowUp), desc(leads.createdAt))
          .limit(DETAIL_LIMIT);
        return res.json({ rows });
      }
      // Clients with at least one active or on-hold project
      case 'clients': {
        const rows = await db
          .select({
            id: clients.id, company: clients.companyName, contact: clients.contactName, phone: clients.phone, email: clients.contactEmail,
            activeProjects: sql<number>`count(${projects.id})::int`,
          })
          .from(clients)
          .innerJoin(projects, and(eq(projects.clientId, clients.id), d.activeProject))
          .where(d.company)
          .groupBy(clients.id)
          .orderBy(asc(clients.companyName))
          .limit(DETAIL_LIMIT);
        return res.json({ rows });
      }
      case 'revenue': {
        const rows = await db
          .select({ id: invoices.id, number: invoices.invoiceNumber, client: clients.companyName, paidAt: invoices.paidAt, total: invoiceTotal })
          .from(invoices)
          .leftJoin(clients, eq(clients.id, invoices.clientId))
          .where(and(eq(invoices.status, 'paid'), gte(invoices.paidAt, d.monthStart), lt(invoices.paidAt, d.nextMonthStart), d.company))
          .orderBy(desc(invoices.paidAt))
          .limit(DETAIL_LIMIT);
        return res.json({ rows });
      }
      default:
        return res.status(404).json({ message: 'Unknown dashboard card' });
    }
  } catch (err) {
    sendError(res, err, 'Failed to load the list');
  }
});

router.get('/', async (req: AuthRequest, res) => {
  try {
    const { scope, seesCompany, company, activeProject, openLead, followUpCutoff, monthStart, nextMonthStart, lastMonthStart } = dashboardScope(req);
    const paidBetween = (from: Date, to: Date) =>
      db
        .select({ total: sql<number>`coalesce(sum(${invoiceTotal}), 0)::float8` })
        .from(invoices)
        .where(and(eq(invoices.status, 'paid'), gte(invoices.paidAt, from), lt(invoices.paidAt, to), company));

    const [[projectCounts], [activeClients], [leadCounts], [revenueThisMonth], [revenueLastMonth], topLeads, teamWorkload, recent] =
      await Promise.all([
        db
          .select({
            active: sql<number>`count(*) filter (where ${activeProject})::int`,
            onTrack: sql<number>`count(*) filter (where ${projects.projectStatus} = 'ACTIVE')::int`,
          })
          .from(projects)
          .where(and(...scope)),
        // Clients with at least one active or on-hold project
        db
          .select({ count: sql<number>`count(distinct ${clients.id})::int` })
          .from(clients)
          .innerJoin(projects, and(eq(projects.clientId, clients.id), activeProject))
          .where(company),
        db
          .select({
            open: sql<number>`count(*) filter (where ${openLead})::int`,
            needFollowUp: sql<number>`count(*) filter (where ${openLead} and coalesce(${leads.lastContactAt}, ${leads.createdAt}) < ${followUpCutoff})::int`,
          })
          .from(leads)
          .where(company),
        paidBetween(monthStart, nextMonthStart),
        paidBetween(lastMonthStart, monthStart),
        db
          .select({ company: leads.companyName, service: leads.service, estimatedValue: leads.estimatedValue, stage: leads.stage })
          .from(leads)
          .where(and(openLead, company))
          .orderBy(desc(leads.estimatedValue))
          .limit(5),
        seesCompany ? teamWorkloadQuery() : Promise.resolve([]),
        db.query.activities.findMany({
          where: seesCompany
            ? undefined
            : inArray(activities.projectId, db.select({ id: projects.id }).from(projects).where(and(...scope))),
          with: { actor: pick.userName },
          orderBy: [desc(activities.createdAt)],
          limit: 8,
        }),
      ]);

    const thisMonth = revenueThisMonth?.total ?? 0;
    const lastMonth = revenueLastMonth?.total ?? 0;
    const busiest = Math.max(1, ...teamWorkload.map((u) => u.taskCount));

    res.json({
      kpis: {
        activeProjects: projectCounts.active,
        onTrack: projectCounts.onTrack,
        openLeads: leadCounts.open,
        needFollowUp: leadCounts.needFollowUp,
        activeClients: activeClients.count,
        revenueMTD: thisMonth,
        revenueChange: lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : thisMonth > 0 ? 100 : 0,
      },
      leads: topLeads.map((l) => ({ ...l, service: l.service || '—', estimatedValue: l.estimatedValue || 0 })),
      // capacity = the busiest person's load, so bars compare people against each other
      teamWorkload: toApi(teamWorkload).map((u) => ({ ...u, capacity: busiest })),
      activities: recent.map((a) => ({
        date: a.createdAt,
        userName: a.actor?.name ?? 'System',
        description: `${a.actor?.name ?? 'Someone'} · ${a.action.replace(/[._]/g, ' ')}${
          typeof a.metadata?.description === 'string' ? ` — ${a.metadata.description}` : ''
        }`,
        status: a.entityType ?? 'Activity',
      })),
    });
  } catch (err) {
    sendError(res, err, 'Failed to fetch dashboard');
  }
});

export default router;
