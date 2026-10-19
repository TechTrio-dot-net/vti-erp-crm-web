# Voice Tunes India — Complete ERP System Blueprint

**Version:** 1.0  
**Last Updated:** March 2025  
**Status:** Architecture & Design Phase

---

## Step 1: System Architecture Overview

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                             │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  Next.js 15 (App Router) • TypeScript • Tailwind CSS • Zustand • TanStack Query v5   │
│  Hosted on Vercel                                                                     │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │ HTTPS / WebSocket (optional)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              API GATEWAY LAYER                                        │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  Node.js • Express.js • TypeScript                                                   │
│  Hosted on Railway                                                                    │
│  • REST API                                                                           │
│  • Firebase Auth (verify ID tokens)                                                  │
│  • RBAC (multi-role per user)                                                         │
│  • Rate limiting • CORS                                                               │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
         ┌───────────────────────────────┼───────────────────────────────┐
         ▼                               ▼                               ▼
┌─────────────────┐           ┌─────────────────┐           ┌─────────────────┐
│  Firebase Auth   │           │  Resend (Email)   │           │  MongoDB Atlas  │
│  • Auth tokens  │           │  • Notifications  │           │  • Primary DB   │
│  • User claims  │           │  • Alerts         │           │  • Hosted       │
└─────────────────┘           └─────────────────┘           └─────────────────┘
```

### 1.2 Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Modularity** | Each ERP module is a self-contained unit with its own models, routes, services, and controllers |
| **Scalability** | Stateless API, horizontal scaling, indexed MongoDB queries, connection pooling |
| **Simplicity** | Flat module structure, consistent naming, minimal abstraction layers |
| **Extensibility** | Plugin-ready design for future integrations (WhatsApp, Slack, payment gateways) |
| **Security** | Firebase Auth + RBAC, input validation (Zod), audit logging, rate limiting |

### 1.3 Deployment Topology

```
                    ┌─────────────┐
                    │   Vercel    │
                    │  (Next.js)  │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   Railway   │
                    │  (Express)  │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
       ┌──────────┐ ┌──────────┐ ┌──────────┐
       │ Firebase │ │ Resend   │ │ MongoDB  │
       │   Auth   │ │  Email   │ │  Atlas   │
       └──────────┘ └──────────┘ └──────────┘
```

---

## Step 2: ERP Module Breakdown

### 2.1 Module Map

| Module | Purpose | Key Entities |
|--------|---------|--------------|
| **Dashboard** | Company-wide analytics, KPIs, widgets | KPIs, Widgets, ActivityFeed |
| **HR** | Employees, attendance, leave, payroll, recruitment, performance | Employee, Attendance, Leave, Payroll, JobOpening, Candidate, Review |
| **Sales** | Leads, CRM, deals, proposals | Lead, Client, Deal, Proposal |
| **Marketing** | Campaigns, content, analytics | Campaign, ContentPost, LeadSource |
| **Product** | Projects, tasks, bugs, sprints, releases | Project, Task, Bug, Sprint, Release |
| **Support** | Tickets, knowledge base, feedback | Ticket, Article, Feedback |
| **Finance** | Invoices, payments, expenses, reports | Invoice, Payment, Expense, Report |
| **Operations** | Vendors, assets, internal requests | Vendor, Asset, Request |
| **Legal** | Contracts, compliance, documents | Contract, ComplianceDoc |
| **IT** | Users, roles, permissions, security, monitoring | User, Role, Permission, SecurityLog, Backup |

### 2.2 Module Dependencies

```
Dashboard ──────► All modules (aggregates data)
     │
     ├── HR ──────────────► Employee, Attendance, Leave, Payroll
     ├── Sales ───────────► Lead, Client, Deal, Proposal
     ├── Marketing ────────► Campaign, ContentPost
     ├── Product ──────────► Project, Task, Bug, Sprint
     ├── Support ──────────► Ticket, Article
     ├── Finance ──────────► Invoice, Payment, Expense
     ├── Operations ───────► Vendor, Asset, Request
     ├── Legal ────────────► Contract, ComplianceDoc
     └── IT ───────────────► User, Role, Permission
