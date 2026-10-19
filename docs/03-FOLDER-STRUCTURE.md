# Voice Tunes India — Folder Structure

## 1. Monorepo Root

```
Voice Tunes IndiaERP/
├── apps/
│   ├── api/                    # Express backend
│   └── web/                    # Next.js frontend
├── packages/
│   └── shared/                 # Shared types, constants, utils
├── docs/                        # Architecture docs (this folder)
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
└── .env.example
```

---

## 2. Backend (apps/api)

```
apps/api/
├── src/
│   ├── index.ts                # Entry point, Express + Socket.io setup
│   ├── app.ts                  # Express app config (cors, json, routes)
│   │
│   ├── config/
│   │   ├── index.ts            # Env validation, config export
│   │   ├── db.ts               # MongoDB connection
│   │   └── redis.ts            # Redis (optional, for Socket.io scaling)
│   │
│   ├── middleware/
│   │   ├── auth.ts             # JWT verify, attach user to req
│   │   ├── rbac.ts             # Role-based access control
│   │   ├── validate.ts         # Request validation (Zod)
│   │   ├── errorHandler.ts     # Global error handler
│   │   └── rateLimit.ts        # Rate limiting for auth
│   │
│   ├── models/
│   │   ├── User.ts
│   │   ├── Client.ts
│   │   ├── Project.ts
│   │   ├── Task.ts
│   │   ├── TimeEntry.ts
│   │   ├── File.ts
│   │   ├── ContentCalendar.ts
│   │   ├── AdCampaign.ts
│   │   ├── Comment.ts
│   │   ├── Activity.ts
│   │   ├── Notification.ts
│   │   └── EmailLog.ts
│   │
│   ├── routes/
│   │   ├── index.ts            # Route aggregator
│   │   ├── auth.ts             # /api/auth
│   │   ├── users.ts            # /api/users
│   │   ├── clients.ts          # /api/clients
│   │   ├── projects.ts         # /api/projects
│   │   ├── tasks.ts            # /api/tasks
│   │   ├── timeEntries.ts      # /api/time-entries
│   │   ├── files.ts            # /api/files
│   │   ├── contentCalendar.ts  # /api/content-calendar
│   │   ├── adCampaigns.ts      # /api/ad-campaigns
│   │   ├── comments.ts         # /api/comments
│   │   ├── notifications.ts    # /api/notifications
│   │   ├── activities.ts       # /api/activities
│   │   ├── search.ts           # /api/search
│   │   ├── dashboard.ts        # /api/dashboard
│   │   └── reports.ts          # /api/reports
│   │
│   ├── controllers/
│   │   ├── authController.ts
│   │   ├── projectController.ts
│   │   ├── taskController.ts
│   │   ├── timeEntryController.ts
│   │   ├── fileController.ts
│   │   ├── contentCalendarController.ts
│   │   ├── adCampaignController.ts
│   │   ├── commentController.ts
│   │   ├── notificationController.ts
│   │   ├── activityController.ts
│   │   ├── searchController.ts
│   │   ├── dashboardController.ts
│   │   └── reportController.ts
│   │
│   ├── services/
│   │   ├── authService.ts
│   │   ├── emailService.ts     # Resend integration
│   │   ├── fileService.ts      # Cloudinary/S3 upload
│   │   ├── notificationService.ts
│   │   ├── activityService.ts
│   │   └── deadlineReminderService.ts  # Cron/scheduler
│   │
│   ├── socket/
│   │   ├── index.ts            # Socket.io setup
│   │   ├── handlers/
│   │   │   ├── notifications.ts
│   │   │   ├── activity.ts
│   │   │   └── tasks.ts
│   │   └── middleware.ts       # Socket auth
│   │
│   ├── jobs/                   # Background jobs (optional: Bull/BullMQ)
│   │   └── deadlineReminder.ts
│   │
│   ├── utils/
│   │   ├── jwt.ts
│   │   ├── password.ts
│   │   └── pagination.ts
│   │
│   └── types/
│       └── express.d.ts        # Extend Express Request
│
├── emails/                     # Resend HTML templates
│   ├── task-assigned.ts
│   ├── task-completed.ts
│   ├── deadline-reminder.ts
│   ├── approval-required.ts
│   ├── approval-approved.ts
│   └── approval-rejected.ts
│
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 3. Frontend (apps/web)

```
apps/web/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx            # Landing / redirect
│   │   │
│   │   ├── (auth)/             # Auth layout group
│   │   │   ├── layout.tsx
│   │   │   ├── login/
│   │   │   │   └── page.tsx
│   │   │   ├── register/
│   │   │   │   └── page.tsx
│   │   │   ├── forgot-password/
│   │   │   │   └── page.tsx
│   │   │   └── reset-password/
│   │   │       └── page.tsx
│   │   │
│   │   ├── (dashboard)/        # Team dashboard (Super Admin + Team Members)
│   │   │   ├── layout.tsx      # Sidebar, header, auth guard
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx
│   │   │   ├── projects/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── [id]/
│   │   │   │   │   └── page.tsx
│   │   │   │   └── new/
│   │   │   │       └── page.tsx
│   │   │   ├── tasks/
│   │   │   │   └── page.tsx    # Kanban board
│   │   │   ├── time-tracking/
│   │   │   │   └── page.tsx
│   │   │   ├── content-calendar/
│   │   │   │   └── page.tsx
│   │   │   ├── ads/
│   │   │   │   └── page.tsx
│   │   │   ├── files/
│   │   │   │   └── page.tsx
│   │   │   ├── reports/
│   │   │   │   └── page.tsx
│   │   │   ├── team/
│   │   │   │   └── page.tsx    # Workload monitor
│   │   │   ├── users/
│   │   │   │   └── page.tsx
│   │   │   ├── clients/
│   │   │   │   └── page.tsx
│   │   │   ├── search/
│   │   │   │   └── page.tsx
│   │   │   ├── notifications/
│   │   │   │   └── page.tsx
│   │   │   └── settings/
│   │   │       └── page.tsx
│   │   │
│   │   └── (client)/           # Client portal
│   │       ├── layout.tsx      # Client-specific layout
│   │       ├── portal/
│   │       │   ├── page.tsx    # Client dashboard
│   │       │   ├── projects/
│   │       │   │   └── [id]/
│   │       │   │       └── page.tsx
│   │       │   ├── tasks/
│   │       │   │   └── page.tsx
│   │       │   ├── calendar/
│   │       │   │   └── page.tsx
│   │       │   ├── ads/
│   │       │   │   └── page.tsx
│   │       │   └── approvals/
│   │       │       └── page.tsx
│   │       └── ...
│   │
│   ├── components/
│   │   ├── ui/                 # shadcn/ui components
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── select.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── avatar.tsx
│   │   │   ├── calendar.tsx
│   │   │   ├── tabs.tsx
│   │   │   └── ...
│   │   │
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Header.tsx
│   │   │   ├── ClientSidebar.tsx
│   │   │   └── MobileNav.tsx
│   │   │
│   │   ├── dashboard/
│   │   │   ├── StatsCard.tsx
│   │   │   ├── ActiveProjects.tsx
│   │   │   ├── TasksDueToday.tsx
│   │   │   ├── OverdueTasks.tsx
│   │   │   ├── TeamWorkload.tsx
│   │   │   ├── RecentActivity.tsx
│   │   │   └── DeadlineAlerts.tsx
│   │   │
│   │   ├── projects/
│   │   │   ├── ProjectCard.tsx
│   │   │   ├── ProjectForm.tsx
│   │   │   ├── ProjectTimeline.tsx
│   │   │   └── ProjectStatusBadge.tsx
│   │   │
│   │   ├── tasks/
│   │   │   ├── KanbanBoard.tsx
│   │   │   ├── KanbanColumn.tsx
│   │   │   ├── KanbanCard.tsx
│   │   │   ├── TaskForm.tsx
│   │   │   ├── TaskDetail.tsx
│   │   │   └── TaskComments.tsx
│   │   │
│   │   ├── calendar/
│   │   │   ├── ContentCalendar.tsx
│   │   │   ├── CalendarPost.tsx
│   │   │   └── PostForm.tsx
│   │   │
│   │   ├── ads/
│   │   │   ├── AdCampaignCard.tsx
│   │   │   ├── AdPerformanceChart.tsx
│   │   │   └── CampaignForm.tsx
│   │   │
│   │   ├── comments/
│   │   │   ├── CommentThread.tsx
│   │   │   ├── CommentForm.tsx
│   │   │   └── MentionInput.tsx
│   │   │
│   │   ├── approvals/
│   │   │   ├── ApprovalCard.tsx
│   │   │   └── ApprovalActions.tsx
│   │   │
│   │   ├── files/
│   │   │   ├── FileUpload.tsx
│   │   │   ├── FilePreview.tsx
│   │   │   └── VersionHistory.tsx
│   │   │
│   │   ├── search/
│   │   │   └── GlobalSearch.tsx
│   │   │
│   │   ├── notifications/
│   │   │   └── NotificationDropdown.tsx
│   │   │
│   │   └── activity/
│   │       └── ActivityTimeline.tsx
│   │
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── useSocket.ts
│   │   ├── useNotifications.ts
│   │   └── useDebounce.ts
│   │
│   ├── lib/
│   │   ├── api.ts              # API client (fetch/axios)
│   │   ├── socket.ts           # Socket.io client
│   │   ├── utils.ts
│   │   └── constants.ts
│   │
│   ├── store/
│   │   ├── auth.ts             # Zustand auth store
│   │   └── notifications.ts
│   │
│   └── providers/
│       └── providers.tsx       # QueryClient, Auth, Socket
│
├── public/
├── .env.local.example
├── next.config.js
├── package.json
├── tailwind.config.js
└── tsconfig.json
```

---

## 4. Shared Package (packages/shared)

```
packages/shared/
├── src/
│   ├── types/
│   │   ├── user.ts
│   │   ├── project.ts
│   │   ├── task.ts
│   │   ├── api.ts             # API response types
│   │   └── index.ts
│   │
│   ├── constants/
│   │   ├── roles.ts
│   │   ├── enums.ts           # ProjectStatus, TaskStatus, etc.
│   │   └── index.ts
│   │
│   └── utils/
│       └── index.ts
│
├── package.json
└── tsconfig.json
```

---

## 5. Route-to-File Mapping (Quick Reference)

| Route Group   | Path Prefix   | Purpose                    |
|---------------|---------------|----------------------------|
| (auth)        | /login, etc.  | Login, register, reset     |
| (dashboard)   | /dashboard/*  | Team/Admin views           |
| (client)      | /portal/*     | Client-only views          |

---

*Document Version: 1.0 | Voice Tunes India Folder Structure*
