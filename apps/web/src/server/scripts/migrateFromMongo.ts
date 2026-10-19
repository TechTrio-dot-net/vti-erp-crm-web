/**
 * One-time copy of all data from MongoDB into PostgreSQL.
 *
 *   MONGODB_URI=mongodb+srv://... [MONGODB_DB=test] pnpm run migrate:mongo
 *
 * - ObjectIds become deterministic UUIDs (24 hex chars + 8 zeros), so every reference stays intact
 *   and re-running the script is idempotent (existing rows are skipped).
 * - References to documents that no longer exist are set to null (or the row is skipped when the
 *   column is required), since Postgres enforces foreign keys.
 * - Everything runs in one transaction: either all data lands or nothing does.
 * MongoDB is only read, never modified.
 */
import '../env';
import { MongoClient, type Document } from 'mongodb';
import { sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { db, pool } from '../db/index';
import { runMigrations } from '../db/migrate';
import * as s from '../db/schema';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is required');
  process.exit(1);
}

function uuidFromObjectId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const hex = String(value).toLowerCase();
  if (!/^[0-9a-f]{24}$/.test(hex)) return null;
  const h = `${hex}00000000`;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const date = (v: unknown): Date | null => {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
};
const num = (v: unknown, fallback: number | null = null): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** Ids known to exist in Postgres per table — used to null out dangling references */
const known = new Map<string, Set<string>>();
function ref(table: string, value: unknown): string | null {
  const id = uuidFromObjectId(value);
  return id && known.get(table)?.has(id) ? id : null;
}
function refs(table: string, values: unknown): string[] {
  return Array.isArray(values) ? values.map((v) => ref(table, v)).filter((v): v is string => !!v) : [];
}
function timestampsOf(doc: Document) {
  const createdAt = date(doc.createdAt) ?? new Date();
  return { createdAt, updatedAt: date(doc.updatedAt) ?? createdAt };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function copy<T extends PgTable>(
  tx: Tx,
  mongo: import('mongodb').Db,
  collection: string,
  table: T,
  tableKey: string,
  map: (doc: Document) => T['$inferInsert'] | null
): Promise<void> {
  const docs = await mongo.collection(collection).find().toArray();
  const rows: T['$inferInsert'][] = [];
  let skipped = 0;
  for (const doc of docs) {
    const row = map(doc);
    if (row) rows.push(row);
    else skipped++;
  }
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const result = await tx
      .insert(table)
      .values(rows.slice(i, i + 500) as T['$inferInsert'][])
      .onConflictDoNothing()
      .returning();
    inserted += result.length;
  }
  const ids = known.get(tableKey) ?? new Set<string>();
  for (const r of rows as Array<{ id?: string }>) if (r.id) ids.add(r.id);
  known.set(tableKey, ids);
  console.log(
    `  ${collection.padEnd(18)} → ${tableKey.padEnd(20)} ${String(inserted).padStart(4)} inserted` +
      `${rows.length - inserted ? `, ${rows.length - inserted} already present` : ''}${skipped ? `, ${skipped} skipped (missing required reference)` : ''}`
  );
}

