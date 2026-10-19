import { Router } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index';
import { notifications } from '../db/schema';
import { authMiddleware, AuthRequest } from '../lib/auth';
import { sendError, uuidParam } from '../lib/http';
import { toApi } from '../lib/serialize';

const router = Router();
router.use(authMiddleware);
router.param('id', uuidParam);

router.get('/', async (req: AuthRequest, res) => {
  try {
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, req.user!.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    res.json(toApi(rows));
  } catch (err) {
    sendError(res, err, 'Failed to fetch notifications');
  }
});

router.patch('/read-all', async (req: AuthRequest, res) => {
  try {
    await db
      .update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(and(eq(notifications.userId, req.user!.id), eq(notifications.read, false)));
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to mark all read');
  }
});

router.patch('/:id/read', async (req: AuthRequest, res) => {
  try {
    await db
      .update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(and(eq(notifications.id, req.params.id as string), eq(notifications.userId, req.user!.id)));
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to mark read');
  }
});

router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const deleted = await db
      .delete(notifications)
      .where(and(eq(notifications.id, req.params.id as string), eq(notifications.userId, req.user!.id)))
      .returning({ id: notifications.id });
    if (deleted.length === 0) return res.status(404).json({ message: 'Notification not found' });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to delete notification');
  }
});

export default router;
