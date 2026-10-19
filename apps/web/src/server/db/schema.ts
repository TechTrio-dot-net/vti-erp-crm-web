import { relations, sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  date,
  numeric,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export type Role =
  | 'SUPER_ADMIN'
  | 'MANAGEMENT'
  | 'PROJECT_MANAGER'
  | 'DEVELOPER'
  | 'DESIGNER'
  | 'MARKETING'
  | 'ADS_TEAM'
  | 'SALES'
  | 'SUPPORT'
  | 'HR'
  | 'TEAM_MEMBER'
  | 'CLIENT';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type TaskStatus = 'BACKLOG' | 'TO_DO' | 'IN_PROGRESS' | 'REVIEW' | 'COMPLETED';
export type ProjectStatus = 'ACTIVE' | 'ON_HOLD' | 'COMPLETED';
export type ContentPlatform = 'INSTAGRAM' | 'FACEBOOK' | 'LINKEDIN' | 'YOUTUBE';
export type PostType = 'REEL' | 'CAROUSEL' | 'STATIC' | 'STORY' | 'VIDEO';
export type ContentStatus = 'PLANNED' | 'DESIGNING' | 'APPROVAL' | 'SCHEDULED' | 'POSTED' | 'CANCELLED';
export type AdPlatform = 'META_ADS' | 'GOOGLE_ADS';
export type AdStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED';
export type CommentEntityType = 'TASK' | 'FILE' | 'CONTENT_CALENDAR' | 'PROJECT';
export type BusinessType = 'B2B' | 'B2C';
export type LeadStage = 'AWARENESS' | 'CONTACTED' | 'PROPOSAL' | 'NEGOTIATION' | 'WON' | 'LOST';
export type FollowupOutcome =
  | 'CONNECTED'
  | 'CALL_BACK'
  | 'NOT_REACHABLE'
  | 'INTERESTED'
  | 'NOT_INTERESTED'
  | 'CONVERTED'
  | 'LOST';
export type AssignmentReason = 'auto' | 'manual' | 'transfer' | 'leave' | 'campaign';
export type LeadSourceType = 'google_sheet' | 'meta';
export type LeadImportStatus = 'imported' | 'duplicate' | 'error' | 'ignored';

export interface LeadSourceConfig {
  /** google_sheet: a sheet URL (shared "anyone with the link") or spreadsheet id */
  sheetUrl?: string;
  sheetName?: string;
  /** google_sheet: the ticked tabs to read. None ticked: the first tab (or the tab of the link / sheetName) */
  sheetTabs?: Array<{ gid: string; title: string }>;
  /** google_sheet: tabs (by gid) whose rows from before the tab was ticked are already recorded */
  baselinedTabs?: string[];
  /** meta: lead form ids to poll (webhooks cover every form of the page) */
  formIds?: string[];
  pageId?: string;
  /** google_sheet: create leads for rows already present when connected (default: only new rows) */
  importExisting?: boolean;
  /** set after the first sync recorded the rows that were already in the sheet */
  baselineDone?: boolean;
}

export interface InvoiceItem {
  name: string;
  description?: string;
  quantity: number;
  rate: number;
  amount: number;
  gstRate?: number;
  hsnSac?: string;
}

export interface FileVersion {
  version: number;
  url: string;
  storageKey: string;
  uploadedAt: string;
  uploadedBy: string;
}

// Column names are camelCase in TS and snake_case in Postgres (see `casing` in db/index.ts).
const id = () => uuid().primaryKey().defaultRandom();
const ts = (name?: string) => (name ? timestamp(name, { withTimezone: true }) : timestamp({ withTimezone: true }));
const timestamps = {
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts().notNull().defaultNow().$onUpdate(() => new Date()),
};

// ─── Tables ───────────────────────────────────────────────────────────────────

export const clients = pgTable('clients', {
  id: id(),
  companyName: text().notNull(),
  contactName: text().notNull(),
  /** Null for clients created from a won CRM lead that had no email */
  contactEmail: text().unique(),
  phone: text(),
  address: text(),
  portalLogin: text().notNull().unique(),
  ...timestamps,
});

export const users = pgTable(
  'users',
  {
    id: id(),
    /** Null for staff who sign in with their username or employee ID only */
    email: text().unique(),
    username: text().notNull().unique(),
    passwordHash: text().notNull(),
    name: text().notNull(),
    /** One of the system roles above, or the slug of a custom role in `roles` */
    role: text().$type<Role>().notNull(),
    roleIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    initials: text(),
    avatarUrl: text(),
    clientId: uuid().references(() => clients.id, { onDelete: 'set null' }),
    isActive: boolean().notNull().default(true),
    lastLoginAt: ts(),
    resetToken: text(),
    resetTokenExpiry: ts(),
    /** Tokens issued before this moment are rejected (password/role change, deactivation) */
    tokensValidFrom: ts(),
    phone: text(),
    // Sales (BDM) settings — see services/leadAssignment.ts
    inRotation: boolean().notNull().default(false),
    rotationPosition: integer().notNull().default(0),
    lastAssignedAt: ts(),
    weeklyLeadTarget: integer().notNull().default(0),
    weeklyRevenueTarget: doublePrecision().notNull().default(0),
    divisionId: uuid().references((): AnyPgColumn => divisions.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index().on(t.role), index().on(t.clientId), index().on(t.resetToken), index().on(t.role, t.inRotation, t.lastAssignedAt)]
);

export const divisions = pgTable('divisions', {
  id: id(),
  name: text().notNull().unique(),
  description: text(),
  active: boolean().notNull().default(true),
  ...timestamps,
});

export const departments = pgTable(
  'departments',
  {
    id: id(),
    name: text().notNull(),
    /** Optional short code, unique among departments that have one */
    code: text().unique(),
    divisionId: uuid().references(() => divisions.id, { onDelete: 'set null' }),
    description: text(),
    active: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.divisionId, t.name)]
);

export const designations = pgTable('designations', {
  id: id(),
  name: text().notNull().unique(),
  description: text(),
  active: boolean().notNull().default(true),
  ...timestamps,
});

/** Main categories have no parent; sub categories point at their main category */
export const categories = pgTable(
  'categories',
  {
    id: id(),
    name: text().notNull(),
    parentId: uuid().references((): AnyPgColumn => categories.id, { onDelete: 'cascade' }),
    active: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [index().on(t.parentId)]
);

/** Quotation form fields a service can ask for (besides duration and quantity), in form order */
export const SERVICE_FIELDS = ['artist_id', 'video_type_id', 'source_language_id', 'language_id'] as const;
export type ServiceField = (typeof SERVICE_FIELDS)[number];

/** One list of services for both the sales CRM (categories, price) and quotations (fields, artists, rates) */
export const services = pgTable('services', {
  id: id(),
  name: text().notNull().unique(),
  /** Stable key the quotation catalog uses (video-editing, voice-over, …) */
  slug: text().notNull().unique(),
  description: text(),
  categoryId: uuid().references(() => categories.id, { onDelete: 'set null' }),
  subCategoryId: uuid().references(() => categories.id, { onDelete: 'set null' }),
  price: doublePrecision(),
  active: boolean().notNull().default(true),
  /** Listed on the quotation form but not quotable yet */
  comingSoon: boolean().notNull().default(false),
  fields: text().array().$type<ServiceField[]>().notNull().default(sql`'{}'::text[]`),
  /** Only holders of artists.assign may choose this service's artist (video editing) */
  artistRestricted: boolean().notNull().default(false),
  sortOrder: integer().notNull().default(0),
  ...timestamps,
});

export type WorkflowStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE';
export type ProjectWorkflowStep = { key: string; label: string; status: WorkflowStatus; updatedAt: string | null; updatedBy: string | null };

export const projects = pgTable(
  'projects',
  {
    id: id(),
    projectName: text().notNull(),
    clientId: uuid().notNull().references(() => clients.id, { onDelete: 'restrict' }),
    clientName: text().notNull(),
    clientEmail: text(),
    startDate: ts(),
    endDate: ts(),
    projectStatus: text().$type<ProjectStatus>().notNull().default('ACTIVE'),
    description: text(),
    /** Production follow-ups once the deal is finalised (shoot, video edit, post, ads) */
    workflow: jsonb().$type<ProjectWorkflowStep[]>().notNull().default([]),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index().on(t.clientId), index().on(t.projectStatus), index().on(t.createdBy), index().on(t.updatedAt)]
);

/** Replaces Project.teamMembers (ObjectId[]) */
export const projectTeamMembers = pgTable(
  'project_team_members',
  {
    projectId: uuid().notNull().references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index().on(t.userId)]
);

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    projectId: uuid().notNull().references(() => projects.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    description: text(),
    assignedTo: uuid().references(() => users.id, { onDelete: 'set null' }),
    priority: text().$type<TaskPriority>().notNull().default('MEDIUM'),
    deadline: ts(),
    status: text().$type<TaskStatus>().notNull().default('BACKLOG'),
    tags: text().array().notNull().default(sql`'{}'::text[]`),
    position: doublePrecision().notNull().default(0),
    attachments: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    approvalStatus: text().$type<'PENDING' | 'APPROVED' | 'REJECTED'>(),
    approvedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    approvedAt: ts(),
    rejectionReason: text(),
    completedAt: ts(),
    /** The project follow-up step (shoot, video_edit, post, ads) this task tracks; kept in sync both ways */
    workflowStep: text(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index().on(t.projectId, t.status),
    index().on(t.assignedTo, t.status),
    index().on(t.status, t.completedAt),
    index().on(t.deadline),
    index().on(t.position),
  ]
);

export const timeEntries = pgTable(
  'time_entries',
  {
    id: id(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    taskId: uuid().references(() => tasks.id, { onDelete: 'set null' }),
    projectId: uuid().notNull().references(() => projects.id, { onDelete: 'cascade' }),
    startTime: ts().notNull(),
    endTime: ts().notNull(),
    totalMinutes: integer().notNull(),
    notes: text(),
    ...timestamps,
  },
  (t) => [index().on(t.userId, t.startTime), index().on(t.taskId), index().on(t.projectId, t.startTime), index().on(t.startTime)]
);

export const activeTimers = pgTable('active_timers', {
  userId: uuid().primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  taskId: uuid().notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  projectId: uuid().notNull().references(() => projects.id, { onDelete: 'cascade' }),
  startTime: ts().notNull(),
});

export const files = pgTable(
  'files',
  {
    id: id(),
    filename: text().notNull(),
    mimeType: text().notNull(),
    size: bigint({ mode: 'number' }).notNull(),
    url: text().notNull(),
    storageKey: text().notNull(),
    projectId: uuid().references(() => projects.id, { onDelete: 'set null' }),
    taskId: uuid().references(() => tasks.id, { onDelete: 'set null' }),
    uploadedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: integer().notNull().default(1),
    versions: jsonb().$type<FileVersion[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [index().on(t.projectId), index().on(t.taskId), index().on(t.uploadedBy), index().on(t.createdAt)]
);

export const contentCalendar = pgTable(
  'content_calendar',
  {
    id: id(),
    projectId: uuid().notNull().references(() => projects.id, { onDelete: 'cascade' }),
    date: ts().notNull(),
    platform: text().$type<ContentPlatform>().notNull(),
    postType: text().$type<PostType>().notNull(),
    caption: text(),
    creativeFileId: uuid().references(() => files.id, { onDelete: 'set null' }),
    status: text().$type<ContentStatus>().notNull().default('PLANNED'),
    position: doublePrecision().notNull().default(0),
    approvedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    approvedAt: ts(),
    postedAt: ts(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index().on(t.projectId, t.date), index().on(t.date, t.position), index().on(t.status), index().on(t.platform)]
);

export const adCampaigns = pgTable(
  'ad_campaigns',
  {
    id: id(),
    projectId: uuid().notNull().references(() => projects.id, { onDelete: 'cascade' }),
    campaignName: text().notNull(),
    platform: text().$type<AdPlatform>().notNull(),
    dailyBudget: doublePrecision().notNull().default(0),
    startDate: ts(),
    endDate: ts(),
    status: text().$type<AdStatus>().notNull().default('ACTIVE'),
    impressions: bigint({ mode: 'number' }).notNull().default(0),
    clicks: bigint({ mode: 'number' }).notNull().default(0),
    ctr: doublePrecision().notNull().default(0),
    cpc: doublePrecision().notNull().default(0),
    leads: integer().notNull().default(0),
    notes: text(),
    ...timestamps,
  },
  (t) => [index().on(t.projectId), index().on(t.platform), index().on(t.status), index().on(t.startDate)]
);

export const leads = pgTable(
  'leads',
  {
    id: id(),
    companyName: text().notNull(),
    contactName: text(),
    email: text(),
    phone: text(),
    source: text(),
    service: text(),
    stage: text().notNull().default('AWARENESS'),
    assignedTo: uuid().references(() => users.id, { onDelete: 'set null' }),
    estimatedValue: doublePrecision(),
    notes: text(),
    clientId: uuid().references(() => clients.id, { onDelete: 'set null' }),
    lastContactAt: ts(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    // Intake
    city: text(),
    campaign: text(),
    adName: text(),
    formName: text(),
    platform: text(),
    sourceId: uuid().references((): AnyPgColumn => leadSources.id, { onDelete: 'set null' }),
    externalId: text(),
    isManual: boolean().notNull().default(false),
    /** Last 10 digits of the phone number, for search and duplicate detection */
    phoneNormalized: text(),
    duplicateOfId: uuid().references((): AnyPgColumn => leads.id, { onDelete: 'set null' }),
    serviceId: uuid().references(() => services.id, { onDelete: 'set null' }),
    categoryId: uuid().references(() => categories.id, { onDelete: 'set null' }),
    // Lifecycle
    assignedAt: ts(),
    firstContactAt: ts(),
    nextFollowupAt: ts(),
    closedAt: ts(),
    lostReason: text(),
    /** The detailed status kept from the old CRM (Hot, Cold, Follow Up, …), alongside the stage */
    statusLabel: text(),
    /** Who the customer sells to, asked on every after-call form */
    businessType: text().$type<BusinessType>(),
    /** When a sample was first shared with this lead */
    sampleSharedAt: ts(),
    ...timestamps,
  },
  (t) => [
    index().on(t.stage, t.updatedAt),
    index().on(t.assignedTo),
    index().on(t.assignedTo, t.assignedAt),
    index().on(t.phoneNormalized),
    index().on(t.nextFollowupAt),
    index().on(t.campaign),
    index().on(t.createdAt),
    index().on(t.closedAt),
  ]
);

export const leadFollowups = pgTable(
  'lead_followups',
  {
    id: id(),
    leadId: uuid().notNull().references(() => leads.id, { onDelete: 'cascade' }),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    outcome: text().$type<FollowupOutcome>().notNull(),
    note: text(),
    nextFollowupAt: ts(),
    /** Where it was logged: the website or the phone app's after-call form */
    source: text().$type<'web' | 'phone'>().notNull().default('web'),
    /** The phone call this follow-up describes (after-call form) */
    callLogId: uuid().references((): AnyPgColumn => callLogs.id, { onDelete: 'set null' }),
    /** Id the phone app gives each form it sends, so a retried upload is saved only once */
    clientRef: text(),
    /** What happened on the call, as the BDM recorded it (e.g. "Call Conversation", "Not connected") */
    callActivity: text(),
    /** The lead's status after this follow-up in the BDM's own words (e.g. "Hot", "Follow Up") */
    statusLabel: text(),
    callDurationSec: integer(),
    /** Why the lead was lost or not interested */
    reason: text(),
    /** After-call form: whether the call connected, the customer is interested and a sample was shared */
    connected: boolean(),
    interested: boolean(),
    sampleShared: boolean(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.leadId, t.createdAt), index().on(t.userId, t.createdAt), index().on(t.createdAt), uniqueIndex().on(t.clientRef)]
);

/**
 * Every row of every table of the old PHP CRM (imported by pnpm import:legacy-crm), exactly as it was, so
 * nothing from it is lost — also the tables this CRM has no screen for (payments ledger, bookings, menus,
 * logs). Browsed in CRM Admin → Old CRM Archive and readable by the AI Assistant.
 */
export const legacyArchive = pgTable(
  'legacy_archive',
  {
    id: id(),
    tableName: text().notNull(),
    /** The row's id in the old table, or its position when the table has no id */
    rowKey: text().notNull(),
    data: jsonb().$type<Record<string, string | null>>().notNull(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.tableName, t.rowKey), index().on(t.tableName)]
);

/** Every change of lead owner: automatic rotation, manual assignment, transfers and leave hand-overs */
export const leadAssignments = pgTable(
  'lead_assignments',
  {
    id: id(),
    leadId: uuid().notNull().references(() => leads.id, { onDelete: 'cascade' }),
    fromUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    toUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    reason: text().$type<AssignmentReason>().notNull(),
    note: text(),
    byUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.leadId), index().on(t.toUserId, t.createdAt), index().on(t.createdAt)]
);

/** Start/Stop working sessions of a BDM (drives rotation and BDM time analysis) */
export const bdmSessions = pgTable(
  'bdm_sessions',
  {
    id: id(),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    startedAt: ts().notNull().defaultNow(),
    endedAt: ts(),
    startedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    endedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index().on(t.userId, t.startedAt), index().on(t.startedAt)]
);

export const bdmLeaves = pgTable(
  'bdm_leaves',
  {
    id: id(),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    fromDate: date({ mode: 'string' }).notNull(),
    toDate: date({ mode: 'string' }).notNull(),
    reason: text(),
    transferredTo: uuid().references(() => users.id, { onDelete: 'set null' }),
    transferredCount: integer().notNull().default(0),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.userId, t.fromDate, t.toDate)]
);

/** Leads for a campaign go only to these BDMs (rotation among them) */
export const campaignBdmRules = pgTable(
  'campaign_bdm_rules',
  {
    campaign: text().notNull(),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.campaign, t.userId] })]
);

/** A source's sales team: its leads rotate only among these BDMs (no rows = every online BDM) */
export const leadSourceBdms = pgTable(
  'lead_source_bdms',
  {
    sourceId: uuid().notNull().references((): AnyPgColumn => leadSources.id, { onDelete: 'cascade' }),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.userId] }), index().on(t.userId)]
);

