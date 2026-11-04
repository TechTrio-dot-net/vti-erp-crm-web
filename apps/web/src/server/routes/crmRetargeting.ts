import { Router } from 'express';
import { authMiddleware, type AuthRequest } from '../lib/auth';
import { BDM_ROLE, isCrmAdmin, isDateString, requireCrm, requireSuperAdmin, todayLocal } from '../lib/crm';
import { HttpError, optionalId, sendError } from '../lib/http';
import {
  DAILY_RETARGET_LIMIT,
  RETARGET_MIN_AGE_DAYS,
  allotRetargetBatch,
  retargetBatch,
  retargetBatchDays,
  retargetingSummary,
} from '../services/leadRetargeting';

const router = Router();
router.use(authMiddleware, requireCrm);

/**
 * Whose board the caller may look at and whose button they may press: a BDM only ever their own, an
 * admin anyone's. Everybody has their own button, so an admin can hand a batch out for a BDM who is
 * calling but not at a screen.
 */
function scopeTo(req: AuthRequest, requested: unknown): string {
  const asked = optionalId(requested, 'user');
  if (req.user!.role === BDM_ROLE) {
    if (asked && asked !== req.user!.id) throw new HttpError(403, 'You can only retarget your own leads');
    return req.user!.id;
  }
  if (!isCrmAdmin(req.user!.role)) throw new HttpError(403, 'Forbidden');
  if (!asked) throw new HttpError(400, 'Choose a BDM');
  return asked;
}

/** The retargeting board: every BDM's pool and today's batch (a BDM sees only their own row) */
router.get('/', async (req: AuthRequest, res) => {
  try {
    const mine = req.user!.role === BDM_ROLE ? req.user!.id : optionalId(req.query.user, 'user');
    res.json({
      rows: await retargetingSummary(mine),
      dailyLimit: DAILY_RETARGET_LIMIT,
      minAgeDays: RETARGET_MIN_AGE_DAYS,
      today: todayLocal(),
    });
  } catch (err) {
    sendError(res, err, 'Failed to load retargeting');
  }
});

/** One day's batch, oldest lead first. ?date= defaults to today, ?user= is the BDM (admins only). */
router.get('/leads', async (req: AuthRequest, res) => {
  try {
    const userId = scopeTo(req, req.query.user);
    const date = isDateString(req.query.date) ? req.query.date : todayLocal();
    const [rows, days] = await Promise.all([retargetBatch({ userId, date }), retargetBatchDays(userId)]);
    res.json({ rows, days, date });
  } catch (err) {
    sendError(res, err, 'Failed to load the retargeting list');
  }
});

/** The button: hands this BDM their batch of old leads for today. Super Admin only. */
router.post('/allot', requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const userId = scopeTo(req, req.body?.userId);
    res.json(await allotRetargetBatch({ userId, byUserId: req.user!.id }));
  } catch (err) {
    sendError(res, err, 'Failed to allot retargeting leads');
  }
});

export default router;
