/**
 * Seed Roles and Permissions per ERP Blueprint
 * Run: npx tsx src/scripts/seedRolesPermissions.ts
 */
import '../env';
import { db, pool } from '../db/index';
import { runMigrations } from '../db/migrate';
import { permissions, roles } from '../db/schema';

const PERMISSIONS = [
  // Dashboard
  { module: 'dashboard', resource: 'dashboard', actions: ['read'] },
  // HR
  { module: 'hr', resource: 'employee', actions: ['create', 'read', 'update', 'delete'] },
  { module: 'hr', resource: 'attendance', actions: ['create', 'read', 'update', 'delete'] },
  { module: 'hr', resource: 'leave', actions: ['create', 'read', 'update', 'delete', 'approve'] },
  { module: 'hr', resource: 'payroll', actions: ['create', 'read', 'update', 'delete'] },
  { module: 'hr', resource: 'recruitment', actions: ['create', 'read', 'update', 'delete'] },
  // Sales
  { module: 'sales', resource: 'lead', actions: ['create', 'read', 'update', 'delete'] },
  { module: 'sales', resource: 'client', actions: ['create', 'read', 'update', 'delete'] },
  { module: 'sales', resource: 'deal', actions: ['create', 'read', 'update', 'delete'] },
  { module: 'sales', resource: 'proposal', actions: ['create', 'read', 'update', 'delete'] },
  // Marketing
  { module: 'marketing', resource: 'campaign', actions: ['create', 'read', 'update', 'delete'] },
  { module: 'marketing', resource: 'content', actions: ['create', 'read', 'update', 'delete'] },
  // Product
  { module: 'product', resource: 'project', actions: ['create', 'read', 'update', 'delete', 'manage'] },
  { module: 'product', resource: 'task', actions: ['create', 'read', 'update', 'delete'] },
  { module: 'product', resource: 'bug', actions: ['create', 'read', 'update', 'delete'] },
  { module: 'product', resource: 'sprint', actions: ['create', 'read', 'update', 'delete'] },
  // Support
  { module: 'support', resource: 'ticket', actions: ['create', 'read', 'update', 'delete'] },
  { module: 'support', resource: 'article', actions: ['create', 'read', 'update', 'delete'] },
  // Finance
  { module: 'finance', resource: 'invoice', actions: ['create', 'read', 'update', 'delete'] },
  { module: 'finance', resource: 'payment', actions: ['create', 'read', 'update', 'delete'] },
  { module: 'finance', resource: 'expense', actions: ['create', 'read', 'update', 'delete'] },
  // Operations
  { module: 'operations', resource: 'vendor', actions: ['create', 'read', 'update', 'delete'] },
  { module: 'operations', resource: 'asset', actions: ['create', 'read', 'update', 'delete'] },
  { module: 'operations', resource: 'request', actions: ['create', 'read', 'update', 'delete'] },
  // Legal
  { module: 'legal', resource: 'contract', actions: ['create', 'read', 'update', 'delete'] },
  // IT
  { module: 'it', resource: 'user', actions: ['create', 'read', 'update', 'delete'] },
  { module: 'it', resource: 'role', actions: ['create', 'read', 'update', 'delete'] },
  { module: 'it', resource: 'permission', actions: ['read'] },
  // Reports
  { module: 'reports', resource: 'report', actions: ['read'] },
];

const ROLES = [
  {
    name: 'Founder',
    slug: 'founder',
    description: 'Full access to all modules',
    isSystem: true,
    permissionSlugs: ['*'], // All
  },
  {
    name: 'Admin',
    slug: 'admin',
    description: 'All except system config',
    isSystem: true,
    permissionSlugs: ['dashboard', 'hr', 'sales', 'marketing', 'product', 'support', 'finance', 'operations', 'legal', 'it', 'reports'],
  },
  {
    name: 'Sales Manager',
    slug: 'sales-manager',
    description: 'Leads, Clients, Deals, Proposals',
    isSystem: true,
    permissionSlugs: ['sales', 'dashboard'],
  },
  {
    name: 'Product Manager',
    slug: 'product-manager',
    description: 'Projects, Tasks, Bugs, Sprints',
    isSystem: true,
    permissionSlugs: ['product', 'dashboard'],
  },
  {
    name: 'Developer',
    slug: 'developer',
    description: 'Projects (view), Tasks (update), Bugs (update)',
    isSystem: true,
    permissionSlugs: ['product'],
  },
  {
    name: 'Support Agent',
    slug: 'support-agent',
    description: 'Tickets, Articles',
    isSystem: true,
    permissionSlugs: ['support'],
  },
  {
    name: 'HR Manager',
    slug: 'hr-manager',
    description: 'Employees, Attendance, Leave, Payroll',
    isSystem: true,
    permissionSlugs: ['hr', 'dashboard'],
  },
  {
    name: 'Finance',
    slug: 'finance',
    description: 'Invoices, Payments, Expenses',
    isSystem: true,
    permissionSlugs: ['finance', 'dashboard'],
  },
  {
    name: 'Client',
    slug: 'client',
    description: 'Portal access only',
    isSystem: true,
    permissionSlugs: ['product'], // Limited: own projects/tasks
  },
  // Legacy roles (map to old enum for migration)
  { name: 'Super Admin', slug: 'super-admin', description: 'Legacy: full access', isSystem: true, permissionSlugs: ['*'] },
  { name: 'Management', slug: 'management', description: 'Legacy: full access', isSystem: true, permissionSlugs: ['*'] },
  { name: 'Designer', slug: 'designer', description: 'Design and marketing', isSystem: true, permissionSlugs: ['product', 'marketing', 'dashboard'] },
  { name: 'Marketing', slug: 'marketing', description: 'Marketing and content', isSystem: true, permissionSlugs: ['marketing', 'product', 'dashboard'] },
  { name: 'Ads Team', slug: 'ads-team', description: 'Ad campaigns', isSystem: true, permissionSlugs: ['marketing', 'product', 'dashboard'] },
  { name: 'Sales', slug: 'sales', description: 'Sales team', isSystem: true, permissionSlugs: ['sales', 'dashboard'] },
  { name: 'Team Member', slug: 'team-member', description: 'Legacy: developer-like', isSystem: true, permissionSlugs: ['product', 'dashboard'] },
];

async function seed() {
  await runMigrations();
  console.log('Connected to PostgreSQL');

  // --- Permissions (upsert keeps ids stable across runs) ---
  const permRows = await db
    .insert(permissions)
    .values(PERMISSIONS)
    .onConflictDoUpdate({ target: [permissions.module, permissions.resource], set: { updatedAt: new Date() } })
    .returning({ id: permissions.id, module: permissions.module, resource: permissions.resource });
  const permMap = new Map(permRows.map((p) => [`${p.module}:${p.resource}`, p.id]));
  console.log(`Permissions ready: ${permRows.length}`);

  // --- Roles ---
  const allPermIds = Array.from(permMap.values());
  for (const r of ROLES) {
    const permissionIds = r.permissionSlugs.includes('*')
      ? allPermIds
      : PERMISSIONS.filter((p) => r.permissionSlugs.includes(p.module))
          .map((p) => permMap.get(`${p.module}:${p.resource}`)!)
          .filter(Boolean);

    const [created] = await db
      .insert(roles)
      .values({ name: r.name, slug: r.slug, description: r.description, permissionIds, isSystem: r.isSystem })
      .onConflictDoNothing({ target: roles.slug })
      .returning({ id: roles.id });
    console.log(created ? `Created role: ${r.slug}` : `Role ${r.slug} already exists, skipping`);
  }

  console.log('Roles & Permissions seed complete');
}

seed()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