export const leadSources = pgTable('lead_sources', {
  id: id(),
  name: text().notNull(),
  type: text().$type<LeadSourceType>().notNull(),
  config: jsonb().$type<LeadSourceConfig>().notNull().default({}),
  defaultServiceId: uuid().references(() => services.id, { onDelete: 'set null' }),
  active: boolean().notNull().default(true),
  lastSyncedAt: ts(),
  lastError: text(),
  ...timestamps,
});

/** Every row/lead received from Google Sheets or Meta — the raw feed behind "Real Time Data" and "Verify Data" */
export const leadImports = pgTable(
  'lead_imports',
  {
    id: id(),
    sourceId: uuid().notNull().references(() => leadSources.id, { onDelete: 'cascade' }),
    externalId: text().notNull(),
    status: text().$type<LeadImportStatus>().notNull(),
    error: text(),
    raw: jsonb().$type<Record<string, unknown>>().notNull(),
    leadId: uuid().references(() => leads.id, { onDelete: 'set null' }),
    campaign: text(),
    receivedAt: ts().notNull().defaultNow(),
    resolvedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.sourceId, t.externalId), index().on(t.status, t.createdAt), index().on(t.receivedAt)]
);

export type CallDirection = 'outgoing' | 'incoming' | 'missed' | 'rejected';
export type CallSource = 'device' | 'exotel';

