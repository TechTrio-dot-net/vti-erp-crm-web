# Voice Tunes India — Architecture Documentation

This folder contains the complete system design for **Voice Tunes India**, the agency management platform for Voice Tunes India.

---

## Document Index

| # | Document | Description |
|---|----------|-------------|
| 1 | [01-SYSTEM-ARCHITECTURE.md](./01-SYSTEM-ARCHITECTURE.md) | High-level architecture, components, auth flow, RBAC, Socket.io, email, security |
| 2 | [02-MONGODB-SCHEMA.md](./02-MONGODB-SCHEMA.md) | MongoDB collections, fields, indexes, enums, relationships |
| 3 | [03-FOLDER-STRUCTURE.md](./03-FOLDER-STRUCTURE.md) | Backend (Express) and frontend (Next.js) folder structure |
| 4 | [04-API-ROUTES.md](./04-API-ROUTES.md) | REST API routes, WebSocket events, request/response examples |
| 5 | [05-IMPLEMENTATION-GAPS.md](./05-IMPLEMENTATION-GAPS.md) | Implementation gaps and pending work |
| 6 | [ERP-SYSTEM-BLUEPRINT.md](./ERP-SYSTEM-BLUEPRINT.md) | **Complete ERP architecture** — modules, DB schema, RBAC (multi-role), notifications |
| 7 | [06-ERP-MIGRATION-PLAN.md](./06-ERP-MIGRATION-PLAN.md) | ERP blueprint migration plan and run order |

---

## Deliverable Order (Implementation Sequence)

1. ✅ **System architecture** — Complete
2. ✅ **MongoDB schema** — Complete
3. ✅ **Backend folder structure** — Complete
4. ✅ **API routes** — Complete
5. **Authentication** — JWT, register, login, refresh, password reset
6. **Role permission system** — RBAC middleware
7. **Modules implementation** — Projects, Tasks, Time, Files, Calendar, Ads, Comments, etc.
8. **Resend email integration** — Templates + triggers
9. **Frontend UI** — Dashboard, forms, layouts
10. **Kanban board** — Drag-and-drop tasks
11. **Client portal** — Client-specific views

---

## Tech Stack Summary

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15 (App Router), Tailwind v4, shadcn/ui, Zustand, TanStack Query |
| Backend | Node.js, Express 5, Socket.io 4 |
| Database | MongoDB (Mongoose) |
| Auth | JWT (access + refresh) |
| Email | Resend API |
| File Storage | Cloudinary or AWS S3 |
| Realtime | Socket.io |

---

## Company & Roles

**Founders / Super Admins:** Adarsh Sharma, Dheeraj Sharma, Aditi Parmar  
**Team Members:** Shital Gahiwad, Poojan Prajapati  

**Roles:** SUPER_ADMIN | TEAM_MEMBER | CLIENT

---

*Start implementation only after reviewing all architecture documents.*
