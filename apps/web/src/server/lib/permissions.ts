/**
 * RBAC Permission Matrix
 * Based on department access requirements
 */

export type Role =
  | 'MANAGEMENT'
  | 'SUPER_ADMIN' // Alias for MANAGEMENT (backward compat)
  | 'PROJECT_MANAGER'
  | 'DEVELOPER'
  | 'DESIGNER'
  | 'MARKETING'
  | 'ADS_TEAM'
  | 'SALES'
  | 'SUPPORT'
  | 'HR'
  | 'CLIENT';

export type ProjectPermission = 'full' | 'manage' | 'view' | 'create' | 'none';
export type TaskPermission = 'full' | 'view' | 'update' | 'limited' | 'create' | 'none';
export type ClientPermission = 'full' | 'view' | 'self' | 'none';
export type EmployeePermission = 'full' | 'view' | 'none';
export type MarketingPermission = 'full' | 'view' | 'limited' | 'none';
export type AdsPermission = 'full' | 'view' | 'none';
export type ReportPermission = 'full' | 'project' | 'personal' | 'marketing' | 'ads' | 'sales' | 'support' | 'hr' | 'none';

export interface RolePermissions {
  projects: ProjectPermission;
  tasks: TaskPermission;
  clients: ClientPermission;
  employees: EmployeePermission;
  marketing: MarketingPermission;
  ads: AdsPermission;
  reports: ReportPermission;
}

const COORDINATION: RolePermissions = {
  projects: 'full',
  tasks: 'full',
  clients: 'full',
  employees: 'none',
  marketing: 'none',
  ads: 'none',
  reports: 'project',
};

const PERMISSIONS: Record<string, RolePermissions> = {
  MANAGEMENT: {
    projects: 'full',
    tasks: 'full',
    clients: 'full',
    employees: 'full',
    marketing: 'full',
    ads: 'full',
    reports: 'full',
  },
  SUPER_ADMIN: {
    projects: 'full',
    tasks: 'full',
    clients: 'full',
    employees: 'full',
    marketing: 'full',
    ads: 'full',
    reports: 'full',
  },
  PROJECT_MANAGER: {
    projects: 'manage',
    tasks: 'full',
    clients: 'view',
    employees: 'view',
    marketing: 'view',
    ads: 'view',
    reports: 'project',
  },
  DEVELOPER: {
    projects: 'view',
    tasks: 'update',
    clients: 'none',
    employees: 'none',
    marketing: 'none',
    ads: 'none',
    reports: 'personal',
  },
  DESIGNER: {
    projects: 'view',
    tasks: 'update',
    clients: 'none',
    employees: 'none',
    marketing: 'limited',
    ads: 'none',
    reports: 'personal',
  },
  MARKETING: {
    projects: 'view',
    tasks: 'full',
    clients: 'view',
    employees: 'none',
    marketing: 'full',
    ads: 'view',
    reports: 'marketing',
  },
  ADS_TEAM: {
    projects: 'view',
    tasks: 'full',
    clients: 'none',
    employees: 'none',
    marketing: 'view',
    ads: 'full',
    reports: 'ads',
  },
  SALES: {
    projects: 'create',
    tasks: 'limited',
    clients: 'full',
    employees: 'none',
    marketing: 'none',
    ads: 'none',
    reports: 'sales',
  },
  SUPPORT: {
    projects: 'view',
    tasks: 'create',
    clients: 'view',
    employees: 'none',
    marketing: 'none',
    ads: 'none',
    reports: 'support',
  },
  HR: {
    projects: 'none',
    tasks: 'none',
    clients: 'none',
    employees: 'full',
    marketing: 'none',
    ads: 'none',
    reports: 'hr',
  },
  TEAM_MEMBER: {
    // Legacy role - default to DEVELOPER permissions
    projects: 'view',
    tasks: 'update',
    clients: 'none',
    employees: 'none',
    marketing: 'none',
    ads: 'none',
    reports: 'personal',
  },
  // Coordination: turns won clients into projects and follows production (shoot, edit, post, ads)
  VTI_COORDINATION: COORDINATION,
  COORDINATION,
  CLIENT: {
    projects: 'view',
    tasks: 'view',
    clients: 'self',
    employees: 'none',
    marketing: 'view',
    ads: 'view',
    reports: 'project',
  },
};