/** Phone calls — synced from BDMs' Android phones or reported by the calling service (Exotel) */
export const callLogs = pgTable(
  'call_logs',
  {
    id: id(),
    source: text().$type<CallSource>().notNull(),
    /** device: hash of number+time+duration; exotel: CallSid */
    externalId: text().notNull(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    leadId: uuid().references(() => leads.id, { onDelete: 'set null' }),
    phone: text().notNull(),
    phoneNormalized: text(),
    contactName: text(),
    direction: text().$type<CallDirection>().notNull(),
    /** telephony status: queued, in-progress, completed, busy, no-answer, failed, canceled */
    status: text(),
    startedAt: ts().notNull(),
    durationSec: integer().notNull().default(0),
    recordingUrl: text(),
    deviceId: text(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex().on(t.source, t.externalId),
    index().on(t.userId, t.startedAt),
    index().on(t.leadId, t.startedAt),
    index().on(t.phoneNormalized),
    index().on(t.startedAt),
  ]
);

export type RecordingStatus = 'uploading' | 'uploaded' | 'transcribing' | 'transcribed' | 'failed';

/**
 * Call audio and its transcript. Phone calls: the file the phone's own call recorder saved, uploaded by the
 * Android app. Company-line calls: Exotel's recording, fetched when it is transcribed.
 */
export const callRecordings = pgTable(
  'call_recordings',
  {
    id: id(),
    callLogId: uuid().notNull().references(() => callLogs.id, { onDelete: 'cascade' }),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** Where the audio is kept (recordings/<uuid>.m4a); null while an Exotel recording is still only at sourceUrl */
    storageKey: text(),
    sourceUrl: text(),
    fileName: text(),
    mimeType: text(),
    sizeBytes: integer(),
    status: text().$type<RecordingStatus>().notNull().default('uploading'),
    transcript: text(),
    /** Language the speech-to-text service detected (e.g. "hindi", "en") */
    language: text(),
    /** Short English summary of the conversation (when ANTHROPIC_API_KEY is set) */
    summary: text(),
    error: text(),
    attempts: integer().notNull().default(0),
    transcribedAt: ts(),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.callLogId), index().on(t.status, t.updatedAt), index().on(t.userId, t.createdAt)]
);

/** Phones running the call-sync app */
export const mobileDevices = pgTable(
  'mobile_devices',
  {
    id: id(),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text().notNull(),
    deviceName: text(),
    appVersion: text(),
    lastSyncAt: ts(),
    lastCallAt: ts(),
    permissionGranted: boolean().notNull().default(true),
    /** The app has the Phone permission, so the CRM's Call button can dial from this phone */
    canDial: boolean().notNull().default(false),
    /** Last time the app checked in for Call-button requests (every ~25 seconds while running) */
    lastSeenAt: ts(),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.userId, t.deviceId)]
);

