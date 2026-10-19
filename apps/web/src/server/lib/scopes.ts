import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { db } from '../db/index';
import { projects, projectTeamMembers } from '../db/schema';

// Row-visibility filters expressed as subqueries, so scoping costs no extra round-trip.

/** `column IN (projects the user is a team member of)` */
export function inMemberProjects(column: PgColumn, userId: string): SQL {
  return inArray(column, db.select({ id: projectTeamMembers.projectId }).from(projectTeamMembers).where(eq(projectTeamMembers.userId, userId)));
}

/** `column IN (projects belonging to the client)`; a client user without a client profile sees nothing */
export function inClientProjects(column: PgColumn, clientId: string | undefined): SQL {
  if (!clientId) return sql`false`;
  return inArray(column, db.select({ id: projects.id }).from(projects).where(eq(projects.clientId, clientId)));
}

/** `column IN (projects the user created)` */
export function inCreatedProjects(column: PgColumn, userId: string): SQL {
  return inArray(column, db.select({ id: projects.id }).from(projects).where(eq(projects.createdBy, userId)));
}

export async function isProjectMember(projectId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ one: sql`1` })
    .from(projectTeamMembers)
    .where(and(eq(projectTeamMembers.projectId, projectId), eq(projectTeamMembers.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

/** Column selections for populated references — mirrors the old `.populate(path, 'fields')` lists */
export const pick = {
  userName: { columns: { id: true, name: true, initials: true } },
  userNameEmail: { columns: { id: true, name: true, initials: true, email: true } },
  projectName: { columns: { id: true, projectName: true } },
  projectNameClient: { columns: { id: true, projectName: true, clientId: true } },
  clientName: { columns: { id: true, companyName: true, contactEmail: true } },
  taskTitle: { columns: { id: true, title: true } },
  fileUrl: { columns: { id: true, url: true, filename: true } },
  teamMembers: { columns: {}, with: { user: { columns: { id: true, name: true, initials: true } } } },
} as const;
