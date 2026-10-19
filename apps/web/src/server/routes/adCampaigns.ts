import { Router } from 'express';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index';
import { adCampaigns } from '../db/schema';
import { authMiddleware, requirePermission, AuthRequest } from '../lib/auth';
import { optionalId, pickColumns, sendError, uuidParam } from '../lib/http';
import { inClientProjects, inMemberProjects, isProjectMember, pick } from '../lib/scopes';
import { toApi } from '../lib/serialize';

const router = Router();
router.use(authMiddleware);
router.param('id', uuidParam);

const MEMBER_SCOPED_ROLES = ['TEAM_MEMBER', 'MARKETING'];
const EDITABLE_FIELDS = [
  'projectId',
  'campaignName',
  'platform',
  'dailyBudget',
  'startDate',
  'endDate',
  'status',
  'impressions',
  'clicks',
  'ctr',
  'cpc',
  'leads',
  'notes',
] as const;

function findCampaign(id: string) {
  return db.query.adCampaigns.findFirst({ where: eq(adCampaigns.id, id), with: { project: pick.projectName } });
}

router.get('/', requirePermission('ads', 'read'), async (req: AuthRequest, res) => {
  try {
    const conditions: SQL[] = [];
    if (req.user?.role === 'CLIENT') {
      conditions.push(inClientProjects(adCampaigns.projectId, req.user.clientId));
    } else if (MEMBER_SCOPED_ROLES.includes(req.user?.role || '')) {
      conditions.push(inMemberProjects(adCampaigns.projectId, req.user!.id));
    }
    // ADS_TEAM, MANAGEMENT, PROJECT_MANAGER see all

    const { platform, status } = req.query;
    const projectId = optionalId(req.query.projectId, 'projectId');
    if (projectId) conditions.push(eq(adCampaigns.projectId, projectId));
    if (typeof platform === 'string' && platform) conditions.push(eq(adCampaigns.platform, platform as typeof adCampaigns.$inferSelect.platform));
    if (typeof status === 'string' && status) conditions.push(eq(adCampaigns.status, status as typeof adCampaigns.$inferSelect.status));

    const rows = await db.query.adCampaigns.findMany({
      where: and(...conditions),
      with: { project: pick.projectName },
      orderBy: [sql`${adCampaigns.startDate} DESC NULLS LAST`, desc(adCampaigns.createdAt)],
    });
    res.json(toApi(rows));
  } catch (err) {
    sendError(res, err, 'Failed to fetch campaigns');
  }
});

router.get('/dashboard', requirePermission('ads', 'read'), async (req: AuthRequest, res) => {
  try {
    let where: SQL | undefined;
    if (req.user?.role === 'CLIENT') {
      where = inClientProjects(adCampaigns.projectId, req.user.clientId);
    } else if (MEMBER_SCOPED_ROLES.includes(req.user?.role || '')) {
      where = inMemberProjects(adCampaigns.projectId, req.user!.id);
    }
    const rows = await db
      .select({
        platform: adCampaigns.platform,
        impressions: sql<number>`coalesce(sum(${adCampaigns.impressions}), 0)::float8`,
        clicks: sql<number>`coalesce(sum(${adCampaigns.clicks}), 0)::float8`,
        leads: sql<number>`coalesce(sum(${adCampaigns.leads}), 0)::float8`,
        dailyBudget: sql<number>`coalesce(sum(${adCampaigns.dailyBudget}) filter (where ${adCampaigns.status} = 'ACTIVE'), 0)::float8`,
        campaigns: sql<number>`count(*)::int`,
        activeCampaigns: sql<number>`count(*) filter (where ${adCampaigns.status} = 'ACTIVE')::int`,
      })
      .from(adCampaigns)
      .where(where)
      .groupBy(adCampaigns.platform);

    const sumOf = (key: 'impressions' | 'clicks' | 'leads' | 'dailyBudget' | 'campaigns' | 'activeCampaigns') =>
      rows.reduce((s, r) => s + r[key], 0);
    const ctr = (clicks: number, impressions: number) => (impressions > 0 ? (clicks / impressions) * 100 : 0);
    const totalImpressions = sumOf('impressions');
    const totalClicks = sumOf('clicks');

    res.json({
      totalImpressions,
      totalClicks,
      totalLeads: sumOf('leads'),
      avgCtr: ctr(totalClicks, totalImpressions),
      campaignCount: sumOf('campaigns'),
      activeCampaignCount: sumOf('activeCampaigns'),
      activeDailyBudget: sumOf('dailyBudget'),
      byPlatform: rows.map((r) => ({ ...r, ctr: ctr(r.clicks, r.impressions) })),
    });
  } catch (err) {
    sendError(res, err, 'Failed to fetch dashboard');
  }
});

router.get('/:id', requirePermission('ads', 'read'), async (req: AuthRequest, res) => {
  try {
    const campaign = await db.query.adCampaigns.findFirst({
      where: eq(adCampaigns.id, req.params.id as string),
      with: { project: pick.projectNameClient },
    });
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
    if (req.user?.role === 'CLIENT' && campaign.project?.clientId !== req.user.clientId) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (MEMBER_SCOPED_ROLES.includes(req.user?.role || '') && !(await isProjectMember(campaign.projectId, req.user!.id))) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    res.json(toApi(campaign));
  } catch (err) {
    sendError(res, err, 'Failed to fetch campaign');
  }
});

router.post('/', requirePermission('ads', 'create'), async (req, res) => {
  try {
    const values = pickColumns(adCampaigns, req.body, EDITABLE_FIELDS);
    const [campaign] = await db
      .insert(adCampaigns)
      .values(values as typeof adCampaigns.$inferInsert)
      .returning({ id: adCampaigns.id });
    res.status(201).json(toApi((await findCampaign(campaign.id))!));
  } catch (err) {
    sendError(res, err, 'Failed to create campaign');
  }
});

router.patch('/:id', requirePermission('ads', 'update'), async (req, res) => {
  try {
    const updates = pickColumns(adCampaigns, req.body, EDITABLE_FIELDS);
    // CTR is always derived from the stored (or incoming) impressions/clicks, in the same statement
    const impressions = updates.impressions != null ? sql`${updates.impressions}` : sql`${adCampaigns.impressions}`;
    const clicks = updates.clicks != null ? sql`${updates.clicks}` : sql`${adCampaigns.clicks}`;
    const [updated] = await db
      .update(adCampaigns)
      .set({
        ...updates,
        ctr: sql`CASE WHEN ${impressions} > 0 THEN ${clicks}::float8 / ${impressions} * 100 ELSE 0 END`,
        updatedAt: new Date(),
      })
      .where(eq(adCampaigns.id, req.params.id as string))
      .returning({ id: adCampaigns.id });
    if (!updated) return res.status(404).json({ message: 'Campaign not found' });
    res.json(toApi((await findCampaign(updated.id))!));
  } catch (err) {
    sendError(res, err, 'Failed to update campaign');
  }
});

router.delete('/:id', requirePermission('ads', 'delete'), async (req, res) => {
  try {
    const [deleted] = await db.delete(adCampaigns).where(eq(adCampaigns.id, req.params.id as string)).returning({ id: adCampaigns.id });
    if (!deleted) return res.status(404).json({ message: 'Campaign not found' });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to delete campaign');
  }
});

export default router;