export type DialRequestStatus = 'pending' | 'sent' | 'dialing' | 'failed' | 'expired';

/** Call button clicks on the website, waiting for the user's phone app to dial them */
export const dialRequests = pgTable(
  'dial_requests',
  {
    id: id(),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    leadId: uuid().references(() => leads.id, { onDelete: 'set null' }),
    phone: text().notNull(),
    contactName: text(),
    status: text().$type<DialRequestStatus>().notNull().default('pending'),
    deviceId: text(),
    error: text(),
    deliveredAt: ts(),
    ...timestamps,
  },
  (t) => [index().on(t.userId, t.status, t.createdAt)]
);

export const whatsappLogs = pgTable(
  'whatsapp_logs',
  {
    id: id(),
    leadId: uuid().references(() => leads.id, { onDelete: 'set null' }),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    phone: text().notNull(),
    message: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.createdAt), index().on(t.leadId)]
);

export const employees = pgTable(
  'employees',
  {
    id: id(),
    userId: uuid().unique().references(() => users.id, { onDelete: 'set null' }),
    employeeCode: text().unique(),
    name: text().notNull(),
    email: text(),
    phone: text(),
    divisionId: uuid().references(() => divisions.id, { onDelete: 'set null' }),
    departmentId: uuid().references(() => departments.id, { onDelete: 'set null' }),
    designationId: uuid().references(() => designations.id, { onDelete: 'set null' }),
    joiningDate: date({ mode: 'string' }),
    monthlySalary: doublePrecision().notNull().default(0),
    bankAccount: text(),
    ifsc: text(),
    pan: text(),
    address: text(),
    status: text().$type<EmployeeStatus>().notNull().default('active'),
    ...timestamps,
  },
  (t) => [index().on(t.departmentId), index().on(t.status)]
);

