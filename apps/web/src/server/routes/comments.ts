import { Router, Response } from 'express';
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';
import { db } from '../db/index';
import { comments, users } from '../db/schema';
import { authMiddleware, requireRole, AuthRequest } from '../lib/auth';
import { HttpError, isUuid, optionalId, pickColumns, sendError, uuidParam } from '../lib/http';
import { inClientProjects, pick } from '../lib/scopes';
import { toApi, type ApiDoc } from '../lib/serialize';

const router = Router();
router.use(authMiddleware);
router.param('id', uuidParam);

const ENTITY_TYPES = ['TASK', 'FILE', 'CONTENT_CALENDAR', 'PROJECT'];

/** Replaces each comment's `mentions` id array with `{ id, _id, name, initials }` using one lookup */
async function populateMentions(docs: ApiDoc[]): Promise<ApiDoc[]> {
  const ids = [...new Set(docs.flatMap((d) => (d.mentions as string[]) ?? []))];
  if (ids.length === 0) return docs;
  const rows = await db.select({ id: users.id, name: users.name, initials: users.initials }).from(users).where(inArray(users.id, ids));
  const byId = new Map(rows.map((u) => [u.id, toApi(u)]));
  return docs.map((d) => ({ ...d, mentions: (d.mentions as string[]).map((m) => byId.get(m)).filter(Boolean) }));
}

async function findComment(id: string): Promise<ApiDoc> {
  const comment = await db.query.comments.findFirst({ where: eq(comments.id, id), with: { author: pick.userName } });
  const [populated] = await populateMentions([toApi(comment!)]);
  return populated;
}

function parseMentions(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(isUuid)) throw new HttpError(400, 'Invalid mentions');
  return value;
}

router.get('/', async (req: AuthRequest, res) => {
  try {
    const { entityType } = req.query;
    const entityId = optionalId(req.query.entityId, 'entityId');
    if (!entityType || !entityId) {
      return res.status(400).json({ message: 'entityType and entityId required' });
    }
    if (!ENTITY_TYPES.includes(String(entityType))) {
      return res.status(400).json({ message: 'Invalid entityType' });
    }

    const conditions: SQL[] = [
      eq(comments.entityType, entityType as typeof comments.$inferSelect.entityType),
      eq(comments.entityId, entityId),
    ];
    if (req.user?.role === 'CLIENT') {
      conditions.push(inClientProjects(comments.projectId, req.user.clientId));
    }

    const rows = await db.query.comments.findMany({
      where: and(...conditions),
      with: { author: pick.userName },
      orderBy: [asc(comments.createdAt)],
    });
    const docs = await populateMentions(toApi(rows));

    const byParent = new Map<string, ApiDoc[]>();
    for (const c of docs) {
      const key = (c.parentId as string | null) ?? 'root';
      byParent.set(key, [...(byParent.get(key) ?? []), c]);
    }
    res.json((byParent.get('root') ?? []).map((c) => ({ ...c, replies: byParent.get(c.id) ?? [] })));
  } catch (err) {
    sendError(res, err, 'Failed to fetch comments');
  }
});

router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const comment = await db.query.comments.findFirst({
      where: eq(comments.id, req.params.id as string),
      with: { author: pick.userName, parent: true },
    });
    if (!comment) return res.status(404).json({ message: 'Comment not found' });
    const [populated] = await populateMentions([toApi(comment)]);
    res.json(populated);
  } catch (err) {
    sendError(res, err, 'Failed to fetch comment');
  }
});

router.post('/', requireRole('SUPER_ADMIN', 'TEAM_MEMBER', 'CLIENT'), async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const values = pickColumns(comments, req.body, ['entityType', 'entityId', 'projectId', 'content', 'isInternal', 'parentId']);
    const [comment] = await db
      .insert(comments)
      .values({
        ...values,
        isInternal: values.isInternal ?? authReq.user!.role !== 'CLIENT',
        mentions: parseMentions(req.body?.mentions) ?? [],
        authorId: authReq.user!.id,
      } as typeof comments.$inferInsert)
      .returning({ id: comments.id });
    res.status(201).json(await findComment(comment.id));
  } catch (err) {
    sendError(res, err, 'Failed to create comment');
  }
});

/** Only the author (or a super admin) may change or remove a comment */
async function loadOwnComment(req: AuthRequest, res: Response) {
  const [comment] = await db
    .select({ id: comments.id, authorId: comments.authorId })
    .from(comments)
    .where(eq(comments.id, req.params.id as string))
    .limit(1);
  if (!comment) {
    res.status(404).json({ message: 'Comment not found' });
    return null;
  }
  if (req.user!.role !== 'SUPER_ADMIN' && comment.authorId !== req.user!.id) {
    res.status(403).json({ message: 'Forbidden' });
    return null;
  }
  return comment;
}

router.patch('/:id', requireRole('SUPER_ADMIN', 'TEAM_MEMBER', 'CLIENT'), async (req, res) => {
  try {
    const comment = await loadOwnComment(req as AuthRequest, res);
    if (!comment) return;
    const updates: Partial<typeof comments.$inferInsert> = pickColumns(comments, req.body, ['content', 'isInternal']);
    const mentions = parseMentions(req.body?.mentions);
    if (mentions) updates.mentions = mentions;
    await db
      .update(comments)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(comments.id, comment.id));
    res.json(await findComment(comment.id));
  } catch (err) {
    sendError(res, err, 'Failed to update comment');
  }
});

router.delete('/:id', requireRole('SUPER_ADMIN', 'TEAM_MEMBER', 'CLIENT'), async (req, res) => {
  try {
    const comment = await loadOwnComment(req as AuthRequest, res);
    if (!comment) return;
    // Replies are removed by the parent_id ON DELETE CASCADE
    await db.delete(comments).where(eq(comments.id, comment.id));
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to delete comment');
  }
});

export default router;
