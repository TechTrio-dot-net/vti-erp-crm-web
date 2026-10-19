import { Router, type NextFunction, type Request, type Response } from 'express';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index';
import { authMiddleware, type AuthRequest } from '../lib/auth';
import { APP_TIMEZONE, addDays, isCoordination, todayLocal } from '../lib/crm';
import { sendError } from '../lib/http';
import { syncWonLeadClients } from './clients';

const router = Router();

/** Coordination, and the admins and project managers who oversee it */
function requireCoordinationView(req: Request, res: Response, next: NextFunction): void {
  const role = (req as AuthRequest).user?.role;
  if (isCoordination(role) || ['SUPER_ADMIN', 'MANAGEMENT', 'PROJECT_MANAGER'].includes(role ?? '')) return next();
  res.status(403).json({ message: 'Forbidden' });
}

router.use(authMiddleware, requireCoordinationView);

const day = (column: string) => sql.raw(`(${column} AT TIME ZONE '${APP_TIMEZONE.replace(/'/g, '')}')::date`);

async function rows<T>(query: SQL): Promise<T[]> {
  return (await db.execute<T & Record<string, unknown>>(query)).rows as T[];
}

/** Won clients waiting for a project, production follow-ups, closed/lost leads and BDM hours */
router.get('/dashboard', async (_req, res) => {
  try {
    await syncWonLeadClients();
    const today = todayLocal();
    const monthStart = `${today.slice(0, 8)}01`;
    const weekFrom = addDays(today, -6);

    const [totals, steps, awaiting, production, recentWon, bdmHours] = await Promise.all([
      rows<Record<string, number>>(sql`
        SELECT
          (SELECT count(*)::int FROM clients) AS clients,
          (SELECT count(DISTINCT client_id)::int FROM leads WHERE stage = 'WON' AND client_id IS NOT NULL) AS "crmClients",
          (SELECT count(*)::int FROM leads l WHERE l.stage = 'WON' AND ${day('l.closed_at')} >= ${monthStart}) AS "wonThisMonth",
          (SELECT coalesce(sum(l.estimated_value), 0)::float8 FROM leads l WHERE l.stage = 'WON' AND ${day('l.closed_at')} >= ${monthStart}) AS "wonValueThisMonth",
          (SELECT count(*)::int FROM leads l WHERE l.stage = 'LOST' AND ${day('l.closed_at')} >= ${monthStart}) AS "lostThisMonth",
          (SELECT count(*)::int FROM projects WHERE project_status = 'ACTIVE') AS "activeProjects",
          (SELECT count(*)::int FROM projects WHERE project_status = 'ON_HOLD') AS "onHoldProjects",
          (SELECT count(*)::int FROM projects WHERE project_status = 'COMPLETED') AS "completedProjects",
          (SELECT count(*)::int FROM projects WHERE project_status <> 'COMPLETED' AND end_date < now()) AS "overdueProjects"`),
      rows<{ key: string; label: string; pending: number; inProgress: number; done: number }>(sql`
        SELECT w->>'key' AS key, min(w->>'label') AS label,
          count(*) FILTER (WHERE w->>'status' = 'PENDING')::int AS pending,
          count(*) FILTER (WHERE w->>'status' = 'IN_PROGRESS')::int AS "inProgress",
          count(*) FILTER (WHERE w->>'status' = 'DONE')::int AS done
        FROM projects p, jsonb_array_elements(p.workflow) w
        WHERE p.project_status <> 'COMPLETED'
        GROUP BY 1`),
      rows<{ id: string; companyName: string; phone: string | null; dealValue: number; wonAt: string | null; bdmName: string | null }>(sql`
        SELECT c.id, c.company_name AS "companyName", c.phone,
          coalesce(sum(l.estimated_value), 0)::float8 AS "dealValue", max(l.closed_at) AS "wonAt",
          (array_agg(u.name ORDER BY l.closed_at DESC NULLS LAST))[1] AS "bdmName"
        FROM clients c
        JOIN leads l ON l.client_id = c.id AND l.stage = 'WON'
        LEFT JOIN users u ON u.id = l.assigned_to
        WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.client_id = c.id)
        GROUP BY c.id
        ORDER BY max(l.closed_at) DESC NULLS LAST
        LIMIT 20`),
      rows<{ id: string; projectName: string; clientName: string; projectStatus: string; endDate: string | null; workflow: Array<{ key: string; label: string; status: string }> }>(sql`
        SELECT p.id, p.project_name AS "projectName", c.company_name AS "clientName", p.project_status AS "projectStatus",
          p.end_date AS "endDate", p.workflow
        FROM projects p JOIN clients c ON c.id = p.client_id
        WHERE p.project_status <> 'COMPLETED'
        ORDER BY p.end_date ASC NULLS LAST, p.updated_at DESC
        LIMIT 25`),
      rows<{ id: string; name: string; service: string | null; value: number | null; closedAt: string; bdmName: string | null }>(sql`
        SELECT l.id, l.company_name AS name, coalesce(s.name, l.service) AS service, l.estimated_value AS value,
          l.closed_at AS "closedAt", u.name AS "bdmName"
        FROM leads l LEFT JOIN users u ON u.id = l.assigned_to LEFT JOIN services s ON s.id = l.service_id
        WHERE l.stage = 'WON'
        ORDER BY l.closed_at DESC NULLS LAST
        LIMIT 8`),
      rows<{ userId: string; name: string; minutes: number }>(sql`
        SELECT s.user_id AS "userId", u.name,
          round(sum(extract(epoch FROM (coalesce(s.ended_at, now()) - s.started_at)) / 60))::int AS minutes
        FROM bdm_sessions s JOIN users u ON u.id = s.user_id
        WHERE ${day('s.started_at')} BETWEEN ${weekFrom} AND ${today}
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`),
    ]);

    res.json({ totals: totals[0], steps, awaitingProject: awaiting, production, recentWon, bdmHours, range: { weekFrom, today, monthStart } });
  } catch (err) {
    sendError(res, err, 'Failed to load the coordination dashboard');
  }
});

export default router;
