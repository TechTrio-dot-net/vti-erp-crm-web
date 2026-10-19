import { Router } from 'express';
import { authMiddleware } from '../lib/auth';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  res.json([]);
});

router.get('/:id', async (req, res) => {
  res.status(404).json({ message: 'Channel not found' });
});

router.post('/:id/read', async (req, res) => {
  res.json({ ok: true });
});

export default router;
