import { Router } from 'express';
import { authMiddleware, requireRole } from '../lib/auth';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  res.json([]);
});

router.get('/:id', async (req, res) => {
  res.status(404).json({ message: 'Document not found' });
});

router.post('/', requireRole('SUPER_ADMIN', 'TEAM_MEMBER'), async (req, res) => {
  res.status(501).json({ message: 'Documents module not yet implemented' });
});

router.post('/:id/comments', async (req, res) => {
  res.status(501).json({ message: 'Comments not yet implemented' });
});

export default router;