```

### 2.3 Cross-Module Features

| Feature | Modules | Implementation |
|---------|---------|-----------------|
| **Notifications** | All | Central NotificationService, Resend for email |
| **Activity Logs** | All | ActivityLog model, middleware on write operations |
| **Comments** | Product, Support, Sales | Comment model with polymorphic ref (taskId, ticketId, dealId) |
| **Mentions** | Comments | @userId parsing, Notification on mention |
| **File Uploads** | All | File model, polymorphic ref, presigned URLs or direct upload |
| **Global Search** | All | Search index (MongoDB Atlas Search or separate search service) |
| **Audit Logs** | All | AuditLog model, diff tracking on updates |

---

## Step 3: MongoDB Database Schema Design

### 3.1 Core Collections

#### Users
```javascript
{
  _id: ObjectId,
  firebaseUid: String,        // Firebase Auth UID (unique)
  email: String,
  name: String,
  avatarUrl: String,
  roleIds: [ObjectId],        // Multiple roles
  isActive: Boolean,
  lastLoginAt: Date,
  createdAt: Date,
  updatedAt: Date,
  createdBy: ObjectId,
  updatedBy: ObjectId
}
```

#### Roles
```javascript
{
  _id: ObjectId,
  name: String,               // "Founder", "Sales Manager", "Developer"
  slug: String,               // "founder", "sales-manager"
  description: String,
  permissionIds: [ObjectId],
  isSystem: Boolean,           // Cannot delete system roles
  createdAt: Date,
  updatedAt: Date,
  createdBy: ObjectId,
  updatedBy: ObjectId
}
```

#### Permissions
```javascript
{
  _id: ObjectId,
  module: String,             // "hr", "sales", "marketing", etc.
  resource: String,           // "employee", "lead", "project"
  actions: [String],          // ["create", "read", "update", "delete"]
  scope: String,              // "own", "department", "all" (optional)
  createdAt: Date,
  updatedAt: Date
}
```

#### Employees
```javascript
{
  _id: ObjectId,
  userId: ObjectId,            // Links to Users
  employeeId: String,         // Human-readable ID (EMP-001)
  departmentId: ObjectId,
  designation: String,
  joinDate: Date,
  documents: [{ name, url, type }],
  salaryStructureId: ObjectId,
  reportingTo: ObjectId,
  createdAt: Date,
  updatedAt: Date,
  createdBy: ObjectId,
  updatedBy: ObjectId
}
```

#### Leads
```javascript
{
  _id: ObjectId,
  companyName: String,
  contactName: String,
  email: String,
  phone: String,
  source: String,             // "website", "referral", "campaign"
  stage: String,              // "new", "qualified", "proposal", "negotiation", "won", "lost"
  assignedTo: ObjectId,
  estimatedValue: Number,
  notes: String,
  clientId: ObjectId,         // When converted to client
  createdAt: Date,
  updatedAt: Date,
  createdBy: ObjectId,
  updatedBy: ObjectId
}
```

#### Clients
```javascript
{
  _id: ObjectId,
  companyName: String,
  contactName: String,
  email: String,
  phone: String,
  address: Object,
  portalLogin: String,
  leadId: ObjectId,            // Source lead
  createdAt: Date,
  updatedAt: Date,
  createdBy: ObjectId,
  updatedBy: ObjectId
}
```

#### Deals
```javascript
{
  _id: ObjectId,
  clientId: ObjectId,
  leadId: ObjectId,
  title: String,
  value: Number,
  stage: String,               // "new", "qualified", "proposal", "negotiation", "won", "lost"
  probability: Number,
  expectedCloseDate: Date,
  assignedTo: ObjectId,
  proposalId: ObjectId,
  createdAt: Date,
  updatedAt: Date,
  createdBy: ObjectId,
  updatedBy: ObjectId
}
```

#### Projects
```javascript
{
  _id: ObjectId,
  projectName: String,
  clientId: ObjectId,
  clientName: String,
  clientEmail: String,
  status: String,             // "active", "on_hold", "completed"
  startDate: Date,
  endDate: Date,
  teamMembers: [ObjectId],
  createdBy: ObjectId,
  createdAt: Date,
  updatedAt: Date,
  createdBy: ObjectId,
  updatedBy: ObjectId
}
```

#### Tasks
```javascript
{
  _id: ObjectId,
  projectId: ObjectId,
  title: String,
  description: String,
  assignedTo: ObjectId,
  status: String,             // "backlog", "todo", "in_progress", "review", "completed"
  priority: String,
  deadline: Date,
  position: Number,
  sprintId: ObjectId,
  createdAt: Date,
  updatedAt: Date,
  createdBy: ObjectId,
  updatedBy: ObjectId
}
```

#### Tickets (Support)
```javascript
{
  _id: ObjectId,
  ticketNumber: String,
  subject: String,
  description: String,
  clientId: ObjectId,
  status: String,             // "open", "in_progress", "pending", "resolved", "closed"
  priority: String,
  assignedTo: ObjectId,
  category: String,
  createdAt: Date,
  updatedAt: Date,
  createdBy: ObjectId,
  updatedBy: ObjectId
}
```

#### Invoices
```javascript
{
  _id: ObjectId,
  invoiceNumber: String,
  clientId: ObjectId,
  projectId: ObjectId,
  amount: Number,
  currency: String,
  status: String,             // "draft", "sent", "paid", "overdue"
  dueDate: Date,
  items: [{ description, quantity, rate, amount }],
  createdAt: Date,
  updatedAt: Date,
  createdBy: ObjectId,
  updatedBy: ObjectId
}
```

#### Payments
```javascript
{
  _id: ObjectId,
  invoiceId: ObjectId,
  amount: Number,
  method: String,
  reference: String,
  paidAt: Date,
  createdAt: Date,
  updatedAt: Date,
  createdBy: ObjectId,
  updatedBy: ObjectId
}
```

#### Expenses
```javascript
{
  _id: ObjectId,
  description: String,
  amount: Number,
  category: String,
  departmentId: ObjectId,
  projectId: ObjectId,
  status: String,
  receiptUrl: String,
  createdAt: Date,
  updatedAt: Date,
  createdBy: ObjectId,
  updatedBy: ObjectId
}
```

#### Assets
```javascript
{
  _id: ObjectId,
  name: String,
  type: String,               // "laptop", "device", "license"
  serialNumber: String,
  assignedTo: ObjectId,
  status: String,
  purchaseDate: Date,
  createdAt: Date,
  updatedAt: Date,
  createdBy: ObjectId,
  updatedBy: ObjectId
}
```

#### Vendors
```javascript
{
  _id: ObjectId,
  name: String,
  contactName: String,
  email: String,
  phone: String,
  category: String,
  createdAt: Date,
  updatedAt: Date,
  createdBy: ObjectId,
  updatedBy: ObjectId
}
```

#### Contracts
```javascript
{
  _id: ObjectId,
  title: String,
  type: String,               // "client", "vendor"
  clientId: ObjectId,
  vendorId: ObjectId,
  startDate: Date,
  endDate: Date,
  documentUrl: String,
  status: String,
  createdAt: Date,
  updatedAt: Date,
  createdBy: ObjectId,
  updatedBy: ObjectId
}
```

#### Notifications
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  title: String,
  body: String,
  type: String,
  link: String,
  read: Boolean,
  readAt: Date,
  metadata: Object,
  createdAt: Date,
  updatedAt: Date
}
```

