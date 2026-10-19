import { Router, Response } from 'express';
import { and, asc, count, eq, gte, lte, type SQL } from 'drizzle-orm';
import { db } from '../db/index';
import { contentCalendar } from '../db/schema';
import { authMiddleware, requirePermission, requireRole, AuthRequest } from '../lib/auth';
import { optionalDate, optionalId, pickColumns, sendError, uuidParam } from '../lib/http';
import { inClientProjects, inMemberProjects, isProjectMember, pick } from '../lib/scopes';
import { toApi } from '../lib/serialize';

const router = Router();
router.use(authMiddleware);
router.param('id', uuidParam);

const MEMBER_SCOPED_ROLES = ['TEAM_MEMBER', 'DESIGNER'];
const EDITABLE_FIELDS = ['projectId', 'date', 'platform', 'postType', 'caption', 'creativeFileId', 'status', 'position', 'postedAt'] as const;
const postRelations = { project: pick.projectName, creativeFile: pick.fileUrl } as const;

function roleScope(req: AuthRequest): SQL | undefined {
  if (req.user?.role === 'CLIENT') return inClientProjects(contentCalendar.projectId, req.user.clientId);
  if (MEMBER_SCOPED_ROLES.includes(req.user?.role || '')) return inMemberProjects(contentCalendar.projectId, req.user!.id);
  return undefined;
}

function findPost(id: string) {
  return db.query.contentCalendar.findFirst({ where: eq(contentCalendar.id, id), with: postRelations });
}

router.get('/', requirePermission('marketing', 'read'), async (req: AuthRequest, res) => {
  try {
    const conditions: (SQL | undefined)[] = [roleScope(req)];
    const { platform, status } = req.query;
    const projectId = optionalId(req.query.projectId, 'projectId');
    const start = optionalDate(req.query.startDate, 'startDate');
    const end = optionalDate(req.query.endDate, 'endDate');
    if (projectId) conditions.push(eq(contentCalendar.projectId, projectId));
    if (typeof platform === 'string' && platform) conditions.push(eq(contentCalendar.platform, platform as typeof contentCalendar.$inferSelect.platform));
    if (typeof status === 'string' && status) conditions.push(eq(contentCalendar.status, status as typeof contentCalendar.$inferSelect.status));
    if (start) conditions.push(gte(contentCalendar.date, start));
    if (end) conditions.push(lte(contentCalendar.date, end));

    const rows = await db.query.contentCalendar.findMany({
      where: and(...conditions),
      with: { ...postRelations, creator: pick.userName },
      orderBy: [asc(contentCalendar.date), asc(contentCalendar.position)],
    });
    res.json(toApi(rows));
  } catch (err) {
    sendError(res, err, 'Failed to fetch content calendar');
  }
});

router.get('/summary', requirePermission('marketing', 'read'), async (req: AuthRequest, res) => {
  try {
    const start = optionalDate(req.query.startDate, 'startDate');
    const end = optionalDate(req.query.endDate, 'endDate');
    const counts = await db
      .select({ status: contentCalendar.status, count: count() })
      .from(contentCalendar)
      .where(and(roleScope(req), start ? gte(contentCalendar.date, start) : undefined, end ? lte(contentCalendar.date, end) : undefined))
      .groupBy(contentCalendar.status);

    const byStatus: Record<string, number> = {};
    for (const c of counts) byStatus[c.status] = c.count;
    const total = counts.reduce((s, c) => s + c.count, 0);
    res.json({ total, byStatus });
  } catch (err) {
    sendError(res, err, 'Failed to fetch summary');
  }
});

router.get('/:id', requirePermission('marketing', 'read'), async (req: AuthRequest, res) => {
  try {
    const post = await db.query.contentCalendar.findFirst({
      where: eq(contentCalendar.id, req.params.id as string),
      with: { project: pick.projectNameClient, creativeFile: pick.fileUrl, creator: pick.userName },
    });
    if (!post) return res.status(404).json({ message: 'Post not found' });
    if (req.user?.role === 'CLIENT' && post.project?.clientId !== req.user.clientId) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (MEMBER_SCOPED_ROLES.includes(req.user?.role || '') && !(await isProjectMember(post.projectId, req.user!.id))) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    res.json(toApi(post));
  } catch (err) {
    sendError(res, err, 'Failed to fetch post');
  }
});

router.patch('/:id/reorder', requirePermission('marketing', 'update'), async (req, res) => {
  try {
    const { position } = pickColumns(contentCalendar, req.body, ['position']);
    const [updated] = await db
      .update(contentCalendar)
      .set({ position, updatedAt: new Date() })
      .where(eq(contentCalendar.id, req.params.id as string))
      .returning({ id: contentCalendar.id });
    if (!updated) return res.status(404).json({ message: 'Post not found' });
    res.json(toApi((await findPost(updated.id))!));
  } catch (err) {
    sendError(res, err, 'Failed to reorder');
  }
});

/** Client approval actions: the post must belong to one of the client's projects */
async function loadClientPost(req: AuthRequest, res: Response) {
  const post = await db.query.contentCalendar.findFirst({
    where: eq(contentCalendar.id, req.params.id as string),
    columns: { id: true },
    with: { project: pick.projectNameClient },
  });
  if (!post) {
    res.status(404).json({ message: 'Post not found' });
    return null;
  }
  if (!req.user!.clientId || post.project?.clientId !== req.user!.clientId) {
    res.status(403).json({ message: 'Forbidden' });
    return null;
  }
  return post;
}

router.post('/:id/reject', requireRole('CLIENT'), async (req, res) => {
  try {
    const post = await loadClientPost(req as AuthRequest, res);
    if (!post) return;
    await db
      .update(contentCalendar)
      .set({ status: 'PLANNED', approvedBy: null, approvedAt: null })
      .where(eq(contentCalendar.id, post.id));
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to reject');
  }
});

router.post('/', requirePermission('marketing', 'create'), async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const values = pickColumns(contentCalendar, req.body, EDITABLE_FIELDS);
    const [post] = await db
      .insert(contentCalendar)
      .values({ ...values, createdBy: authReq.user!.id } as typeof contentCalendar.$inferInsert)
      .returning({ id: contentCalendar.id });
    res.status(201).json(toApi((await findPost(post.id))!));
  } catch (err) {
    sendError(res, err, 'Failed to create post');
  }
});

router.patch('/:id', requirePermission('marketing', 'update'), async (req, res) => {
  try {
    const updates = pickColumns(contentCalendar, req.body, EDITABLE_FIELDS);
    const [updated] = await db
      .update(contentCalendar)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(contentCalendar.id, req.params.id as string))
      .returning({ id: contentCalendar.id });
    if (!updated) return res.status(404).json({ message: 'Post not found' });
    res.json(toApi((await findPost(updated.id))!));
  } catch (err) {
    sendError(res, err, 'Failed to update post');
  }
});

router.post('/:id/approve', requireRole('CLIENT'), async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const post = await loadClientPost(authReq, res);
    if (!post) return;
    await db
      .update(contentCalendar)
      .set({ status: 'SCHEDULED', approvedBy: authReq.user!.id, approvedAt: new Date() })
      .where(eq(contentCalendar.id, post.id));
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to approve');
  }
});

router.delete('/:id', requirePermission('marketing', 'delete'), async (req, res) => {
  try {
    const [deleted] = await db
      .delete(contentCalendar)
      .where(eq(contentCalendar.id, req.params.id as string))
      .returning({ id: contentCalendar.id });
    if (!deleted) return res.status(404).json({ message: 'Post not found' });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to delete post');
  }
});

export default router;
