# Voice Tunes India — MongoDB Schema

## 1. Overview

All collections use `_id` as ObjectId. Timestamps `createdAt` and `updatedAt` are managed via Mongoose `timestamps: true`.

---

## 2. Collections

### 2.1 User

```javascript
{
  _id: ObjectId,
  email: String,           // unique, required
  username: String,        // unique, required
  passwordHash: String,    // bcrypt, required
  name: String,            // required
  role: String,            // enum: SUPER_ADMIN | TEAM_MEMBER | CLIENT
  initials: String,        // optional, e.g. "AS"
  avatarUrl: String,        // optional
  clientId: ObjectId,      // ref: Client, only for role=CLIENT
  isActive: Boolean,       // default: true
  lastLoginAt: Date,
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes:** `email` (unique), `username` (unique), `role`, `clientId`

---

### 2.2 Client

```javascript
{
  _id: ObjectId,
  companyName: String,     // required
  contactName: String,     // required
  contactEmail: String,    // required, unique
  phone: String,
  address: String,
  portalLogin: String,     // unique, for client portal
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes:** `contactEmail` (unique), `portalLogin` (unique)

---

### 2.3 Project

```javascript
{
  _id: ObjectId,
  projectName: String,     // required
  clientId: ObjectId,      // ref: Client, required
  clientName: String,      // denormalized for display
  clientEmail: String,     // denormalized
  startDate: Date,
  endDate: Date,
  projectStatus: String,   // enum: ACTIVE | ON_HOLD | COMPLETED
  description: String,
  teamMembers: [ObjectId], // ref: User
  createdBy: ObjectId,     // ref: User
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes:** `clientId`, `projectStatus`, `teamMembers`, `createdAt`

---

### 2.4 Task

```javascript
{
  _id: ObjectId,
  projectId: ObjectId,     // ref: Project, required
  title: String,           // required
  description: String,
  assignedTo: ObjectId,    // ref: User
  priority: String,       // enum: LOW | MEDIUM | HIGH
  deadline: Date,
  status: String,          // enum: BACKLOG | TO_DO | IN_PROGRESS | REVIEW | COMPLETED
  tags: [String],
  position: Number,        // for Kanban ordering
  attachments: [ObjectId], // ref: File
  approvalStatus: String,  // enum: PENDING | APPROVED | REJECTED (for client deliverables)
  approvedBy: ObjectId,    // ref: User (client)
  approvedAt: Date,
  rejectionReason: String,
  createdBy: ObjectId,     // ref: User
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes:** `projectId`, `assignedTo`, `status`, `deadline`, `priority`, `approvalStatus`

---

### 2.5 TimeEntry

```javascript
{
  _id: ObjectId,
  userId: ObjectId,        // ref: User, required
  taskId: ObjectId,        // ref: Task, required
  projectId: ObjectId,     // ref: Project (denormalized for reporting)
  startTime: Date,         // required
  endTime: Date,           // required
  totalMinutes: Number,    // computed: (endTime - startTime) / 60000
  notes: String,
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes:** `userId`, `taskId`, `projectId`, `startTime`

---

### 2.6 File

```javascript
{
  _id: ObjectId,
  filename: String,        // original name
  mimeType: String,       // image/*, application/pdf, video/*, etc.
  size: Number,            // bytes
  url: String,             // Cloudinary/S3 URL
  storageKey: String,      // S3 key or Cloudinary public_id
  projectId: ObjectId,     // ref: Project
  taskId: ObjectId,       // ref: Task (optional)
  uploadedBy: ObjectId,    // ref: User
  version: Number,         // default: 1
  versions: [{
    version: Number,
    url: String,
    storageKey: String,
    uploadedAt: Date,
    uploadedBy: ObjectId
  }],
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes:** `projectId`, `taskId`, `uploadedBy`, `createdAt`

---

### 2.7 ContentCalendar

```javascript
{
  _id: ObjectId,
  projectId: ObjectId,     // ref: Project, required
  date: Date,              // scheduled date
  platform: String,        // enum: INSTAGRAM | FACEBOOK | LINKEDIN | YOUTUBE
  postType: String,        // enum: REEL | CAROUSEL | STATIC | STORY | VIDEO
  caption: String,
  creativeFileId: ObjectId, // ref: File
  status: String,          // enum: PLANNED | DESIGNING | APPROVAL | SCHEDULED | POSTED
  position: Number,        // for drag-drop ordering
  approvedBy: ObjectId,    // ref: User (client)
  approvedAt: Date,
  postedAt: Date,
  createdBy: ObjectId,
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes:** `projectId`, `date`, `platform`, `status`

---

### 2.8 AdCampaign

```javascript
{
  _id: ObjectId,
  projectId: ObjectId,     // ref: Project, required
  campaignName: String,    // required
  platform: String,        // enum: META_ADS | GOOGLE_ADS
  dailyBudget: Number,     // in currency units
  startDate: Date,
  endDate: Date,
  status: String,          // enum: ACTIVE | PAUSED | COMPLETED
  impressions: Number,     // default: 0
  clicks: Number,          // default: 0
  ctr: Number,             // clicks/impressions * 100
  cpc: Number,             // cost per click
  leads: Number,           // default: 0
  notes: String,
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes:** `projectId`, `platform`, `status`, `startDate`

---

### 2.9 Comment

```javascript
{
  _id: ObjectId,
  entityType: String,      // enum: TASK | FILE | CONTENT_CALENDAR | PROJECT
  entityId: ObjectId,     // ref: Task | File | ContentCalendar | Project
  projectId: ObjectId,    // ref: Project (for filtering)
  content: String,        // required
  authorId: ObjectId,     // ref: User
  isInternal: Boolean,    // true = team only, false = visible to client
  mentions: [ObjectId],   // ref: User
  attachments: [ObjectId], // ref: File
  parentId: ObjectId,     // ref: Comment (for threaded replies)
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes:** `entityType` + `entityId`, `projectId`, `authorId`, `parentId`

---

### 2.10 Activity

```javascript
{
  _id: ObjectId,
  projectId: ObjectId,     // ref: Project
  action: String,          // e.g. "task_assigned", "file_uploaded", "approval_approved"
  entityType: String,      // TASK | FILE | COMMENT | etc.
  entityId: ObjectId,
  actorId: ObjectId,      // ref: User
  metadata: Object,        // flexible: { taskName, assigneeName, etc. }
  createdAt: Date
}
```

**Indexes:** `projectId`, `actorId`, `createdAt` (desc)

---

### 2.11 Notification

```javascript
{
  _id: ObjectId,
  userId: ObjectId,        // ref: User, required
  title: String,
  body: String,
  type: String,            // task_assigned, deadline_reminder, approval_requested, etc.
  link: String,            // deep link to relevant page
  read: Boolean,           // default: false
  readAt: Date,
  metadata: Object,        // flexible payload
  createdAt: Date
}
```

**Indexes:** `userId`, `read`, `createdAt` (desc)

---

### 2.12 EmailLog (for audit)

```javascript
{
  _id: ObjectId,
  template: String,        // task-assigned, deadline-reminder, etc.
  to: [String],            // email addresses
  subject: String,
  status: String,          // sent | failed
  resendId: String,       // Resend API response id
  error: String,           // if failed
  metadata: Object,
  createdAt: Date
}
```

**Indexes:** `template`, `createdAt`

---

## 3. Enums Reference

| Collection      | Field          | Values                                                                 |
|-----------------|----------------|-------------------------------------------------------------------------|
| User            | role           | SUPER_ADMIN, TEAM_MEMBER, CLIENT                                       |
| Project         | projectStatus  | ACTIVE, ON_HOLD, COMPLETED                                             |
| Task            | priority       | LOW, MEDIUM, HIGH                                                      |
| Task            | status         | BACKLOG, TO_DO, IN_PROGRESS, REVIEW, COMPLETED                         |
| Task            | approvalStatus | PENDING, APPROVED, REJECTED                                            |
| ContentCalendar | platform       | INSTAGRAM, FACEBOOK, LINKEDIN, YOUTUBE                                 |
| ContentCalendar | postType       | REEL, CAROUSEL, STATIC, STORY, VIDEO                                  |
| ContentCalendar | status         | PLANNED, DESIGNING, APPROVAL, SCHEDULED, POSTED                        |
| AdCampaign      | platform       | META_ADS, GOOGLE_ADS                                                   |
| AdCampaign      | status         | ACTIVE, PAUSED, COMPLETED                                              |
| Comment         | entityType     | TASK, FILE, CONTENT_CALENDAR, PROJECT                                  |

---

## 4. Relationships Summary

```
User ──► Client (1:1 for CLIENT role)
User ──► Project (teamMembers: many-to-many)
User ──► Task (assignedTo, createdBy)
User ──► TimeEntry (userId)
User ──► File (uploadedBy)
User ──► Comment (authorId)
User ──► Notification (userId)
User ──► Activity (actorId)

Client ──► Project (1:many)
Project ──► Task (1:many)
Project ──► TimeEntry (1:many via task)
Project ──► File (1:many)
Project ──► ContentCalendar (1:many)
Project ──► AdCampaign (1:many)
Project ──► Comment (1:many via entityId)
Project ──► Activity (1:many)

Task ──► TimeEntry (1:many)
Task ──► File (attachments: many)
Task ──► Comment (entityType + entityId)
```

---

## 5. Seed Data (Initial Users)

| Username | Name           | Role        | Email (example)     |
|----------|----------------|-------------|---------------------|
| adarsh   | Adarsh Sharma  | SUPER_ADMIN | adarsh@voicetunesindia.com  |
| dheeraj  | Dheeraj Sharma | SUPER_ADMIN | dheeraj@voicetunesindia.com |
| aditi    | Aditi Parmar   | SUPER_ADMIN | aditi@voicetunesindia.com   |
| shital   | Shital Gahiwad | TEAM_MEMBER | shital@voicetunesindia.com  |
| poojan   | Poojan Prajapati| TEAM_MEMBER| poojan@voicetunesindia.com  |

Client users are created per client and linked via `clientId`.

---

*Document Version: 1.0 | Voice Tunes India MongoDB Schema*