export const EMPLOYEE_STATUSES = ['active', 'inactive', 'on_leave', 'terminated'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const salaries = pgTable(
  'salaries',
  {
    id: id(),
    employeeId: uuid().notNull().references(() => employees.id, { onDelete: 'cascade' }),
    /** YYYY-MM */
    month: text().notNull(),
    baseSalary: doublePrecision().notNull(),
    workingDays: integer().notNull(),
    paidDays: doublePrecision().notNull(),
    bonus: doublePrecision().notNull().default(0),
    deductions: doublePrecision().notNull().default(0),
    netPay: doublePrecision().notNull(),
    status: text().$type<'draft' | 'paid'>().notNull().default('draft'),
    paidAt: ts(),
    note: text(),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.employeeId, t.month), index().on(t.month)]
);

export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    invoiceNumber: text().notNull(),
    clientId: uuid().notNull().references(() => clients.id, { onDelete: 'restrict' }),
    projectId: uuid().references(() => projects.id, { onDelete: 'set null' }),
    amount: doublePrecision().notNull(),
    currency: text().notNull().default('INR'),
    status: text().$type<'draft' | 'sent' | 'paid' | 'overdue'>().notNull().default('draft'),
    issueDate: ts(),
    dueDate: ts(),
    /** Set when status becomes "paid"; drives revenue-by-month */
    paidAt: ts(),
    items: jsonb().$type<InvoiceItem[]>().notNull().default([]),
    notes: text(),
    placeOfSupply: text().default('Gujarat'),
    isIntraState: boolean().notNull().default(true),
    gstExempt: boolean().notNull().default(false),
    subTotal: doublePrecision(),
    totalTax: doublePrecision(),
    grandTotal: doublePrecision(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.invoiceNumber), index().on(t.clientId), index().on(t.status), index().on(t.createdAt), index().on(t.paidAt)]
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    body: text(),
    type: text(),
    link: text(),
    read: boolean().notNull().default(false),
    readAt: ts(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [index().on(t.userId, t.createdAt.desc())]
);

