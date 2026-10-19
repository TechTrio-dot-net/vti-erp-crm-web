# ERP Blueprint Migration Plan

**Reference:** [ERP-SYSTEM-BLUEPRINT.md](./ERP-SYSTEM-BLUEPRINT.md)  
**Status:** Phase 1 Complete

---

## Phase 1: Foundation (✅ Done)

### 1.1 Role & Permission Models
- **Permission** model: `module`, `resource`, `actions`, `scope`
- **Role** model: `name`, `slug`, `permissionIds`, `isSystem`
- Seed script: `pnpm --filter @voicetunes/api seed:roles`

### 1.2 User Model Updates
- Added `roleIds: [ObjectId]` for multi-role support
- Kept `role` for backward compatibility

### 1.3 Migration Script
- `pnpm --filter @voicetunes/api migrate:roles` — maps existing users' `role` → `roleIds`

### 1.4 Module Structure
- `apps/api/src/modules/` created
- Auth moved to `modules/auth/auth.routes.ts`
- `modules/index.ts` aggregates all routes

### 1.5 Frontend Nav
- Reorganized to match blueprint: Sales, Product, Marketing, Finance, IT & Access
- Added Invoices to nav

---

## Phase 2: API Path Alignment (Optional)

Blueprint paths vs current:

| Blueprint | Current | Action |
|-----------|---------|--------|
| `/api/auth/*` | `/api/auth/*` | ✅ Same |
| `/api/sales/leads` | `/api/leads` | Add alias or migrate |
| `/api/sales/clients` | `/api/clients` | Add alias or migrate |
| `/api/projects` | `/api/projects` | ✅ Same |
| `/api/support/tickets` | — | New module |
| `/api/finance/invoices` | `/api/invoices` | Add alias or migrate |
| `/api/it/users` | `/api/users` | Add alias or migrate |

---

## Phase 3: New Modules (Pending) (Pending)

| Module | Entities | Status |
|--------|----------|--------|
| **HR** | Employee, Attendance, Leave, Payroll, Recruitment | Not started |
| **Support** | Ticket, Article | Not started |
| **Operations** | Vendor, Asset, Request | Not started |
| **Legal** | Contract | Not started |
| **Finance** | Invoice ✅, Payment, Expense | Invoice exists |

---

## Phase 4: RBAC Migration (Partial) (Partial)

- Legacy `hasPermission(role, resource, action)` still used by existing routes
- New `hasErpPermission(effectivePerms, module, resource, action)` for roleIds-based checks
- New routes should use `requirePermissionByModule(module, resource, action)` when roleIds are populated

---

## Run Order for New Setup

```bash
# 1. Seed base data
pnpm --filter @voicetunes/api seed

# 2. Seed roles and permissions
pnpm --filter @voicetunes/api seed:roles

# 3. Migrate existing users to roleIds
pnpm --filter @voicetunes/api migrate:roles
```

---

*Last updated: March 2025*
