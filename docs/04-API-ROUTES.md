# Voice Tunes India — API Routes Specification

## 1. Base URL & Conventions

- **Base:** `http://localhost:5000/api` (or `process.env.API_URL`)
- **Auth:** `Authorization: Bearer <accessToken>` for protected routes
- **Response:** JSON. Success: `{ data, message? }`. Error: `{ error, statusCode }`
- **Pagination:** `?page=1&limit=20&sort=-createdAt`

---

## 2. Authentication (`/api/auth`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/register` | No | Register new user |
| POST | `/login` | No | Login, returns access token + sets refresh cookie |
| POST | `/logout` | Yes | Invalidate refresh token |
| POST | `/refresh` | Cookie | Get new access token |
| POST | `/forgot-password` | No | Send reset email |
| POST | `/reset-password` | No | Reset with token |
| GET | `/me` | Yes | Current user profile |

---

## 3. Users (`/api/users`)

**RBAC:** SUPER_ADMIN only (create/update/delete). Team can list.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/` | Yes | List users (paginated, filter by role) |
| GET | `/:id` | Yes | Get user by ID |
| POST | `/` | Yes | Create user (Super Admin) |
| PATCH | `/:id` | Yes | Update user |
| DELETE | `/:id` | Yes | Deactivate user (Super Admin) |
| GET | `/:id/workload` | Yes | Task count per user (workload monitor) |

---

## 4. Clients (`/api/clients`)

**RBAC:** SUPER_ADMIN, TEAM_MEMBER (read). Clients see only self.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/` | Yes | List clients |
| GET | `/:id` | Yes | Get client |
| POST | `/` | Yes | Create client |
| PATCH | `/:id` | Yes | Update client |
| DELETE | `/:id` | Yes | Delete client |

---

## 5. Projects (`/api/projects`)

**RBAC:** SUPER_ADMIN full. TEAM_MEMBER: assigned only. CLIENT: own projects only.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/` | Yes | List projects (filter: status, clientId) |
| GET | `/:id` | Yes | Get project with tasks, team |
| POST | `/` | Yes | Create project |
| PATCH | `/:id` | Yes | Update project |
| DELETE | `/:id` | Yes | Delete project |
| GET | `/:id/timeline` | Yes | Project timeline view |
| GET | `/:id/activity` | Yes | Activity feed for project |

---

## 6. Tasks (`/api/tasks`)

**RBAC:** By project access. Clients: view + comment + approve/reject.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/` | Yes | List tasks (filter: projectId, status, assignedTo, priority) |
| GET | `/:id` | Yes | Get task with comments, attachments |
| POST | `/` | Yes | Create task |
| PATCH | `/:id` | Yes | Update task (status, assignee, etc.) |
| PATCH | `/:id/reorder` | Yes | Update position (Kanban) |
| DELETE | `/:id` | Yes | Delete task |
| POST | `/:id/approve` | Yes | Client approve deliverable |
| POST | `/:id/reject` | Yes | Client reject deliverable |
| GET | `/:id/comments` | Yes | Get task comments |

---

## 7. Time Entries (`/api/time-entries`)

**RBAC:** TEAM_MEMBER own entries. SUPER_ADMIN all.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/` | Yes | List (filter: userId, taskId, projectId, dateRange) |
| GET | `/:id` | Yes | Get entry |
| POST | `/` | Yes | Create (manual) |
| POST | `/start` | Yes | Start timer |
| POST | `/stop` | Yes | Stop timer |
| PATCH | `/:id` | Yes | Update entry |
| DELETE | `/:id` | Yes | Delete entry |
| GET | `/reports/user/:userId` | Yes | Report by user |
| GET | `/reports/project/:projectId` | Yes | Report by project |

---

## 8. Files (`/api/files`)

**RBAC:** By project. Clients: own project files only.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/` | Yes | List (filter: projectId, taskId) |
| GET | `/:id` | Yes | Get file metadata |
| GET | `/:id/versions` | Yes | Version history |
| POST | `/upload` | Yes | Upload (multipart) |
| DELETE | `/:id` | Yes | Delete file |

---

## 9. Content Calendar (`/api/content-calendar`)