export const comments = pgTable(
  'comments',
  {
    id: id(),
    entityType: text().$type<CommentEntityType>().notNull(),
    entityId: uuid().notNull(),
    projectId: uuid().notNull().references(() => projects.id, { onDelete: 'cascade' }),
    content: text().notNull(),
    authorId: uuid().references(() => users.id, { onDelete: 'set null' }),
    isInternal: boolean().notNull().default(false),
    mentions: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    attachments: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    parentId: uuid().references((): AnyPgColumn => comments.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [index().on(t.entityType, t.entityId, t.createdAt), index().on(t.projectId), index().on(t.parentId)]
);

export const activities = pgTable(
  'activities',
  {
    id: id(),
    projectId: uuid().references(() => projects.id, { onDelete: 'cascade' }),
    action: text().notNull(),
    entityType: text(),
    entityId: uuid(),
    actorId: uuid().references(() => users.id, { onDelete: 'set null' }),
    metadata: jsonb().$type<Record<string, unknown>>(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.projectId, t.createdAt.desc()), index().on(t.actorId)]
);

export const emailLogs = pgTable(
  'email_logs',
  {
    id: id(),
    template: text().notNull(),
    to: text().array().notNull().default(sql`'{}'::text[]`),
    subject: text(),
    status: text().$type<'sent' | 'failed'>().notNull(),
    resendId: text(),
    error: text(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.template), index().on(t.createdAt)]
);

export const permissions = pgTable(
  'permissions',
  {
    id: id(),
    module: text().notNull(),
    resource: text().notNull(),
    actions: text().array().notNull().default(sql`'{}'::text[]`),
    scope: text().$type<'own' | 'department' | 'all'>(),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.module, t.resource)]
);

/**
 * Every role a user can hold: the system roles (slug = users.role, e.g. SALES) and custom roles.
 * `permissions` holds the permission slugs (quotations.create, …) listed in lib/erpPermissions.ts;
 * Super Admin and Management hold all of them implicitly.
 */
export const roles = pgTable('roles', {
  id: id(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  description: text(),
  permissionIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
  permissions: text().array().notNull().default(sql`'{}'::text[]`),
  isSystem: boolean().notNull().default(false),
  createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
});

// ─── Quotations: catalog, pricing, quotations and payments ────────────────────

export const languages = pgTable('languages', {
  id: id(),
  name: text().notNull().unique(),
  /** ISO code, unique among languages that have one */
  code: text().unique(),
  active: boolean().notNull().default(true),
  sortOrder: integer().notNull().default(0),
  ...timestamps,
});

export const videoTypes = pgTable('video_types', {
  id: id(),
  name: text().notNull().unique(),
  description: text(),
  /** A quotation line must name the performer, and rates differ per performer */
  requiresPerformer: boolean().notNull().default(false),
  /** No fixed rate: whoever writes the quotation enters the price */
  customPrice: boolean().notNull().default(false),
  active: boolean().notNull().default(true),
  sortOrder: integer().notNull().default(0),
  ...timestamps,
});

/** Preset duration choices; a custom duration can still be typed on the form */
export const durations = pgTable('durations', {
  id: id(),
  label: text().notNull(),
  minutes: numeric({ precision: 10, scale: 2 }).notNull().unique(),
  active: boolean().notNull().default(true),
  sortOrder: integer().notNull().default(0),
  ...timestamps,
});

/** On-camera talent for video editing (green screen, UGC, raw shoots); quotations show the code only */
export const performers = pgTable('performers', {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  active: boolean().notNull().default(true),
  sortOrder: integer().notNull().default(0),
  ...timestamps,
});

export const ARTIST_GENDERS = ['male', 'female', 'other'] as const;

/** Video editors, voice artists and dubbing artists; quotations show the code only */
export const artists = pgTable(
  'artists',
  {
    id: id(),
    code: text().notNull().unique(),
    name: text().notNull(),
    gender: text().$type<(typeof ARTIST_GENDERS)[number]>(),
    email: text(),
    phone: text(),
    employeeId: uuid().references(() => employees.id, { onDelete: 'set null' }),
    notes: text(),
    active: boolean().notNull().default(true),
    /** Soft delete: past quotations keep the reference, pricing rules stop matching */
    deletedAt: ts(),
    ...timestamps,
  },
  (t) => [index().on(t.active), index().on(t.deletedAt)]
);

export const artistServices = pgTable(
  'artist_services',
  {
    artistId: uuid().notNull().references(() => artists.id, { onDelete: 'cascade' }),
    serviceId: uuid().notNull().references(() => services.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.artistId, t.serviceId] }), index().on(t.serviceId)]
);

/** Languages an artist performs in; none = offered for every language */
export const artistLanguages = pgTable(
  'artist_languages',
  {
    artistId: uuid().notNull().references(() => artists.id, { onDelete: 'cascade' }),
    languageId: uuid().notNull().references(() => languages.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.artistId, t.languageId] }), index().on(t.languageId)]
);

export const PRICING_UNITS = ['per_minute', 'per_second', 'per_unit'] as const;
export type PricingUnit = (typeof PRICING_UNITS)[number];

/**
 * A rate for a service, optionally narrowed by artist, language, source language, video type, performer,
 * duration range, minimum quantity and date window (null = any). See erp/pricing.ts for rule selection.
 */
export const pricingRules = pgTable(
  'pricing_rules',
  {
    id: id(),
    name: text(),
    serviceId: uuid().notNull().references(() => services.id, { onDelete: 'restrict' }),
    artistId: uuid().references(() => artists.id, { onDelete: 'restrict' }),
    /** For dubbing, the target (dubbing) language */
    languageId: uuid().references(() => languages.id, { onDelete: 'restrict' }),
    sourceLanguageId: uuid().references(() => languages.id, { onDelete: 'restrict' }),
    videoTypeId: uuid().references(() => videoTypes.id, { onDelete: 'restrict' }),
    performerId: uuid().references(() => performers.id, { onDelete: 'restrict' }),
    unit: text().$type<PricingUnit>().notNull().default('per_minute'),
    basePrice: numeric({ precision: 14, scale: 2 }).notNull(),
    /** What VTI pays the artist; never shown on quotations */
    costPrice: numeric({ precision: 14, scale: 2 }),
    minQuantity: integer().notNull().default(1),
    minDurationMinutes: numeric({ precision: 10, scale: 2 }),
    maxDurationMinutes: numeric({ precision: 10, scale: 2 }),
    effectiveFrom: date({ mode: 'string' }),
    effectiveTo: date({ mode: 'string' }),
    priority: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    notes: text(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index().on(t.serviceId, t.artistId, t.active), index().on(t.effectiveFrom, t.effectiveTo)]
);

export const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'cancelled'] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];
export const QUOTATION_VALIDITIES = ['15_days', '1_month', 'custom'] as const;
export type QuotationValidity = (typeof QUOTATION_VALIDITIES)[number];

export interface PaymentAttachment {
  /** Path inside the storage directory, e.g. "payments/4f1c….png" */
  file: string;
  name: string;
  mime: string;
  size: number;
}

/** Names and codes as they were when a line was priced, so later catalog edits never rewrite history */
export interface LineSnapshot {
  service: { id: string; name: string; slug: string };
  artist: { id: string; code: string; name: string } | null;
  language: { id: string; name: string } | null;
  source_language: { id: string; name: string } | null;
  video_type: { id: string; name: string } | null;
  performer: { id: string; code: string; name: string } | null;
  duration_label: string;
}

