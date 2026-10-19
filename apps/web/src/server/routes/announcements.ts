import { Router } from 'express';
import { authMiddleware, requireRole } from '../lib/auth';

const router = Router();
router.use(authMiddleware);
router.use(requireRole('SUPER_ADMIN', 'TEAM_MEMBER'));

router.get('/', async (req, res) => {
  res.json([]);
});

export default router;
