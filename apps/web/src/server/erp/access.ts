import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthRequest } from '../lib/auth';
import { loadErpUser } from './context';

/**
 * For the role-based screens (HR, masters): allowed when the user's role is one of `roles`, or their
 * role grants `permission` in Roles & Permissions. Runs after authMiddleware.
 */
export function roleOrPermission(roles: string[], permission: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as AuthRequest).user;
      if (!user) {
        res.status(401).json({ message: 'Not authenticated' });
        return;
      }
      if (roles.includes(user.role)) return next();
      const erp = await loadErpUser(user.id);
      if (erp?.can(permission)) return next();
      res.status(403).json({ message: 'Forbidden' });
    } catch (err) {
      next(err);
    }
  };
}