export const quotations = pgTable(
  'quotations',
  {
    id: id(),
    quotationNumber: text().unique(),
    status: text().$type<QuotationStatus>().notNull().default('draft'),
    subject: text(),
    details: text(),
    clientName: text().notNull(),
    clientCompany: text(),
    clientEmail: text(),
    clientPhone: text(),
    clientGstin: text(),
    clientAddress: text(),
    scope: text(),
    includedServices: text(),
    terms: text(),
    preparedByName: text(),
    preparedByPhone: text(),
    externalReference: text(),
    /** The CRM lead this quotation was written for */
    leadId: uuid().references(() => leads.id, { onDelete: 'set null' }),
    currency: text().notNull().default('INR'),
    subtotal: numeric({ precision: 14, scale: 2 }).notNull().default('0'),
    includeGst: boolean().notNull().default(true),
    taxRate: numeric({ precision: 6, scale: 2 }).notNull().default('0'),
    taxAmount: numeric({ precision: 14, scale: 2 }).notNull().default('0'),
    grandTotal: numeric({ precision: 14, scale: 2 }).notNull().default('0'),
    notes: text(),
    validity: text().$type<QuotationValidity>().notNull().default('15_days'),
    validityDays: integer(),
    validUntil: date({ mode: 'string' }),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** Sum of the payments recorded against this quotation, kept in step by the payments routes */
    amountPaid: numeric({ precision: 14, scale: 2 }).notNull().default('0'),
    paymentCompletedAt: ts(),
    paymentCompletedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    deletedAt: ts(),
    ...timestamps,
  },
  (t) => [
    index().on(t.status, t.createdAt),
    index().on(t.createdAt),
    index().on(t.createdBy),
    index().on(t.externalReference),
    index().on(t.leadId),
  ]
);

