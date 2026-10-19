import { Router } from 'express';
import { and, desc, eq, gt } from 'drizzle-orm';
import { db } from '../db/index';
import { notifications } from '../db/schema';
import { authMiddleware, type AuthRequest } from '../lib/auth';
import { sendError } from '../lib/http';
import { readSignals } from '../lib/realtime';
import { kickJobs } from '../jobs/runner';

const router = Router();

/**
 * Polled by the website every few seconds (see useRealtime in the web app).
 * `since` is the `now` of the previous answer; new notifications after it are returned in full, and
 * `signals` holds change counters (kanban, crm) the page compares with the last values it saw.
 */
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    kickJobs();
    const now = new Date();
    const since = typeof req.query.since === 'string' ? new Date(req.query.since) : null;
    const [signals, fresh] = await Promise.all([
      readSignals(),
      since && !Number.isNaN(since.getTime())
        ? db
            .select({ id: notifications.id, title: notifications.title, body: notifications.body, type: notifications.type, link: notifications.link, createdAt: notifications.createdAt })
            .from(notifications)
            .where(and(eq(notifications.userId, req.user!.id), gt(notifications.createdAt, since)))
            .orderBy(desc(notifications.createdAt))
            .limit(20)
        : Promise.resolve([]),
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({ now, signals, notifications: fresh });
  } catch (err) {
    sendError(res, err, 'Live updates failed');
  }
});

export default router;