#### ActivityLogs
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  action: String,
  module: String,
  resource: String,
  resourceId: ObjectId,
  metadata: Object,
  ipAddress: String,
  createdAt: Date
}
```

#### AuditLogs
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  action: String,             // "create", "update", "delete"
  collection: String,
  documentId: ObjectId,
  previous: Object,
  current: Object,
  createdAt: Date
}
```

### 3.2 Supporting Collections

- **Departments** — For HR and expense allocation  
- **LeaveRequests** — Leave management  
- **Attendance** — Clock in/out records  
- **Payroll** — Payslips, salary structure  
- **JobOpenings**, **Candidates** — Recruitment  
- **Campaigns**, **ContentPosts** — Marketing  
- **Bugs**, **Sprints**, **Releases** — Product/Engineering  
- **Articles** — Knowledge base  
- **Comments** — Polymorphic (taskId, ticketId, dealId)  
- **Files** — Polymorphic attachments  
- **SecurityLogs** — Login history, security events  

---

## Step 4: Backend Architecture

### 4.1 Directory Structure

```
apps/api/src/
├── config/
│   ├── db.ts
│   ├── firebase.ts
│   └── resend.ts
├── lib/
│   ├── auth.ts           # Firebase verify, user lookup
│   ├── permissions.ts    # RBAC helpers
│   ├── logger.ts
│   ├── email.ts          # Resend wrapper
│   └── validation.ts     # Zod schemas
├── middlewares/
│   ├── auth.middleware.ts
│   ├── rbac.middleware.ts
│   ├── errorHandler.ts
│   └── auditLog.middleware.ts
├── modules/
│   ├── auth/
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── auth.routes.ts
│   │   ├── auth.validators.ts
│   │   └── user.model.ts
│   ├── hr/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── routes/
│   │   ├── models/
│   │   └── validators/
│   ├── sales/
│   ├── marketing/
│   ├── product/
│   ├── support/
│   ├── finance/
│   ├── operations/
│   ├── legal/
│   └── it/
├── shared/
│   ├── models/           # Comment, File, Notification, ActivityLog
│   ├── services/
│   │   ├── notification.service.ts
│   │   ├── activity.service.ts
│   │   └── file.service.ts
│   └── routes/
├── index.ts
└── app.ts
```

