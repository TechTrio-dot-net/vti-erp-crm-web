import { Router, type NextFunction, type Request, type Response } from 'express';
import { authMiddleware, type AuthRequest } from '../lib/auth';
import { BDM_ROLE, isCrmAdmin, todayLocal } from '../lib/crm';
import { HttpError, optionalId, sendError } from '../lib/http';
import { monthOf, recordReminderAction, reminderBoard } from '../services/reorderReminders';

/** The pop-up is for the people who make the calls and the admins who chase them */
function requireCaller(req: Request, res: Response, next: NextFunction): void {
  const role = (req as AuthRequest).user?.role;
  if (role === BDM_ROLE || isCrmAdmin(role)) return next();
  res.status(403).json({ message: 'Forbidden' });
}

const router = Router();
router.use(authMiddleware, requireCaller);

/** The month's re-order pop-up: who to ring, and whether the first Saturday has come round yet */
router.get('/', async (req: AuthRequest, res) => {
  try {
    const bdm = req.user!.role === BDM_ROLE ? req.user!.id : optionalId(req.query.bdm, 'bdm');
    res.json(await reminderBoard(bdm));
  } catch (err) {
    sendError(res, err, 'Failed to load the re-order reminders');
  }
});

/** The answer to one reminder — called them, or skipped them. Either way it clears for the month. */
router.post('/action', async (req: AuthRequest, res) => {
  try {
    const customerKey = typeof req.body?.customerKey === 'string' ? req.body.customerKey.trim() : '';
    if (!customerKey) throw new HttpError(400, 'Which customer?');
    const month = monthOf(todayLocal());
    await recordReminderAction({
      customerKey,
      leadId: optionalId(req.body?.leadId, 'leadId') ?? null,
      userId: req.user!.id,
      month,
      kind: req.body?.kind === 'winback' ? 'winback' : 'reorder',
      action: req.body?.action === 'skipped' ? 'skipped' : 'called',
      note: typeof req.body?.note === 'string' ? req.body.note : undefined,
    });
    res.json({ ok: true, month });
  } catch (err) {
    sendError(res, err, 'Failed to save the reminder');
  }
});

export default router;
