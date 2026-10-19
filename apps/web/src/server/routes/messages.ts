import { Router } from 'express';
import { authMiddleware } from '../lib/auth';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  const { channelId } = req.query;
  if (!channelId) return res.status(400).json({ message: 'channelId required' });
  res.json({ messages: [], hasMore: false });
});

export default router;
