/**
 * Permission slugs for the quotation, catalog and administration modules.
 *
 * Each role in the `roles` table holds a list of these (Admin → Roles & Permissions). Super Admin and
 * Management hold every one implicitly. The older CRM, project and HR screens are still governed by
 * the fixed role matrix in lib/permissions.ts; employees.*, departments.manage and designations.manage
 * extend HR access to roles outside that matrix.
 */

/** slug → [name, module] */
export const PERMISSIONS: Record<string, [string, string]> = {
  'dashboard.view': ['View quotation dashboard', 'dashboard'],

  'quotations.view': ['View own quotations', 'quotations'],
  'quotations.view_all': ['View all quotations', 'quotations'],
  'quotations.create': ['Create quotations', 'quotations'],
  'quotations.update': ['Edit quotations', 'quotations'],
  'quotations.delete': ['Delete quotations', 'quotations'],

  // On the quotations the user can see.
  'payments.record': ['Record and track payments', 'payments'],

  'services.manage': ['Manage services', 'catalog'],
  // Some services reserve the artist choice (video editing); this grants it.
  'artists.assign': ['Choose the artist where a service reserves it', 'catalog'],
  'artists.manage': ['Manage artists and performers', 'catalog'],
  'languages.manage': ['Manage languages', 'catalog'],
  'video_types.manage': ['Manage video types', 'catalog'],
  'durations.manage': ['Manage durations', 'catalog'],
  'pricing.manage': ['Manage pricing rules', 'catalog'],

  'employees.view': ['View employees', 'organization'],
  'employees.manage': ['Manage employees', 'organization'],
  'departments.manage': ['Manage departments', 'organization'],
  'designations.manage': ['Manage designations', 'organization'],

  'users.manage': ['Assign any role, including Super Admin', 'administration'],
  'roles.manage': ['Manage roles and permissions', 'administration'],
  'settings.company': ['Manage company information', 'administration'],
  'settings.quotation': ['Manage quotation and tax settings', 'administration'],

  'reports.view': ['View reports', 'reports'],
  'activity_logs.view': ['View system activity', 'reports'],
};

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

/** Roles that hold every permission, whatever their row says */
export const SUPER_ROLES = ['SUPER_ADMIN', 'MANAGEMENT'];

export const isSuperRole = (role: string | undefined | null): boolean => !!role && SUPER_ROLES.includes(role);

const EMPLOYEE = ['dashboard.view', 'quotations.view', 'quotations.create', 'payments.record'];

/** The built-in roles: slug (= users.role), name, description, permissions granted when the role is first created */
export const SYSTEM_ROLES: [string, string, string, string[]][] = [
  ['SUPER_ADMIN', 'Super Admin', 'Complete control over the system', ALL_PERMISSIONS],
  ['MANAGEMENT', 'Management', 'Complete control over the system', ALL_PERMISSIONS],
  [
    'PROJECT_MANAGER',
    'Project Manager',
    'Projects, team quotations and reports',
    [...EMPLOYEE, 'quotations.view_all', 'quotations.update', 'artists.assign', 'employees.view', 'reports.view'],
  ],
  ['SALES', 'Sales (BDM)', 'Sales CRM and their own quotations', EMPLOYEE],
  [
    'HR',
    'HR',
    'Employee records, departments, designations and salaries',
    ['dashboard.view', 'payments.record', 'employees.view', 'employees.manage', 'departments.manage', 'designations.manage'],
  ],
  ['TEAM_MEMBER', 'Team Member', 'Tasks, time tracking and their own quotations', EMPLOYEE],
  ['DEVELOPER', 'Developer', 'Project tasks and time tracking', []],
  ['DESIGNER', 'Designer', 'Project tasks and content', []],
  ['MARKETING', 'Marketing', 'Marketing and content calendar', []],
  ['ADS_TEAM', 'Ads Team', 'Ad campaigns', []],
  ['SUPPORT', 'Support', 'Client support', []],
  ['CLIENT', 'Client', 'Client portal', []],
];

export const SYSTEM_ROLE_SLUGS = SYSTEM_ROLES.map(([slug]) => slug);
