import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index';
import { activities, projects } from '../db/schema';
import { authMiddleware, AuthRequest } from '../lib/auth';
import { optionalId, sendError } from '../lib/http';
import { isProjectMember, pick } from '../lib/scopes';
import { toApi } from '../lib/serialize';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req: AuthRequest, res) => {
  try {
    const projectId = optionalId(req.query.projectId, 'projectId');
    if (!projectId) {
      return res.status(400).json({ message: 'projectId required' });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

    if (req.user?.role === 'CLIENT') {
      const [proj] = await db.select({ clientId: projects.clientId }).from(projects).where(eq(projects.id, projectId)).limit(1);
      if (!proj || !req.user.clientId || proj.clientId !== req.user.clientId) {
        return res.status(403).json({ message: 'Forbidden' });
      }
    } else if (req.user?.role === 'TEAM_MEMBER' && !(await isProjectMember(projectId, req.user.id))) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const rows = await db.query.activities.findMany({
      where: eq(activities.projectId, projectId),
      with: { actor: pick.userName },
      orderBy: [desc(activities.createdAt)],
      limit,
    });
    res.json(toApi(rows));
  } catch (err) {
    sendError(res, err, 'Failed to fetch activities');
  }
});

export default router;