export const quotationItems = pgTable(
  'quotation_items',
  {
    id: id(),
    quotationId: uuid().notNull().references(() => quotations.id, { onDelete: 'cascade' }),
    serviceId: uuid().notNull().references(() => services.id, { onDelete: 'restrict' }),
    artistId: uuid().references(() => artists.id, { onDelete: 'restrict' }),
    videoTypeId: uuid().references(() => videoTypes.id, { onDelete: 'restrict' }),
    performerId: uuid().references(() => performers.id, { onDelete: 'restrict' }),
    languageId: uuid().references(() => languages.id, { onDelete: 'restrict' }),
    sourceLanguageId: uuid().references(() => languages.id, { onDelete: 'restrict' }),
    durationId: uuid().references(() => durations.id, { onDelete: 'restrict' }),
    pricingRuleId: uuid().references(() => pricingRules.id, { onDelete: 'restrict' }),
    durationMinutes: numeric({ precision: 10, scale: 2 }).notNull(),
    quantity: integer().notNull(),
    unit: text().$type<PricingUnit>().notNull(),
    unitPrice: numeric({ precision: 14, scale: 2 }).notNull(),
    /** unit_price was entered on the quotation rather than taken from a pricing rule */
    isCustomPrice: boolean().notNull().default(false),
    /** The rule's price when the line was priced, even if a custom price replaced it. Internal only. */
    basePrice: numeric({ precision: 14, scale: 2 }),
    lineTotal: numeric({ precision: 14, scale: 2 }).notNull(),
    description: text().notNull(),
    snapshot: jsonb().$type<LineSnapshot>(),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [index().on(t.quotationId, t.sortOrder), index().on(t.serviceId), index().on(t.artistId)]
);

/** Last quotation number issued per calendar day (business timezone) */
export const quotationSequences = pgTable('quotation_sequences', {
  date: text().primaryKey(),
  lastNumber: integer().notNull().default(0),
});

export const PAYMENT_RECEIVERS = { khushali: "Khushali Ma'am", alka: "Alka Ma'am", cash: 'Cash' } as const;
export type PaymentReceiver = keyof typeof PAYMENT_RECEIVERS;
export const PAYMENT_METHODS = {
  gpay: 'G-Pay',
  cash: 'Cash',
  cheque: 'Cheque',
  bank_deposit: 'Bank deposit',
  neft_imps: 'NEFT/IMPS',
  custom: 'Custom',
} as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;

/** One amount received against a quotation */
export const quotationPayments = pgTable(
  'quotation_payments',
  {
    id: id(),
    quotationId: uuid().notNull().references(() => quotations.id, { onDelete: 'cascade' }),
    amount: numeric({ precision: 14, scale: 2 }).notNull(),
    receivedBy: text().$type<PaymentReceiver>().notNull(),
    method: text().$type<PaymentMethod>().notNull(),
    /** The method's name when `method` is custom */
    methodDetail: text(),
    /** The day the money was paid (YYYY-MM-DD) */
    paidOn: date({ mode: 'string' }).notNull(),
    reference: text(),
    notes: text(),
    attachment: jsonb().$type<PaymentAttachment>(),
    recordedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index().on(t.quotationId, t.paidOn)]
);

export const SETTING_TYPES = ['string', 'text', 'number', 'boolean', 'list'] as const;
export type SettingType = (typeof SETTING_TYPES)[number];

/** Company, quotation and tax settings edited in Admin → Settings */
export const companySettings = pgTable(
  'company_settings',
  {
    id: id(),
    group: text().notNull(),
    key: text().notNull().unique(),
    value: jsonb().$type<unknown>(),
    type: text().$type<SettingType>().notNull().default('string'),
    label: text().notNull(),
    description: text(),
    sortOrder: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [index().on(t.group)]
);

/** Audit trail: sign-ins, quotation changes, catalog and settings edits */
export const activityLogs = pgTable(
  'activity_logs',
  {
    id: id(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    event: text().notNull(),
    subjectType: text(),
    subjectId: text(),
    description: text().notNull(),
    properties: jsonb().$type<Record<string, unknown>>(),
    ipAddress: text(),
    userAgent: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.createdAt.desc()), index().on(t.userId), index().on(t.event)]
);

/**
 * Change counters the website polls instead of holding a socket open (serverless hosting has no
 * long-lived connections): e.g. `kanban` goes up whenever a task or project moves, `crm` whenever a
 * call or follow-up arrives from a phone.
 */
export const appSignals = pgTable('app_signals', {
  key: text().primaryKey(),
  version: bigint({ mode: 'number' }).notNull().default(0),
  updatedAt: ts().notNull().defaultNow(),
});

/** Background jobs (lead sync, Exotel polling, reminders): when each last ran, so every instance agrees */
export const jobRuns = pgTable('job_runs', {
  key: text().primaryKey(),
  lastStartedAt: ts(),
  lastFinishedAt: ts(),
  lastDurationMs: integer(),
  lastError: text(),
});

// ─── Relations (used by db.query.* `with` to populate references) ─────────────
// Relation names are mapped back to the legacy Mongo field names in lib/serialize.ts.

export const clientsRelations = relations(clients, ({ many }) => ({
  projects: many(projects),
}));

export const usersRelations = relations(users, ({ one }) => ({
  client: one(clients, { fields: [users.clientId], references: [clients.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  client: one(clients, { fields: [projects.clientId], references: [clients.id] }),
  creator: one(users, { fields: [projects.createdBy], references: [users.id] }),
  members: many(projectTeamMembers),
  tasks: many(tasks),
}));

export const projectTeamMembersRelations = relations(projectTeamMembers, ({ one }) => ({
  project: one(projects, { fields: [projectTeamMembers.projectId], references: [projects.id] }),
  user: one(users, { fields: [projectTeamMembers.userId], references: [users.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  assignee: one(users, { fields: [tasks.assignedTo], references: [users.id], relationName: 'taskAssignee' }),
  creator: one(users, { fields: [tasks.createdBy], references: [users.id], relationName: 'taskCreator' }),
}));

export const timeEntriesRelations = relations(timeEntries, ({ one }) => ({
  user: one(users, { fields: [timeEntries.userId], references: [users.id] }),
  task: one(tasks, { fields: [timeEntries.taskId], references: [tasks.id] }),
  project: one(projects, { fields: [timeEntries.projectId], references: [projects.id] }),
}));

export const filesRelations = relations(files, ({ one }) => ({
  project: one(projects, { fields: [files.projectId], references: [projects.id] }),
  task: one(tasks, { fields: [files.taskId], references: [tasks.id] }),
  uploader: one(users, { fields: [files.uploadedBy], references: [users.id] }),
}));

export const contentCalendarRelations = relations(contentCalendar, ({ one }) => ({
  project: one(projects, { fields: [contentCalendar.projectId], references: [projects.id] }),
  creativeFile: one(files, { fields: [contentCalendar.creativeFileId], references: [files.id] }),
  creator: one(users, { fields: [contentCalendar.createdBy], references: [users.id] }),
}));

export const adCampaignsRelations = relations(adCampaigns, ({ one }) => ({
  project: one(projects, { fields: [adCampaigns.projectId], references: [projects.id] }),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  assignee: one(users, { fields: [leads.assignedTo], references: [users.id] }),
  service: one(services, { fields: [leads.serviceId], references: [services.id] }),
  leadSource: one(leadSources, { fields: [leads.sourceId], references: [leadSources.id] }),
  followups: many(leadFollowups),
  assignments: many(leadAssignments),
}));

export const leadFollowupsRelations = relations(leadFollowups, ({ one }) => ({
  lead: one(leads, { fields: [leadFollowups.leadId], references: [leads.id] }),
  user: one(users, { fields: [leadFollowups.userId], references: [users.id] }),
}));

export const leadAssignmentsRelations = relations(leadAssignments, ({ one }) => ({
  lead: one(leads, { fields: [leadAssignments.leadId], references: [leads.id] }),
  fromUser: one(users, { fields: [leadAssignments.fromUserId], references: [users.id], relationName: 'assignmentFrom' }),
  toUser: one(users, { fields: [leadAssignments.toUserId], references: [users.id], relationName: 'assignmentTo' }),
  byUser: one(users, { fields: [leadAssignments.byUserId], references: [users.id], relationName: 'assignmentBy' }),
}));

export const departmentsRelations = relations(departments, ({ one }) => ({
  division: one(divisions, { fields: [departments.divisionId], references: [divisions.id] }),
}));

export const employeesRelations = relations(employees, ({ one }) => ({
  division: one(divisions, { fields: [employees.divisionId], references: [divisions.id] }),
  department: one(departments, { fields: [employees.departmentId], references: [departments.id] }),
  designation: one(designations, { fields: [employees.designationId], references: [designations.id] }),
  user: one(users, { fields: [employees.userId], references: [users.id] }),
}));

export const salariesRelations = relations(salaries, ({ one }) => ({
  employee: one(employees, { fields: [salaries.employeeId], references: [employees.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  client: one(clients, { fields: [invoices.clientId], references: [clients.id] }),
  project: one(projects, { fields: [invoices.projectId], references: [projects.id] }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
  parent: one(comments, { fields: [comments.parentId], references: [comments.id] }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  actor: one(users, { fields: [activities.actorId], references: [users.id] }),
}));
