import { and, eq, gte, lte, ne } from 'drizzle-orm';
import { db } from '../db/index';
import { projects, tasks, users } from '../db/schema';
import { sendEmail, deadlineReminderTemplate } from '../services/emailService';

/** Hourly: emails assignees of unfinished tasks due within the next 24 hours */
export async function runDeadlineReminders(): Promise<void> {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const due = await db
    .select({ title: tasks.title, deadline: tasks.deadline, email: users.email, projectName: projects.projectName })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.assignedTo))
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(gte(tasks.deadline, now), lte(tasks.deadline, in24h), ne(tasks.status, 'COMPLETED')));

  await Promise.all(
    // Staff who sign in by employee ID may have no email address
    due.flatMap((t) => (t.email ? [{ ...t, email: t.email }] : [])).map((t) =>
      sendEmail(
        t.email,
        'Task Deadline Reminder',
        deadlineReminderTemplate({
          taskName: t.title,
          projectName: t.projectName || 'Unknown',
          deadline: t.deadline?.toLocaleString('en-IN', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }) || '',
        }),
        'deadline-reminder'
      )
    )
  );
}
