import { eq, notInArray, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { leads, services, users } from '../db/schema';
import { APP_TIMEZONE, CLOSED_STAGES } from '../lib/crm';

export const isOpen = notInArray(leads.stage, [...CLOSED_STAGES]);
export const startOfTodayLocal = sql`(date_trunc('day', now() AT TIME ZONE ${APP_TIMEZONE}) AT TIME ZONE ${APP_TIMEZONE})`;

/** Columns every CRM lead list returns */
export const leadColumns = {
  id: leads.id,
  name: leads.companyName,
  contactName: leads.contactName,
  phone: leads.phone,
  email: leads.email,
  city: leads.city,
  source: leads.source,
  campaign: leads.campaign,
  adName: leads.adName,
  formName: leads.formName,
  platform: leads.platform,
  service: sql<string | null>`coalesce(${services.name}, ${leads.service})`,
  serviceId: leads.serviceId,
  stage: leads.stage,
  estimatedValue: leads.estimatedValue,
  notes: leads.notes,
  isManual: leads.isManual,
  assignedTo: leads.assignedTo,
  assignedName: users.name,
  assignedAt: leads.assignedAt,
  firstContactAt: leads.firstContactAt,
  lastContactAt: leads.lastContactAt,
  nextFollowupAt: leads.nextFollowupAt,
  closedAt: leads.closedAt,
  lostReason: leads.lostReason,
  businessType: leads.businessType,
  statusLabel: leads.statusLabel,
  /** The latest follow-up's remark, for lead lists */
  lastRemark: sql<string | null>`(select f.note from lead_followups f where f.lead_id = "leads"."id" and f.note is not null order by f.created_at desc limit 1)`,
  sampleSharedAt: leads.sampleSharedAt,
  clientId: leads.clientId,
  createdAt: leads.createdAt,
  pending: sql<boolean>`(${leads.firstContactAt} IS NULL AND ${isOpen})`,
  overdue: sql<boolean>`(${leads.nextFollowupAt} < ${startOfTodayLocal} AND ${isOpen})`,
};

export function leadQuery() {
  return db
    .select(leadColumns)
    .from(leads)
    .leftJoin(users, eq(users.id, leads.assignedTo))
    .leftJoin(services, eq(services.id, leads.serviceId));
}

