import '../env';
import { and, count, eq, isNotNull } from 'drizzle-orm';
import { db, pool } from '../db/index';
import { runMigrations } from '../db/migrate';
import {
  activities,
  adCampaigns,
  clients,
  contentCalendar,
  notifications,
  projects,
  projectTeamMembers,
  tasks,
  timeEntries,
  users,
  type ProjectStatus,
  type TaskStatus,
} from '../db/schema';
import { hashPassword } from '../utils/password';
import { seedCatalog } from '../erp/seed/catalog';
import { ensureErpDefaults } from '../erp/seed/defaults';

const SEED_USERS = [
  { username: 'adarsh', email: 'adarsh@example.com', name: 'Adarsh Sharma', password: 'admin123', role: 'SUPER_ADMIN' as const },
  { username: 'dheeraj', email: 'dheeraj@example.com', name: 'Dheeraj Sharma', password: 'admin123', role: 'SUPER_ADMIN' as const },
  { username: 'aditi', email: 'aditi@example.com', name: 'Aditi Parmar', password: 'admin123', role: 'SUPER_ADMIN' as const },
  { username: 'shital', email: 'shital@example.com', name: 'Shital Gahiwad', password: 'emp123', role: 'TEAM_MEMBER' as const },
  { username: 'poojan', email: 'poojan@example.com', name: 'Poojan Prajapati', password: 'emp123', role: 'TEAM_MEMBER' as const },
];

const SEED_CLIENTS = [
  { companyName: 'DevEng Solutions', contactName: 'Dev Eng', contactEmail: 'deveng@example.com', portalLogin: 'deveng' },
  { companyName: 'HQ Tech', contactName: 'HQ Tech', contactEmail: 'hqtech@example.com', portalLogin: 'hqtech' },
];

const CLIENT_USERS = [
  { username: 'deveng', email: 'deveng@example.com', name: 'Dev Eng', password: 'client123', portalLogin: 'deveng' },
  { username: 'hqtech', email: 'hqtech@example.com', name: 'HQ Tech', password: 'client123', portalLogin: 'hqtech' },
];

// Fake data for seeding
const FAKE_PROJECT_NAMES = [
  'Website Redesign',
  'Brand Identity Package',
  'Social Media Campaign',
  'SEO Optimization',
  'Mobile App Development',
  'Content Marketing',
  'PPC Campaign Setup',
];

const FAKE_TASK_TITLES = [
  'Create wireframes',
  'Design homepage mockup',
  'Set up analytics',
  'Write blog content',
  'Review competitor analysis',
  'Client feedback session',
  'Final QA testing',
  'Deploy to staging',
  'Update documentation',
  'Create social assets',
  'Setup ad campaigns',
  'Keyword research',
];

