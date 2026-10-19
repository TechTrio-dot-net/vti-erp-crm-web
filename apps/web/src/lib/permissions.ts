/**
 * Frontend RBAC - mirrors API permission matrix
 */

export type Role =
  | 'SUPER_ADMIN'
  | 'MANAGEMENT'
  | 'PROJECT_MANAGER'
  | 'DEVELOPER'
  | 'DESIGNER'
  | 'MARKETING'
  | 'ADS_TEAM'
  | 'SALES'
  | 'SUPPORT'
  | 'HR'
  | 'TEAM_MEMBER'
  | 'CLIENT'
  | 'VTI_COORDINATION'
  | 'COORDINATION';

const NAV_PERMISSIONS: Record<string, Partial<Record<Role, boolean>>> = {
  '/dashboard': { SUPER_ADMIN: true, MANAGEMENT: true, PROJECT_MANAGER: true, DEVELOPER: true, DESIGNER: true, MARKETING: true, ADS_TEAM: true, SALES: true, SUPPORT: true, HR: true, TEAM_MEMBER: true },
  '/reports': { SUPER_ADMIN: true, MANAGEMENT: true, PROJECT_MANAGER: true, DEVELOPER: true, DESIGNER: true, MARKETING: true, ADS_TEAM: true, SALES: true, SUPPORT: true, HR: true, TEAM_MEMBER: true },
  '/team': { SUPER_ADMIN: true, MANAGEMENT: true, PROJECT_MANAGER: true, DEVELOPER: true, DESIGNER: true, MARKETING: true, ADS_TEAM: true, SUPPORT: true, HR: true, TEAM_MEMBER: true },
  '/notifications': { SUPER_ADMIN: true, MANAGEMENT: true, PROJECT_MANAGER: true, DEVELOPER: true, DESIGNER: true, MARKETING: true, ADS_TEAM: true, SALES: true, SUPPORT: true, HR: true, TEAM_MEMBER: true },
  '/clients': { SUPER_ADMIN: true, MANAGEMENT: true, PROJECT_MANAGER: true, MARKETING: true, SALES: true, SUPPORT: true, VTI_COORDINATION: true, COORDINATION: true },
  '/projects': { SUPER_ADMIN: true, MANAGEMENT: true, PROJECT_MANAGER: true, DEVELOPER: true, DESIGNER: true, MARKETING: true, ADS_TEAM: true, SALES: true, SUPPORT: true, TEAM_MEMBER: true, VTI_COORDINATION: true, COORDINATION: true },
  '/tasks': { SUPER_ADMIN: true, MANAGEMENT: true, PROJECT_MANAGER: true, DEVELOPER: true, DESIGNER: true, MARKETING: true, ADS_TEAM: true, SALES: true, SUPPORT: true, TEAM_MEMBER: true, VTI_COORDINATION: true, COORDINATION: true },
  '/time-tracking': { SUPER_ADMIN: true, MANAGEMENT: true, PROJECT_MANAGER: true, DEVELOPER: true, DESIGNER: true, MARKETING: true, ADS_TEAM: true, SUPPORT: true, TEAM_MEMBER: true, VTI_COORDINATION: true, COORDINATION: true },
  '/content-calendar': { SUPER_ADMIN: true, MANAGEMENT: true, PROJECT_MANAGER: true, MARKETING: true, DESIGNER: true, TEAM_MEMBER: true },
  '/ads': { SUPER_ADMIN: true, MANAGEMENT: true, PROJECT_MANAGER: true, MARKETING: true, ADS_TEAM: true, TEAM_MEMBER: true },
  '/leads': { SUPER_ADMIN: true, MANAGEMENT: true, PROJECT_MANAGER: true, SALES: true },
  '/marketing': { SUPER_ADMIN: true, MANAGEMENT: true, PROJECT_MANAGER: true, MARKETING: true },
  '/users': { SUPER_ADMIN: true, MANAGEMENT: true, HR: true, PROJECT_MANAGER: true },
  '/search': { SUPER_ADMIN: true, MANAGEMENT: true, PROJECT_MANAGER: true, DEVELOPER: true, DESIGNER: true, MARKETING: true, ADS_TEAM: true, SALES: true, SUPPORT: true, HR: true, TEAM_MEMBER: true },
};

/** Where a user lands after signing in: straight into a new quotation (clients go to their portal) */
export function landingPath(role: string): string {
  if (role === "CLIENT") return "/portal";
  return "/quotations/new";
}

/**
 * Home page for someone who can't create quotations. Roles outside the matrix above (custom roles made in
 * Roles & Permissions) have no main dashboard, so they start on the quotation dashboard.
 */
export function homePath(role: string): string {
  if (role === "CLIENT") return "/portal";
  if (role === "VTI_COORDINATION" || role === "COORDINATION") return "/coordination";
  if (role === "SALES") return "/crm";
  return canAccessNav("/dashboard", role) ? "/dashboard" : "/quotation-dashboard";
}

export function canAccessNav(href: string, role: string): boolean {
  const perms = NAV_PERMISSIONS[href];
  if (!perms) return false;
  if (perms[role as Role]) return true;
  return false;
}