export function getPermissions(role: string): RolePermissions {
  return PERMISSIONS[role] || {
    projects: 'none',
    tasks: 'none',
    clients: 'none',
    employees: 'none',
    marketing: 'none',
    ads: 'none',
    reports: 'none',
  };
}

export function canAccessProjects(role: string, action: 'create' | 'read' | 'update' | 'delete' | 'manage'): boolean {
  const p = getPermissions(role).projects;
  if (p === 'none') return false;
  if (p === 'full') return true;
  if (action === 'read' || action === 'manage') return ['manage', 'view', 'create'].includes(p);
  if (action === 'create') return p === 'create';
  if (action === 'update' || action === 'delete') return p === 'manage';
  return false;
}

export function canAccessTasks(role: string, action: 'create' | 'read' | 'update' | 'delete'): boolean {
  const p = getPermissions(role).tasks;
  if (p === 'none') return false;
  if (p === 'full') return true;
  if (action === 'read') return ['view', 'update', 'limited', 'create'].includes(p);
  if (action === 'create') return p === 'create' || p === 'limited';
  if (action === 'update') return p === 'update' || p === 'limited';
  if (action === 'delete') return false;
  return false;
}

export function canAccessClients(role: string, action: 'create' | 'read' | 'update' | 'delete'): boolean {
  const p = getPermissions(role).clients;
  if (p === 'none') return false;
  if (p === 'full') return true;
  if (p === 'self') return action === 'read'; // Clients see only self
  if (p === 'view') return action === 'read';
  return false;
}

export function canAccessEmployees(role: string, action: 'create' | 'read' | 'update' | 'delete'): boolean {
  const p = getPermissions(role).employees;
  if (p === 'none') return false;
  if (p === 'full') return true;
  if (p === 'view') return action === 'read';
  return false;
}

export function canAccessMarketing(role: string, action: 'create' | 'read' | 'update' | 'delete'): boolean {
  const p = getPermissions(role).marketing;
  if (p === 'none') return false;
  if (p === 'full') return true;
  if (p === 'view') return action === 'read';
  if (p === 'limited') return action === 'read' || action === 'update' || action === 'create';
  return false;
}

export function canAccessAds(role: string, action: 'create' | 'read' | 'update' | 'delete'): boolean {
  const p = getPermissions(role).ads;
  if (p === 'none') return false;
  if (p === 'full') return true;
  if (p === 'view') return action === 'read';
  return false;
}

export function canAccessReports(role: string, scope: ReportPermission): boolean {
  const p = getPermissions(role).reports;
  if (p === 'none') return false;
  if (p === 'full') return true;
  return p === scope;
}

export type Resource = 'projects' | 'tasks' | 'clients' | 'employees' | 'marketing' | 'ads' | 'reports';
export type Action = 'create' | 'read' | 'update' | 'delete' | 'manage';

/** ERP Blueprint: module.resource.action format for roleIds-based RBAC */
export type ErpModule = 'dashboard' | 'hr' | 'sales' | 'marketing' | 'product' | 'support' | 'finance' | 'operations' | 'legal' | 'it' | 'reports';

/** Check if effective permissions (from Role/Permission collections) allow action */
export function hasErpPermission(
  effectivePerms: Array<{ module: string; resource: string; actions: string[] }>,
  module: ErpModule,
  resource: string,
  action: string
): boolean {
  return effectivePerms.some(
    (p) => p.module === module && p.resource === resource && p.actions.includes(action)
  );
}

export function hasPermission(role: string, resource: Resource, action: Action, reportScope?: ReportPermission): boolean {
  switch (resource) {
    case 'projects':
      return canAccessProjects(role, action as 'create' | 'read' | 'update' | 'delete' | 'manage');
    case 'tasks':
      return canAccessTasks(role, action as 'create' | 'read' | 'update' | 'delete');
    case 'clients':
      return canAccessClients(role, action as 'create' | 'read' | 'update' | 'delete');
    case 'employees':
      return canAccessEmployees(role, action as 'create' | 'read' | 'update' | 'delete');
    case 'marketing':
      return canAccessMarketing(role, action as 'create' | 'read' | 'update' | 'delete');
    case 'ads':
      return canAccessAds(role, action as 'create' | 'read' | 'update' | 'delete');
    case 'reports':
      return canAccessReports(role, reportScope || 'full');
    default:
      return false;
  }
}
