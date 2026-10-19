/**
 * ERP Module Routes - per ERP-SYSTEM-BLUEPRINT.md
 * Modules: auth, hr, sales, marketing, product, support, finance, operations, legal, it
 */
import { Express } from 'express';
import authRoutes from './auth/auth.routes';
import { erpRouter } from '../erp/index';

// Legacy routes (to be migrated into modules)
import dashboardRoutes from '../routes/dashboard';
import clientRoutes from '../routes/clients';
import projectRoutes from '../routes/projects';
import taskRoutes from '../routes/tasks';
import timeEntryRoutes from '../routes/timeEntries';
import fileRoutes from '../routes/files';
import contentCalendarRoutes from '../routes/contentCalendar';
import adCampaignRoutes from '../routes/adCampaigns';
import leadRoutes from '../routes/leads';
import channelRoutes from '../routes/channels';
import messageRoutes from '../routes/messages';
import documentRoutes from '../routes/documents';
import userRoutes from '../routes/users';
import invoiceRoutes from '../routes/invoices';
import announcementRoutes from '../routes/announcements';
import notificationRoutes from '../routes/notifications';
import commentRoutes from '../routes/comments';
import activityRoutes from '../routes/activities';
import searchRoutes from '../routes/search';
import reportRoutes from '../routes/reports';
import crmRoutes from '../routes/crm';
import crmReportRoutes from '../routes/crmReports';
import legacyArchiveRoutes from '../routes/legacyArchive';
import integrationRoutes from '../routes/integrations';
import masterRoutes from '../routes/masters';
import hrRoutes from '../routes/hr';
import exportRoutes from '../routes/exports';
import callRoutes from '../routes/calls';
import coordinationRoutes from '../routes/coordination';
import realtimeRoutes from '../routes/realtime';
import cronRoutes from '../routes/cron';
import assistantRoutes from '../routes/assistant';

export function setupModules(app: Express) {
  // Auth module (blueprint: POST /auth/login, /auth/refresh, GET /auth/me)
  app.use('/api/auth', authRoutes);

  // Quotations, pricing, payments, service catalog, roles & permissions, settings, activity log
  app.use('/api/v1', erpRouter());

  // Dashboard
  app.use('/api/dashboard', dashboardRoutes);

  // Sales module (blueprint: /sales/leads, /sales/clients, /sales/deals)
  // Currently at /api/leads, /api/clients - keep for backward compat
  app.use('/api/leads', leadRoutes);
  app.use('/api/clients', clientRoutes);

  // Sales CRM (BDM logins, rotation, follow-ups, reports) and lead intake integrations
  app.use('/api/crm/reports', crmReportRoutes);
  app.use('/api/crm/archive', legacyArchiveRoutes);
  app.use('/api/crm', crmRoutes);
  app.use('/api/calls', callRoutes);
  app.use('/api/coordination', coordinationRoutes);
  app.use('/api/integrations', integrationRoutes);

  // Masters, HR and configuration
  app.use('/api/masters', masterRoutes);
  app.use('/api/hr', hrRoutes);
  app.use('/api/exports', exportRoutes);

  // Product module (blueprint: /projects, /tasks)
  app.use('/api/projects', projectRoutes);
  app.use('/api/tasks', taskRoutes);

  // Marketing
  app.use('/api/content-calendar', contentCalendarRoutes);
  app.use('/api/ad-campaigns', adCampaignRoutes);

  // Shared
  app.use('/api/time-entries', timeEntryRoutes);
  app.use('/api/files', fileRoutes);
  app.use('/api/channels', channelRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/documents', documentRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/invoices', invoiceRoutes);
  app.use('/api/announcements', announcementRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/comments', commentRoutes);
  app.use('/api/activities', activityRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/reports', reportRoutes);

  // Super admin's AI assistant (questions in any language, typed or spoken)
  app.use('/api/assistant', assistantRoutes);

  // Live updates for the website (replaces sockets) and the entry point for scheduled background jobs
  app.use('/api/realtime', realtimeRoutes);
  app.use('/api/cron', cronRoutes);
}