async function main() {
  await runMigrations();
  const mongoClient = new MongoClient(MONGODB_URI!, { serverSelectionTimeoutMS: 15_000 });
  await mongoClient.connect();
  const mongo = mongoClient.db(process.env.MONGODB_DB || undefined);
  console.log(`Reading MongoDB database "${mongo.databaseName}" → PostgreSQL\n`);

  try {
    await db.transaction(async (tx) => {
      // Seed "known" with rows already in Postgres so re-runs resolve references correctly
      for (const [key, table] of Object.entries({ clients: s.clients, users: s.users, projects: s.projects, tasks: s.tasks, files: s.files, comments: s.comments, permissions: s.permissions, roles: s.roles })) {
        const existing = await tx.select({ id: (table as typeof s.users).id }).from(table as typeof s.users);
        known.set(key, new Set(existing.map((r) => r.id)));
      }

      await copy(tx, mongo, 'clients', s.clients, 'clients', (d) => ({
        id: uuidFromObjectId(d._id)!,
        companyName: str(d.companyName) ?? 'Unknown',
        contactName: str(d.contactName) ?? '',
        contactEmail: str(d.contactEmail) ?? `unknown-${d._id}@example.invalid`,
        phone: str(d.phone),
        address: str(d.address),
        portalLogin: str(d.portalLogin) ?? `client-${d._id}`,
        ...timestampsOf(d),
      }));

      await copy(tx, mongo, 'permissions', s.permissions, 'permissions', (d) => ({
        id: uuidFromObjectId(d._id)!,
        module: String(d.module),
        resource: String(d.resource),
        actions: Array.isArray(d.actions) ? d.actions.map(String) : [],
        scope: d.scope ?? null,
        ...timestampsOf(d),
      }));

      await copy(tx, mongo, 'users', s.users, 'users', (d) => ({
        id: uuidFromObjectId(d._id)!,
        email: String(d.email),
        username: String(d.username),
        passwordHash: String(d.passwordHash),
        name: str(d.name) ?? String(d.username),
        role: d.role,
        initials: str(d.initials),
        avatarUrl: str(d.avatarUrl),
        clientId: ref('clients', d.clientId),
        isActive: d.isActive !== false,
        lastLoginAt: date(d.lastLoginAt),
        resetToken: str(d.resetToken),
        resetTokenExpiry: date(d.resetTokenExpiry),
        roleIds: [], // filled after roles are copied
        ...timestampsOf(d),
      }));

      await copy(tx, mongo, 'roles', s.roles, 'roles', (d) => ({
        id: uuidFromObjectId(d._id)!,
        name: String(d.name),
        slug: String(d.slug),
        description: str(d.description),
        permissionIds: refs('permissions', d.permissionIds),
        isSystem: !!d.isSystem,
        createdBy: ref('users', d.createdBy),
        updatedBy: ref('users', d.updatedBy),
        ...timestampsOf(d),
      }));

      // users.roleIds (no FK — just map ids that exist)
      for (const u of await mongo.collection('users').find({ 'roleIds.0': { $exists: true } }).toArray()) {
        const roleIds = refs('roles', u.roleIds);
        if (roleIds.length) {
          await tx.update(s.users).set({ roleIds }).where(sql`${s.users.id} = ${uuidFromObjectId(u._id)} AND cardinality(${s.users.roleIds}) = 0`);
        }
      }

      const projectDocs = await mongo.collection('projects').find().toArray();
      await copy(tx, mongo, 'projects', s.projects, 'projects', (d) => {
        const clientId = ref('clients', d.clientId);
        if (!clientId) return null;
        return {
          id: uuidFromObjectId(d._id)!,
          projectName: String(d.projectName),
          clientId,
          clientName: str(d.clientName) ?? '',
          clientEmail: str(d.clientEmail) ?? '',
          startDate: date(d.startDate),
          endDate: date(d.endDate),
          projectStatus: d.projectStatus ?? 'ACTIVE',
          description: str(d.description),
          createdBy: ref('users', d.createdBy),
          ...timestampsOf(d),
        };
      });

      const memberRows = projectDocs.flatMap((p) => {
        const projectId = ref('projects', p._id);
        return projectId ? [...new Set(refs('users', p.teamMembers))].map((userId) => ({ projectId, userId })) : [];
      });
      if (memberRows.length) await tx.insert(s.projectTeamMembers).values(memberRows).onConflictDoNothing();
      console.log(`  ${'projects.teamMembers'.padEnd(18)} → ${'project_team_members'.padEnd(20)} ${String(memberRows.length).padStart(4)} links`);

      await copy(tx, mongo, 'tasks', s.tasks, 'tasks', (d) => {
        const projectId = ref('projects', d.projectId);
        if (!projectId) return null;
        return {
          id: uuidFromObjectId(d._id)!,
          projectId,
          title: String(d.title),
          description: str(d.description),
          assignedTo: ref('users', d.assignedTo),
          priority: d.priority ?? 'MEDIUM',
          deadline: date(d.deadline),
          status: d.status ?? 'BACKLOG',
          tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
          position: num(d.position, 0)!,
          attachments: (Array.isArray(d.attachments) ? d.attachments : []).map(uuidFromObjectId).filter(Boolean) as string[],
          approvalStatus: d.approvalStatus ?? null,
          approvedBy: ref('users', d.approvedBy),
          approvedAt: date(d.approvedAt),
          rejectionReason: str(d.rejectionReason),
          completedAt: date(d.completedAt),
          createdBy: ref('users', d.createdBy),
          ...timestampsOf(d),
        };
      });

      await copy(tx, mongo, 'files', s.files, 'files', (d) => ({
        id: uuidFromObjectId(d._id)!,
        filename: String(d.filename),
        mimeType: String(d.mimeType),
        size: num(d.size, 0)!,
        url: String(d.url),
        storageKey: String(d.storageKey),
        projectId: ref('projects', d.projectId),
        taskId: ref('tasks', d.taskId),
        uploadedBy: ref('users', d.uploadedBy),
        version: num(d.version, 1)!,
        versions: (Array.isArray(d.versions) ? d.versions : []).map((v: Document) => ({
          version: num(v.version, 1)!,
          url: String(v.url),
          storageKey: String(v.storageKey),
          uploadedAt: (date(v.uploadedAt) ?? new Date()).toISOString(),
          uploadedBy: uuidFromObjectId(v.uploadedBy) ?? '',
        })),
        ...timestampsOf(d),
      }));

      await copy(tx, mongo, 'timeentries', s.timeEntries, 'time_entries', (d) => {
        const projectId = ref('projects', d.projectId);
        const startTime = date(d.startTime);
        if (!projectId || !startTime) return null;
        return {
          id: uuidFromObjectId(d._id)!,
          userId: ref('users', d.userId),
          taskId: ref('tasks', d.taskId),
          projectId,
          startTime,
          endTime: date(d.endTime) ?? startTime,
          totalMinutes: Math.round(num(d.totalMinutes, 0)!),
          notes: str(d.notes),
          ...timestampsOf(d),
        };
      });

      await copy(tx, mongo, 'activetimers', s.activeTimers, 'active_timers', (d) => {
        const userId = ref('users', d.userId);
        const taskId = ref('tasks', d.taskId);
        const projectId = ref('projects', d.projectId);
        const startTime = date(d.startTime);
        return userId && taskId && projectId && startTime ? { userId, taskId, projectId, startTime } : null;
      });

      await copy(tx, mongo, 'contentcalendars', s.contentCalendar, 'content_calendar', (d) => {
        const projectId = ref('projects', d.projectId);
        const postDate = date(d.date);
        if (!projectId || !postDate) return null;
        return {
          id: uuidFromObjectId(d._id)!,
          projectId,
          date: postDate,
          platform: d.platform,
          postType: d.postType,
          caption: str(d.caption),
          creativeFileId: ref('files', d.creativeFileId),
          status: d.status ?? 'PLANNED',
          position: num(d.position, 0)!,
          approvedBy: ref('users', d.approvedBy),
          approvedAt: date(d.approvedAt),
          postedAt: date(d.postedAt),
          createdBy: ref('users', d.createdBy),
          ...timestampsOf(d),
        };
      });

      await copy(tx, mongo, 'adcampaigns', s.adCampaigns, 'ad_campaigns', (d) => {
        const projectId = ref('projects', d.projectId);
        if (!projectId) return null;
        return {
          id: uuidFromObjectId(d._id)!,
          projectId,
          campaignName: String(d.campaignName),
          platform: d.platform,
          dailyBudget: num(d.dailyBudget, 0)!,
          startDate: date(d.startDate),
          endDate: date(d.endDate),
          status: d.status ?? 'ACTIVE',
          impressions: Math.round(num(d.impressions, 0)!),
          clicks: Math.round(num(d.clicks, 0)!),
          ctr: num(d.ctr, 0)!,
          cpc: num(d.cpc, 0)!,
          leads: Math.round(num(d.leads, 0)!),
          notes: str(d.notes),
          ...timestampsOf(d),
        };
      });

      await copy(tx, mongo, 'leads', s.leads, 'leads', (d) => ({
        id: uuidFromObjectId(d._id)!,
        companyName: str(d.companyName) ?? 'Unknown',
        contactName: str(d.contactName),
        email: str(d.email),
        phone: str(d.phone),
        source: str(d.source),
        service: str(d.service),
        stage: str(d.stage) ?? 'AWARENESS',
        assignedTo: ref('users', d.assignedTo),
        estimatedValue: num(d.estimatedValue),
        notes: str(d.notes),
        clientId: ref('clients', d.clientId),
        lastContactAt: date(d.lastContactAt),
        createdBy: ref('users', d.createdBy),
        updatedBy: ref('users', d.updatedBy),
        ...timestampsOf(d),
      }));

      await copy(tx, mongo, 'invoices', s.invoices, 'invoices', (d) => {
        const clientId = ref('clients', d.clientId);
        if (!clientId) return null;
        return {
          id: uuidFromObjectId(d._id)!,
          invoiceNumber: String(d.invoiceNumber),
          clientId,
          projectId: ref('projects', d.projectId),
          amount: num(d.amount, 0)!,
          currency: str(d.currency) ?? 'INR',
          status: d.status ?? 'draft',
          issueDate: date(d.issueDate),
          dueDate: date(d.dueDate),
          items: (Array.isArray(d.items) ? d.items : []).map(({ _id, ...item }: Document) => item as s.InvoiceItem),
          notes: str(d.notes),
          placeOfSupply: str(d.placeOfSupply) ?? 'Gujarat',
          isIntraState: d.isIntraState !== false,
          gstExempt: !!d.gstExempt,
          subTotal: num(d.subTotal),
          totalTax: num(d.totalTax),
          grandTotal: num(d.grandTotal),
          createdBy: ref('users', d.createdBy),
          updatedBy: ref('users', d.updatedBy),
          ...timestampsOf(d),
        };
      });

      await copy(tx, mongo, 'notifications', s.notifications, 'notifications', (d) => {
        const userId = ref('users', d.userId);
        if (!userId) return null;
        return {
          id: uuidFromObjectId(d._id)!,
          userId,
          title: String(d.title),
          body: str(d.body),
          type: str(d.type),
          link: str(d.link),
          read: !!d.read,
          readAt: date(d.readAt),
          metadata: d.metadata ?? null,
          ...timestampsOf(d),
        };
      });

      // Comments reference each other: insert without parentId, then link replies
      const commentDocs = await mongo.collection('comments').find().toArray();
      await copy(tx, mongo, 'comments', s.comments, 'comments', (d) => {
        const projectId = ref('projects', d.projectId);
        const entityId = uuidFromObjectId(d.entityId);
        if (!projectId || !entityId) return null;
        return {
          id: uuidFromObjectId(d._id)!,
          entityType: d.entityType,
          entityId,
          projectId,
          content: String(d.content),
          authorId: ref('users', d.authorId),
          isInternal: !!d.isInternal,
          mentions: refs('users', d.mentions),
          attachments: (Array.isArray(d.attachments) ? d.attachments : []).map(uuidFromObjectId).filter(Boolean) as string[],
          ...timestampsOf(d),
        };
      });
      for (const c of commentDocs) {
        const id = ref('comments', c._id);
        const parentId = ref('comments', c.parentId);
        if (id && parentId) await tx.update(s.comments).set({ parentId }).where(sql`${s.comments.id} = ${id}`);
      }

      await copy(tx, mongo, 'activities', s.activities, 'activities', (d) => ({
        id: uuidFromObjectId(d._id)!,
        projectId: ref('projects', d.projectId),
        action: String(d.action),
        entityType: str(d.entityType),
        entityId: uuidFromObjectId(d.entityId),
        actorId: ref('users', d.actorId),
        metadata: d.metadata ?? null,
        createdAt: date(d.createdAt) ?? new Date(),
      }));

      await copy(tx, mongo, 'emaillogs', s.emailLogs, 'email_logs', (d) => ({
        id: uuidFromObjectId(d._id)!,
        template: str(d.template) ?? 'unknown',
        to: Array.isArray(d.to) ? d.to.map(String) : [],
        subject: str(d.subject),
        status: d.status === 'sent' ? ('sent' as const) : ('failed' as const),
        resendId: str(d.resendId),
        error: str(d.error),
        metadata: d.metadata ?? null,
        createdAt: date(d.createdAt) ?? new Date(),
      }));
    });
    console.log('\nMigration complete.');
  } finally {
    await mongoClient.close();
  }
}

main()
  .catch((err) => {
    console.error('\nMigration failed — no data was written:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
