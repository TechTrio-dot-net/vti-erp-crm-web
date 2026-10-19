import { Router } from 'express';
import { and, asc, count, desc, eq, gte, isNull, notInArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/index';
import { QUOTATION_STATUSES, activityLogs, employees, quotationItems, quotations, services, users, type QuotationStatus } from '../../db/schema';
import { DASHBOARD_PREFIX, remember } from '../cache';
import { erpUser, requirePermission, type ErpUser } from '../context';
import { money } from '../decimal';
import { APP_TIMEZONE, addDays, dayIn, startOfDay } from '../time';

const router = Router();
const TTL_MS = 5 * 60 * 1000;

/** Statuses counted as pending on the dashboard (awaiting a client decision) */
const PENDING: QuotationStatus[] = ['draft', 'sent'];

async function build(userId: string | null) {
  const scope: SQL = and(isNull(quotations.deletedAt), userId ? eq(quotations.createdBy, userId) : undefined)!;

  const byStatus = await db
    .select({ status: quotations.status, n: count(), total: sql<string>`coalesce(sum(${quotations.grandTotal}), 0)` })
    .from(quotations)
    .where(scope)
    .groupBy(quotations.status);
  const statuses = new Map(byStatus.map((row) => [row.status, row]));
  const countOf = (list: QuotationStatus[]) => list.reduce((sum, status) => sum + Number(statuses.get(status)?.n ?? 0), 0);

  const today = dayIn(new Date());
  const firstDay = addDays(today, -6);

  const [[{ activeEmployees }], [{ todays }], [openTotal], byService, daily] = await Promise.all([
    db.select({ activeEmployees: count() }).from(employees).where(eq(employees.status, 'active')),
    db.select({ todays: count() }).from(quotations).where(and(scope, gte(quotations.createdAt, startOfDay(today)))),
    db
      .select({ total: sql<string>`coalesce(sum(${quotations.grandTotal}), 0)` })
      .from(quotations)
      .where(and(scope, notInArray(quotations.status, ['rejected', 'cancelled']))),
    db
      .select({ service: services.name, items: count(), total: sql<string>`coalesce(sum(${quotationItems.lineTotal}), 0)` })
      .from(quotationItems)
      .innerJoin(quotations, eq(quotations.id, quotationItems.quotationId))
      .innerJoin(services, eq(services.id, quotationItems.serviceId))
      .where(scope)
      .groupBy(services.name)
      .orderBy(asc(services.name)),
    // Days grouped in the business timezone, so the last bar matches "Today's quotations"
    db
      .select({
        day: sql<string>`to_char((${quotations.createdAt} AT TIME ZONE ${APP_TIMEZONE})::date, 'YYYY-MM-DD')`,
        n: count(),
        total: sql<string>`coalesce(sum(${quotations.grandTotal}), 0)`,
      })
      .from(quotations)
      .where(and(scope, gte(quotations.createdAt, startOfDay(firstDay))))
      .groupBy(sql`1`),
  ]);
  const byDay = new Map(daily.map((row) => [row.day, row]));

  return {
    metrics: {
      total_employees: Number(activeEmployees),
      todays_quotations: Number(todays),
      pending_quotations: countOf(PENDING),
      accepted_quotations: countOf(['accepted']),
      total_quotation_value: money(openTotal?.total ?? 0),
      accepted_quotation_value: money(statuses.get('accepted')?.total ?? 0),
    },
    quotations_by_status: QUOTATION_STATUSES.map((status) => ({ status, count: Number(statuses.get(status)?.n ?? 0) })),
    quotations_by_service: byService.map((row) => ({ service: row.service, items: Number(row.items), total: money(row.total) })),
    daily_summary: Array.from({ length: 7 }, (_, offset) => {
      const date = addDays(firstDay, offset);
      const row = byDay.get(date);
      return { date, count: Number(row?.n ?? 0), total: money(row?.total ?? 0) };
    }),
  };
}

async function recentActivity(user: ErpUser) {
  const rows = await db
    .select({ id: activityLogs.id, event: activityLogs.event, description: activityLogs.description, user: users.name, createdAt: activityLogs.createdAt })
    .from(activityLogs)
    .leftJoin(users, eq(users.id, activityLogs.userId))
    .where(user.can('activity_logs.view') ? undefined : eq(activityLogs.userId, user.id))
    .orderBy(desc(activityLogs.createdAt))
    .limit(8);
  return rows.map((row) => ({ id: row.id, event: row.event, description: row.description, user: row.user ?? null, created_at: row.createdAt.toISOString() }));
}

/** Users with quotations.view_all see company-wide figures; everyone else sees their own quotations */
router.get('/dashboard', requirePermission('dashboard.view'), async (req, res) => {
  const user = erpUser(req);
  const companyWide = user.can('quotations.view_all');
  const scopeId = companyWide ? null : user.id;
  const data = await remember(`${DASHBOARD_PREFIX}${scopeId ?? 'company'}`, TTL_MS, () => build(scopeId));
  res.json({ data: { scope: companyWide ? 'company' : 'personal', ...data, recent_activity: await recentActivity(user) } });
});

export default router;