const FAKE_NOTIFICATIONS = [
  { title: 'Task completed', body: 'Shital completed "Design homepage mockup"' },
  { title: 'New comment', body: 'Adarsh commented on "Create wireframes"' },
  { title: 'Approval needed', body: 'Deliverable awaiting your approval' },
  { title: 'Deadline reminder', body: 'Task "Final QA testing" due tomorrow' },
  { title: 'Project update', body: 'Website Redesign moved to Review' },
];

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function randomPick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function initialsOf(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

/** Picks `n` distinct random items */
function sample<T>(arr: readonly T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

async function seed() {
  await runMigrations();
  console.log('Connected to PostgreSQL');

  // Roles, settings and the quotation catalog (services, languages, artists, rates)
  await ensureErpDefaults();
  await seedCatalog();
  console.log('Seeded roles, company settings and the quotation catalog');

  // --- Users ---
  for (const u of SEED_USERS) {
    const [created] = await db
      .insert(users)
      .values({
        username: u.username,
        email: u.email,
        name: u.name,
        passwordHash: await hashPassword(u.password),
        role: u.role,
        initials: initialsOf(u.name),
      })
      .onConflictDoNothing()
      .returning({ id: users.id });
    console.log(created ? `Created user: ${u.username}` : `User ${u.username} already exists, skipping`);
  }

  // --- Clients ---
  for (const c of SEED_CLIENTS) {
    const [created] = await db.insert(clients).values(c).onConflictDoNothing().returning({ id: clients.id });
    console.log(created ? `Created client: ${c.portalLogin}` : `Client ${c.portalLogin} already exists, skipping`);
  }

  // --- Client users ---
  for (const cu of CLIENT_USERS) {
    const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.portalLogin, cu.portalLogin)).limit(1);
    if (!client) continue;
    const [created] = await db
      .insert(users)
      .values({
        username: cu.username,
        email: cu.email,
        name: cu.name,
        passwordHash: await hashPassword(cu.password),
        role: 'CLIENT',
        clientId: client.id,
        initials: initialsOf(cu.name),
      })
      .onConflictDoNothing()
      .returning({ id: users.id });
    console.log(created ? `Created client user: ${cu.username}` : `Client user ${cu.username} already exists, skipping`);
  }

  // --- Fetch IDs for fake data ---
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, 'SUPER_ADMIN'));
  const teamMembers = await db.select({ id: users.id }).from(users).where(eq(users.role, 'TEAM_MEMBER'));
  const allStaff = [...admins, ...teamMembers];
  const allClients = await db.select({ id: clients.id, contactName: clients.contactName, contactEmail: clients.contactEmail }).from(clients);
  const creatorId = admins[0]?.id;

  if (!creatorId || allStaff.length === 0 || allClients.length === 0) {
    console.log('Skipping fake data: missing users or clients');
    return;
  }

  // --- Projects ---
  const projectStatuses: ProjectStatus[] = ['ACTIVE', 'ACTIVE', 'ACTIVE', 'ON_HOLD', 'COMPLETED'];
  let seededProjects: { id: string; clientName: string }[] = [];

  for (const client of allClients) {
    for (const name of sample(FAKE_PROJECT_NAMES, randomInt(2, 4))) {
      const [existing] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.projectName, name), eq(projects.clientId, client.id)))
        .limit(1);
      if (existing) continue;

      const startDate = addDays(new Date(), -randomInt(30, 90));
      const [project] = await db
        .insert(projects)
        .values({
          projectName: name,
          clientId: client.id,
          clientName: client.contactName,
          clientEmail: client.contactEmail,
          startDate,
          endDate: addDays(startDate, randomInt(60, 120)),
          projectStatus: randomPick(projectStatuses),
          description: `Fake project: ${name} for ${client.contactName}`,
          createdBy: creatorId,
        })
        .returning({ id: projects.id });
      const members = teamMembers.slice(0, randomInt(1, 2));
      if (members.length) {
        await db.insert(projectTeamMembers).values(members.map((m) => ({ projectId: project.id, userId: m.id })));
      }
      seededProjects.push({ id: project.id, clientName: client.contactName });
      console.log(`Created project: ${name}`);
    }
  }

  // If no new projects created, use existing projects for tasks/calendar/ads
  if (seededProjects.length === 0) {
    seededProjects = await db.select({ id: projects.id, clientName: projects.clientName }).from(projects);
    if (seededProjects.length === 0) {
      console.log('No projects found, skipping fake data');
      return;
    }
    console.log(`Using ${seededProjects.length} existing projects for fake data`);
  }

  // --- Tasks ---
  const taskStatuses: TaskStatus[] = ['BACKLOG', 'TO_DO', 'IN_PROGRESS', 'REVIEW', 'COMPLETED'];
  const priorities = ['LOW', 'MEDIUM', 'HIGH'] as const;

  for (const proj of seededProjects) {
    const [{ value: existingTaskCount }] = await db.select({ value: count() }).from(tasks).where(eq(tasks.projectId, proj.id));
    if (existingTaskCount >= 8) continue; // Skip if project already has enough tasks

    const titles = sample(FAKE_TASK_TITLES, randomInt(5, 12));
    await db.insert(tasks).values(
      titles.map((title, i) => {
        const status = randomPick(taskStatuses);
        return {
          projectId: proj.id,
          title,
          description: `Fake task for ${proj.clientName}`,
          assignedTo: randomPick(allStaff).id,
          priority: randomPick(priorities),
          deadline: addDays(new Date(), randomInt(-5, 14)),
          status,
          position: i,
          approvalStatus: status === 'REVIEW' ? ('PENDING' as const) : undefined,
          completedAt: status === 'COMPLETED' ? new Date() : undefined,
          createdBy: creatorId,
        };
      })
    );
    console.log(`Created ${titles.length} tasks for project`);
  }

  // --- Time entries ---
  const tasksWithAssignee = await db
    .select({ id: tasks.id, projectId: tasks.projectId, assignedTo: tasks.assignedTo })
    .from(tasks)
    .where(isNotNull(tasks.assignedTo))
    .limit(30);

  if (tasksWithAssignee.length) {
    await db.insert(timeEntries).values(
      tasksWithAssignee.map((t) => {
        const mins = randomInt(30, 240);
        const start = addDays(new Date(), -randomInt(0, 7));
        start.setHours(9, 0, 0, 0);
        return {
          userId: t.assignedTo,
          taskId: t.id,
          projectId: t.projectId,
          startTime: start,
          endTime: new Date(start.getTime() + mins * 60_000),
          totalMinutes: mins,
          notes: 'Fake time entry',
        };
      })
    );
  }
  console.log(`Created ${tasksWithAssignee.length} time entries`);

  // --- Content calendar ---
  const platforms = ['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'YOUTUBE'] as const;
  const postTypes = ['REEL', 'CAROUSEL', 'STATIC', 'STORY', 'VIDEO'] as const;
  const contentStatuses = ['PLANNED', 'DESIGNING', 'APPROVAL', 'SCHEDULED', 'POSTED'] as const;

  for (const proj of seededProjects.slice(0, 4)) {
    await db.insert(contentCalendar).values(
      Array.from({ length: randomInt(3, 8) }, (_, i) => ({
        projectId: proj.id,
        date: addDays(new Date(), randomInt(0, 30)),
        platform: randomPick(platforms),
        postType: randomPick(postTypes),
        caption: `Fake post for ${proj.clientName}`,
        status: randomPick(contentStatuses),
        position: i,
        createdBy: creatorId,
      }))
    );
    console.log('Created content calendar items for project');
  }

  // --- Ad campaigns ---
  const adPlatforms = ['META_ADS', 'GOOGLE_ADS'] as const;
  const adStatuses = ['ACTIVE', 'PAUSED', 'COMPLETED'] as const;

  for (const proj of seededProjects.slice(0, 3)) {
    await db.insert(adCampaigns).values(
      Array.from({ length: randomInt(1, 3) }, (_, i) => {
        const startDate = addDays(new Date(), -randomInt(0, 30));
        return {
          projectId: proj.id,
          campaignName: `Campaign ${i + 1} - ${randomPick(['Brand', 'Lead Gen', 'Retargeting'])}`,
          platform: randomPick(adPlatforms),
          dailyBudget: randomInt(500, 5000),
          startDate,
          endDate: addDays(startDate, randomInt(14, 60)),
          status: randomPick(adStatuses),
          impressions: randomInt(1000, 50000),
          clicks: randomInt(50, 500),
          ctr: Math.random() * 5,
          cpc: randomInt(10, 100),
          leads: randomInt(0, 20),
        };
      })
    );
    console.log('Created ad campaigns for project');
  }

  // --- Notifications (for dashboard activity feed) ---
  const notifCounts = await db
    .select({ userId: users.id, value: count(notifications.id) })
    .from(users)
    .leftJoin(notifications, eq(notifications.userId, users.id))
    .groupBy(users.id);
  const needNotifs = notifCounts.filter((u) => u.value < 5);
  if (needNotifs.length) {
    await db.insert(notifications).values(
      needNotifs.flatMap((u) =>
        Array.from({ length: randomInt(2, 5) }, () => {
          const n = randomPick(FAKE_NOTIFICATIONS);
          return { userId: u.userId, title: n.title, body: n.body, type: 'info', read: Math.random() > 0.5 };
        })
      )
    );
  }
  console.log('Created notifications for users');

  // --- Activities (for project activity feed) ---
  const actions = ['task.created', 'task.updated', 'comment.added', 'file.uploaded', 'status.changed'];
  await db.insert(activities).values(
    seededProjects.flatMap((proj) =>
      Array.from({ length: randomInt(3, 8) }, () => ({
        projectId: proj.id,
        action: randomPick(actions),
        entityType: 'Task',
        actorId: randomPick(allStaff).id,
        metadata: { description: 'Fake activity' },
      }))
    )
  );
  console.log('Created activities for projects');
}

seed()
  .then(() => console.log('Seed complete'))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
