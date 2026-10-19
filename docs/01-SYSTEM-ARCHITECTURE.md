# Voice Tunes India — System Architecture

## 1. Overview

Voice Tunes India is a production-ready agency management platform for **Voice Tunes India**, designed for internal use with project management, team collaboration, client visibility, content calendar, ad campaign tracking, and automated email notifications.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│  Next.js 15 (App Router)                                                         │
│  • Team Dashboard (Super Admin / Team Members)                                   │
│  • Client Portal (Client Users)                                                  │
│  • Tailwind CSS v4 + shadcn/ui                                                   │
│  • Zustand + TanStack Query v5                                                   │
└────────────────────────────────┬────────────────────────────────────────────────┘
                                 │ HTTPS / WebSocket
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              API GATEWAY LAYER                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│  Node.js + Express 5                                                             │
│  • REST API                                                                      │
│  • JWT Authentication (Access + Refresh)                                         │
│  • Role-Based Access Control (RBAC)                                              │
│  • Rate Limiting                                                                 │
└────────────────────────────────┬────────────────────────────────────────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          ▼                      ▼                      ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│  Socket.io 4     │   │  Resend API      │   │  Cloudinary/     │
│  (Realtime)      │   │  (Email)         │   │  AWS S3         │
│  • Notifications │   │  • Task emails   │   │  (File Storage) │
│  • Live updates  │   │  • Approvals     │   │  • Attachments  │
│  • Activity feed │   │  • Reminders     │   │  • Creatives    │
└─────────────────┘   └─────────────────┘   └─────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER                                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│  MongoDB                                                                          │
│  • Users, Projects, Tasks, TimeEntries                                            │
│  • ContentCalendar, AdCampaigns, Comments, Activities                            │
│  • Files, Notifications                                                           │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js App Router)                         │
├──────────────┬──────────────┬──────────────┬──────────────┬──────────────────┤
│  (auth)      │ (dashboard)  │ (client)     │  Shared      │  API Client      │
│  /login      │ /projects    │ /portal      │  Components  │  (fetch/axios)   │
│  /register   │ /tasks       │ /portal/     │  UI, Forms   │  TanStack Query  │
│  /forgot     │ /calendar    │ projects     │              │                  │
│  /reset      │ /ads         │ /tasks       │              │                  │
└──────────────┴──────────────┴──────────────┴──────────────┴──────────────────┘
                                        │
                                        │ HTTP + WebSocket
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         BACKEND (Express 5)                                    │
├──────────────┬──────────────┬──────────────┬──────────────┬──────────────────┤
│  Auth        │  Middleware  │  Controllers │  Services    │  Socket.io       │
│  JWT verify  │  RBAC       │  CRUD logic  │  Email       │  Notifications   │
│  Refresh     │  Validation │  Validation  │  File upload │  Activity emit   │
└──────────────┴──────────────┴──────────────┴──────────────┴──────────────────┘
                                        │
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         MongoDB (Mongoose ODM)                                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Authentication Flow

```
┌─────────┐     POST /api/auth/login      ┌─────────┐     Verify credentials    ┌─────────┐
│ Client  │ ───────────────────────────► │  API    │ ───────────────────────► │ MongoDB │
└─────────┘                               └─────────┘                           └─────────┘
     │                                          │
     │     Access Token (15min) + Refresh        │
     │     Cookie (7d, httpOnly)                 │
     │ ◄─────────────────────────────────────────┘
     │
     │     All subsequent requests: Authorization: Bearer <accessToken>
     │     If 401: POST /api/auth/refresh → new access token
     ▼
```

---

## 5. Role-Based Access Control (RBAC)

| Role          | Scope                    | Key Permissions                                                                 |
|---------------|--------------------------|----------------------------------------------------------------------------------|
| **SUPER_ADMIN** | Global                   | Full CRUD on all entities, manage users, analytics, ads, calendar, time tracking |
| **TEAM_MEMBER** | Assigned projects only   | View/update tasks, log time, upload files, comment, update status                |
| **CLIENT**      | Own project(s) only      | View progress, tasks, comment, approve/reject deliverables, upload files       |

**Client isolation:** All client API responses are filtered by `project.clientId === req.user.clientId`.

---

## 6. Realtime Architecture (Socket.io)

- **Namespaces:**
  - `/notifications` — per-user notifications
  - `/activity` — project activity feed
  - `/tasks` — task updates (Kanban drag/drop sync)
- **Events:**
  - `notification:new`
  - `activity:new`
  - `task:updated`
  - `comment:new`
  - `approval:requested` / `approval:approved` / `approval:rejected`

---

## 7. Email Automation (Resend)

| Trigger                    | Recipients        | Template              |
|---------------------------|-------------------|------------------------|
| Task assigned             | Assigned user     | task-assigned          |
| Task completed            | Admin, PM         | task-completed         |
| Deadline < 24h            | Assigned user     | deadline-reminder      |
| Deliverable uploaded      | Client            | approval-required      |
| Client approved           | Assigned team     | approval-approved      |
| Client rejected           | Assigned team     | approval-rejected      |

---

## 8. File Storage Flow

```
Upload Request → Multer (memory) → Cloudinary/S3 → Store URL + metadata in MongoDB
```

- **Allowed types:** Images, PDF, Documents, Videos
- **Version history:** Stored as `FileVersion[]` subdocuments on File/Attachment models

---

## 9. Security Considerations

- JWT access tokens: short-lived (15 min)
- Refresh tokens: httpOnly, secure, sameSite cookies
- Password hashing: bcrypt (cost factor 12)
- RBAC enforced on every protected route
- Input validation: Zod/Joi on all request bodies
- Rate limiting: express-rate-limit on auth endpoints
- CORS: whitelist frontend origin only

---

## 10. Deployment Architecture (Reference)

```
                    ┌─────────────┐
                    │   Vercel    │  (Next.js)
                    │   or        │
                    │   VPS       │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   Load      │
                    │   Balancer  │
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
   ┌──────────┐     ┌──────────┐     ┌──────────┐
   │  API 1   │     │  API 2   │     │  Redis   │
   │ (Express)│     │ (Express)│     │ Adapter  │
   └────┬─────┘     └────┬─────┘     └──────────┘
        │                │
        └────────┬───────┘
                 ▼
          ┌─────────────┐
          │   MongoDB   │
          │   Atlas     │
          └─────────────┘
```

---

## 11. Module Dependency Map

```
Auth ──────────────────────────────────────────────────────────────► All Modules
Projects ──► Tasks, TimeTracking, ContentCalendar, AdCampaigns, Files, Comments
Tasks ─────► TimeTracking, Comments, Files, Notifications, Approvals
Files ─────► Tasks, ContentCalendar, Comments
Comments ──► Tasks, Files, Notifications
Notifications ◄── Tasks, Comments, Approvals, TimeTracking
Email (Resend) ◄── Tasks, Approvals, Deadlines
```

---

*Document Version: 1.0 | Voice Tunes India Architecture*
