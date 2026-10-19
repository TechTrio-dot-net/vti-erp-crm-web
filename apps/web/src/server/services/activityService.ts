import { db } from '../db/index';
import { activities, notifications } from '../db/schema';

export async function logActivity(params: {
  projectId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  actorId: string;
  metadata?: Record<string, unknown>;
  notifyUserId?: string;
  notifyTitle?: string;
  notifyBody?: string;
  notifyLink?: string;
}): Promise<void> {
  await db.insert(activities).values({
    projectId: params.projectId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    actorId: params.actorId,
    metadata: params.metadata,
  });

  if (params.notifyUserId && params.notifyTitle) {
    await notifyUsers([params.notifyUserId], {
      title: params.notifyTitle,
      body: params.notifyBody,
      link: params.notifyLink,
      type: params.action,
    });
  }
}

/** Inserts one notification per user in a single statement; open browsers pick them up on their next poll */
export async function notifyUsers(
  userIds: string[],
  notification: { title: string; body?: string; type?: string; link?: string }
): Promise<void> {
  if (userIds.length === 0) return;
  await db.insert(notifications).values(userIds.map((userId) => ({ userId, ...notification })));
}