### 4.2 Module Internal Structure (Example: HR)

```
modules/hr/
├── controllers/
│   ├── employee.controller.ts
│   ├── attendance.controller.ts
│   ├── leave.controller.ts
│   ├── payroll.controller.ts
│   └── recruitment.controller.ts
├── services/
│   ├── employee.service.ts
│   ├── attendance.service.ts
│   └── ...
├── routes/
│   ├── employee.routes.ts
│   ├── attendance.routes.ts
│   └── index.ts          # Aggregates all HR routes
├── models/
│   ├── Employee.ts
│   ├── Attendance.ts
│   ├── LeaveRequest.ts
│   └── ...
└── validators/
    ├── employee.validator.ts
    └── ...
```

### 4.3 Request Flow

```
Request → CORS → Rate Limit → Auth (Firebase verify) → RBAC → Route Handler → Service → Model → Response
                ↓
         Error Handler (global)
                ↓
         Audit Log (on write)
```

---

## Step 5: Frontend Architecture

### 5.1 Directory Structure

```
apps/web/src/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   ├── register/
│   │   └── layout.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx        # Sidebar, nav
│   │   ├── dashboard/        # Main dashboard
│   │   ├── hr/
│   │   │   ├── employees/
│   │   │   ├── attendance/
│   │   │   ├── leave/
│   │   │   ├── payroll/
│   │   │   └── recruitment/
│   │   ├── sales/
│   │   │   ├── leads/
│   │   │   ├── clients/
│   │   │   ├── deals/
│   │   │   └── proposals/
│   │   ├── marketing/
│   │   │   ├── campaigns/
│   │   │   └── content-calendar/
│   │   ├── projects/
│   │   │   ├── [id]/
│   │   │   └── tasks/
│   │   ├── support/
│   │   │   ├── tickets/
│   │   │   └── knowledge-base/
│   │   ├── finance/
│   │   │   ├── invoices/
│   │   │   ├── payments/
│   │   │   └── expenses/
│   │   ├── operations/
│   │   │   ├── vendors/
│   │   │   ├── assets/
│   │   │   └── requests/
│   │   ├── legal/
│   │   │   └── contracts/
│   │   └── settings/
│   │       ├── users/
│   │       ├── roles/
│   │       └── security/
│   └── layout.tsx
├── components/
│   ├── ui/                 # shadcn components
│   ├── layout/             # Sidebar, Header
│   ├── dashboard/          # Widget components
│   └── shared/             # Comments, FileUpload, Mentions
├── lib/
│   ├── api.ts
│   ├── firebase.ts
│   ├── permissions.ts      # Frontend RBAC
│   └── utils.ts
├── hooks/
│   ├── useAuth.ts
│   ├── usePermissions.ts
│   └── useNotifications.ts
├── store/
│   ├── auth.ts
│   └── ui.ts
└── types/
    └── index.ts
```