**RBAC:** By project. Clients: view + approve.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/` | Yes | List (filter: projectId, dateRange, platform, status) |
| GET | `/:id` | Yes | Get post |
| POST | `/` | Yes | Create post |
| PATCH | `/:id` | Yes | Update post |
| PATCH | `/:id/reorder` | Yes | Drag-drop reorder |
| DELETE | `/:id` | Yes | Delete post |
| POST | `/:id/approve` | Yes | Client approve |
| POST | `/:id/reject` | Yes | Client reject |

---

## 10. Ad Campaigns (`/api/ad-campaigns`)

**RBAC:** By project. Clients: view only.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/` | Yes | List (filter: projectId, platform, status) |
| GET | `/:id` | Yes | Get campaign |
| POST | `/` | Yes | Create campaign |
| PATCH | `/:id` | Yes | Update campaign (incl. metrics) |
| DELETE | `/:id` | Yes | Delete campaign |
| GET | `/dashboard` | Yes | Aggregated performance |

---

## 11. Comments (`/api/comments`)

**RBAC:** By project. Internal vs client visibility via `isInternal`.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/` | Yes | List (query: entityType, entityId) |
| GET | `/:id` | Yes | Get comment with replies |
| POST | `/` | Yes | Create comment |
| PATCH | `/:id` | Yes | Update comment |
| DELETE | `/:id` | Yes | Delete comment |

---

## 12. Notifications (`/api/notifications`)

**RBAC:** Own notifications only.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/` | Yes | List (paginated, unread first) |
| PATCH | `/:id/read` | Yes | Mark as read |
| PATCH | `/read-all` | Yes | Mark all read |
| DELETE | `/:id` | Yes | Delete notification |

---

## 13. Activities (`/api/activities`)

**RBAC:** By project access.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/` | Yes | List (query: projectId, limit) |

---

## 14. Search (`/api/search`)

**RBAC:** By role. Clients: own project scope only.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/` | Yes | Global search. Query: `q`, `project`, `status`, `deadline`, `priority`, `assignedTo` |

**Search scope:** projects, tasks, files, clients.

---

## 15. Dashboard (`/api/dashboard`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/team` | Yes | Team dashboard: active projects, tasks due today, overdue, workload, activity, time tracked |
| GET | `/client` | Yes | Client dashboard: project progress, tasks, calendar, ads, pending approvals |

---

## 16. Reports (`/api/reports`)

**RBAC:** SUPER_ADMIN, TEAM_MEMBER (own scope).

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/project-progress` | Yes | Project progress report |
| GET | `/team-productivity` | Yes | Team productivity report |
| GET | `/time-tracking` | Yes | Time tracking report (filters: userId, projectId, dateRange) |

---

## 17. Health & Misc

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | No | `{ status, db: 'MongoDB' }` |

---

## 18. WebSocket Events (Socket.io)

### Namespace: `/notifications`

| Event | Direction | Payload |
|-------|-----------|---------|
| `notification:new` | Server → Client | `{ notification }` |

### Namespace: `/activity`

| Event | Direction | Payload |
|-------|-----------|---------|
| `activity:new` | Server → Client | `{ activity }` |

### Namespace: `/tasks`

| Event | Direction | Payload |
|-------|-----------|---------|
| `task:updated` | Server → Client | `{ task }` |
| `task:reorder` | Client → Server | `{ taskId, status, position }` |

---

## 19. Request/Response Examples

### POST /api/auth/login

**Request:**
```json
{ "email": "adarsh@voicetunesindia.com", "password": "admin123" }
```

**Response:**
```json
{
  "data": {
    "user": { "id", "email", "name", "role" },
    "accessToken": "eyJ..."
  }
}
```
+ Set-Cookie: `refreshToken=...; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`

### GET /api/projects

**Query:** `?status=ACTIVE&page=1&limit=10`

**Response:**
```json
{
  "data": {
    "items": [...],
    "total": 25,
    "page": 1,
    "limit": 10
  }
}
```

### PATCH /api/tasks/:id

**Request:**
```json
{ "status": "IN_PROGRESS", "assignedTo": "userId" }
```

---

*Document Version: 1.0 | Voice Tunes India API Routes*
