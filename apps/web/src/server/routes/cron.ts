import { Router } from 'express';
import { timingSafeEqual } from 'crypto';
import { runDueJobs } from '../jobs/runner';

const router = Router();

const matches = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Runs whichever background jobs are due. Vercel Cron calls it with `Authorization: Bearer $CRON_SECRET`
 * (set CRON_SECRET in the project); any other scheduler can do the same, e.g. cron-job.org every minute.
 */
router.get('/tick', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ message: 'Set CRON_SECRET to enable scheduled jobs' });
  const auth = req.header('authorization') ?? '';
  if (!matches(auth, `Bearer ${secret}`)) return res.status(401).json({ message: 'Unauthorized' });
  try {
    const results = await runDueJobs();
    res.json({ ok: true, results });
  } catch (err) {
    console.error('[Cron] tick failed:', (err as Error).message);
    res.status(500).json({ message: 'Jobs failed' });
  }
});

export default router;