### 5.2 Module Page Structure (Example: Sales)

```
app/(dashboard)/sales/
├── page.tsx                 # Sales overview
├── leads/
│   ├── page.tsx             # Lead list
│   ├── [id]/page.tsx        # Lead detail
│   └── new/page.tsx
├── clients/
├── deals/
└── proposals/
```

---

## Step 6: REST API Endpoints

### 6.1 API Conventions

- **Base URL:** `https://api.voicetunes.os/v1` (or `/api` for simplicity)
- **Auth:** `Authorization: Bearer <Firebase ID Token>`
- **Versioning:** Optional `/v1` prefix
- **Pagination:** `?page=1&limit=20`
- **Filtering:** `?status=active&departmentId=xxx`

### 6.2 Endpoint Summary

| Module | Resource | Endpoints |
|--------|----------|-----------|
| **Auth** | Auth | `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me` |
| **Dashboard** | Dashboard | `GET /dashboard`, `GET /dashboard/widgets/:widgetId` |
| **HR** | Employees | `GET/POST /hr/employees`, `GET/PATCH/DELETE /hr/employees/:id` |
| **HR** | Attendance | `GET/POST /hr/attendance`, `POST /hr/attendance/clock-in`, `POST /hr/attendance/clock-out` |
| **HR** | Leave | `GET/POST /hr/leave`, `PATCH /hr/leave/:id/approve` |
| **HR** | Payroll | `GET /hr/payroll`, `GET /hr/payroll/payslips` |
| **HR** | Recruitment | `GET/POST /hr/jobs`, `GET/POST /hr/candidates` |
| **Sales** | Leads | `GET/POST /sales/leads`, `GET/PATCH/DELETE /sales/leads/:id` |
| **Sales** | Clients | `GET/POST /sales/clients`, `GET/PATCH/DELETE /sales/clients/:id` |
| **Sales** | Deals | `GET/POST /sales/deals`, `GET/PATCH/DELETE /sales/deals/:id` |
| **Sales** | Proposals | `GET/POST /sales/proposals` |
| **Marketing** | Campaigns | `GET/POST /marketing/campaigns` |
| **Marketing** | Content | `GET/POST /marketing/content-calendar` |
| **Product** | Projects | `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id` |
| **Product** | Tasks | `GET/POST /tasks`, `GET/PATCH/DELETE /tasks/:id`, `PATCH /tasks/:id/reorder` |
| **Product** | Bugs | `GET/POST /bugs` |
| **Product** | Sprints | `GET/POST /sprints` |
| **Support** | Tickets | `GET/POST /support/tickets`, `GET/PATCH /support/tickets/:id` |
| **Support** | KB | `GET/POST /support/articles` |
| **Finance** | Invoices | `GET/POST /finance/invoices`, `POST /finance/invoices/:id/send` |
| **Finance** | Payments | `GET/POST /finance/payments` |
| **Finance** | Expenses | `GET/POST /finance/expenses` |
| **Operations** | Vendors | `GET/POST /operations/vendors` |
| **Operations** | Assets | `GET/POST /operations/assets` |
| **Legal** | Contracts | `GET/POST /legal/contracts` |
| **IT** | Users | `GET/POST /it/users`, `GET/PATCH/DELETE /it/users/:id` |
| **IT** | Roles | `GET/POST /it/roles`, `PATCH /it/roles/:id/permissions` |
| **Shared** | Comments | `GET/POST /comments`, `DELETE /comments/:id` |
| **Shared** | Files | `POST /files/upload`, `GET /files/:id` |
| **Shared** | Search | `GET /search?q=...` |
| **Shared** | Notifications | `GET /notifications`, `PATCH /notifications/:id/read` |

---

## Step 7: RBAC Permission System

### 7.1 Multi-Role Model

```
User (Adarsh)
  └── roleIds: [Founder, Admin, Sales Manager, Product Manager]
        │
        ├── Founder    → permissions: [*]
        ├── Admin      → permissions: [users.*, roles.*, ...]
        ├── Sales Mgr  → permissions: [leads.*, clients.*, deals.*]
        └── Product Mgr→ permissions: [projects.*, tasks.*]
```

**Effective permissions** = Union of all permissions from all roles.

### 7.2 Permission Structure

```javascript
// Permission format
{
  module: "sales",
  resource: "lead",
  actions: ["create", "read", "update", "delete"],
  scope: "all" | "department" | "own"
}
```

### 7.3 RBAC Middleware Flow

```
1. Extract Firebase UID from token
2. Lookup User by firebaseUid → get roleIds
3. Lookup Roles by roleIds → get permissionIds
4. Lookup Permissions by permissionIds → build effective permission set
5. Check: Does user have required (module, resource, action)?
6. If scope=own: Filter query by createdBy/assignedTo = userId
7. If scope=department: Filter by departmentId
8. Allow or 403
```

### 7.4 Permission Check Helper

```typescript
// Pseudocode
function hasPermission(user, module, resource, action): boolean {
  const effectivePerms = getEffectivePermissions(user.roleIds);
  return effectivePerms.some(p => 
    p.module === module && 
    p.resource === resource && 
    p.actions.includes(action)
  );
}
```

### 7.5 Default Roles (Seed)

| Role | Permissions |
|------|-------------|
| Founder | All modules, all actions |
| Admin | All except system config |
| Sales Manager | Leads, Clients, Deals, Proposals (full) |
| Product Manager | Projects, Tasks, Bugs, Sprints (full) |
| Developer | Projects (view), Tasks (update own), Bugs (update) |
| Support Agent | Tickets (full), Articles (read) |
| HR Manager | Employees, Attendance, Leave, Payroll (full) |
| Finance | Invoices, Payments, Expenses (full) |

---

## Step 8: Notification System Design

### 8.1 Notification Channels

| Channel | Use Case | Implementation |
|---------|----------|----------------|
| **In-App** | Real-time alerts | MongoDB Notifications collection, WebSocket/polling |
| **Email** | Important events | Resend API |
| **Push** | Future: mobile | Firebase Cloud Messaging |

### 8.2 Notification Triggers

| Trigger | Recipients | In-App | Email |
|---------|------------|--------|-------|
| Task assigned | Assignee | ✓ | ✓ |
| Ticket created | Support team | ✓ | ✓ |
| Deal won | Sales team | ✓ | ✓ |
| Invoice overdue | Finance, Client | ✓ | ✓ |
| Leave request | Manager | ✓ | ✓ |
| @mention in comment | Mentioned user | ✓ | ✓ |
| Approval needed | Approver | ✓ | ✓ |

### 8.3 Notification Service Interface

```typescript
interface NotificationPayload {
  userId: ObjectId;
  title: string;
  body?: string;
  type: string;
  link?: string;
  metadata?: object;
  sendEmail?: boolean;
}

// NotificationService
create(payload): Promise<Notification>
markAsRead(notificationId, userId): Promise<void>
getUnread(userId): Promise<Notification[]>
```

### 8.4 Email Templates (Resend)

- `task-assigned`
- `ticket-created`
- `deal-won`
- `invoice-sent`
- `invoice-overdue`
- `leave-request`
- `mention`
- `approval-required`

---

## Future Integrations (Architecture Hooks)

| Integration | Hook Point | Notes |
|-------------|------------|-------|
| **WhatsApp API** | NotificationService, Support | Add `sendWhatsApp()` alongside `sendEmail()` |
| **Slack** | NotificationService, ActivityLog | Webhook on key events |
| **Payment Gateways** | Finance/Payment service | Stripe/Razorpay adapter |
| **External CRM** | Sales module | Sync service, webhook receiver |
| **AI Assistant** | New `/ai` module | Chat API, context from search |

---

## Appendix: Migration from Current System

If migrating from existing Voice Tunes India codebase:

1. **Auth:** Replace JWT with Firebase Auth — verify ID tokens, store `firebaseUid` in User
2. **Roles:** Migrate from single `role` string to `roleIds` array
3. **Permissions:** Create Permissions and Roles collections, seed default roles
4. **Modules:** Gradually move routes into module structure
5. **Frontend:** Add Firebase SDK, update auth store, add permission checks to nav

---

*Document end. Ready for implementation phase.*
