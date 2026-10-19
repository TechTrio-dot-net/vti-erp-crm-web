"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth";
import { BrandMark } from "@/components/BrandLogo";
import { canAccessNav } from "@/lib/permissions";
import { COORDINATION_ROLES, CRM_ADMIN_ROLES, CRM_ROLES, HR_ROLES } from "@/lib/crm";
import { api } from "@/lib/api";
import { useRealtime, type LiveNotification } from "@/lib/realtime";
import { useMe } from "@/lib/erp/me";
import { CrmTopBar } from "@/components/crm/CrmTopBar";
import { LeadDrawer } from "@/components/crm/LeadDrawer";
import { AddInquiryDialog } from "@/components/crm/AddInquiryDialog";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, BarChart3, Users, Bell, Target, Building2,
  FolderKanban, CheckSquare, Clock, Calendar, TrendingUp,
  Megaphone, UserCog, LogOut, Search, Menu, X,
  ChevronDown, Headset, ShieldCheck, Database, Briefcase, Settings2, Table2,
  FileSignature, IndianRupee, Layers, Mic, Star, Tag, Globe, Film, Timer,
  Shield, SlidersHorizontal, Activity, KeyRound, PieChart, Sparkles,
} from "lucide-react";

type Permission = string | string[];
type NavItem = { href: string; label: string; icon?: React.ComponentType<{ className?: string }>; roles?: string[]; permission?: Permission };
type NavGroup = { section: string; icon: React.ComponentType<{ className?: string }>; roles?: string[]; items: NavItem[] };

/** Coordination sees only some CRM pages, all under CRM; the rest stay with the CRM roles */
const CRM_AND_COORDINATION = [...CRM_ROLES, ...COORDINATION_ROLES];

const NAV: NavGroup[] = [
  { section: "Overview", icon: LayoutDashboard, items: [
    // Coordination's own dashboard, in place of the main one
    { href: "/coordination",  label: "Dashboard",     icon: LayoutDashboard, roles: COORDINATION_ROLES },
    { href: "/dashboard",     label: "Dashboard",     icon: LayoutDashboard },
    { href: "/assistant",     label: "AI Assistant",  icon: Sparkles, roles: ["SUPER_ADMIN"] },
    { href: "/reports",       label: "Reports",       icon: BarChart3 },
    { href: "/team",          label: "Team Workload", icon: Users },
    { href: "/search",        label: "Search",        icon: Search },
    { href: "/notifications", label: "Notifications", icon: Bell },
  ]},
  { section: "Quotations", icon: FileSignature, items: [
    { href: "/quotation-dashboard", label: "Quotation Dashboard", icon: PieChart,      permission: "dashboard.view" },
    { href: "/quotations",          label: "Quotations",          icon: FileSignature, permission: ["quotations.view", "quotations.view_all"] },
    { href: "/payments",            label: "Payments",            icon: IndianRupee,   permission: "payments.record" },
  ]},
  { section: "CRM", icon: Headset, roles: CRM_AND_COORDINATION, items: [
    { href: "/crm",                     label: "Dashboard",                 roles: CRM_ROLES },
    { href: "/crm/leads",               label: "My Leads",                  roles: CRM_ROLES },
    { href: "/crm/calls",               label: "Call Log",                  roles: CRM_ROLES },
    { href: "/crm/leaderboard",         label: "Leader Dashboard",          roles: CRM_ROLES },
    { href: "/crm/followups-datewise",  label: "Followup Date Wise Report", roles: CRM_ROLES },
    { href: "/crm/followups",           label: "Followup Report",           roles: CRM_ROLES },
    { href: "/crm/followup-pivot",      label: "Followup Pivot Report",     roles: CRM_ROLES },
    { href: "/crm/closed",              label: "Closed Lead Report" },
    { href: "/crm/transfer",            label: "Lead Transfer & Leave",     roles: CRM_ADMIN_ROLES },
    { href: "/crm/filter",              label: "Lead Filter",               roles: CRM_ROLES },
    { href: "/crm/bdm-time",            label: "BDM Time Analysis" },
    // CRM admin reports coordination may read; admins find them under CRM Admin
    { href: "/crm-admin/lost",          label: "Lost Leads Report",         roles: [...COORDINATION_ROLES, "SALES"] },
    { href: "/crm-admin/targets",       label: "Weekly Target Summary",     roles: COORDINATION_ROLES },
  ]},
  { section: "CRM Admin", icon: ShieldCheck, roles: CRM_ADMIN_ROLES, items: [
    { href: "/crm-admin/lead-summary",   label: "Lead Weekly Summary",            roles: CRM_ADMIN_ROLES },
    { href: "/crm-admin/source-summary", label: "Source Weekly Summary",          roles: CRM_ADMIN_ROLES },
    { href: "/crm-admin/lost",           label: "Lost Leads Report" },
    { href: "/crm-admin/lost-analysis",  label: "Lost Leads Analysis",            roles: CRM_ADMIN_ROLES },
    { href: "/crm-admin/actual-vs-fb",   label: "Actual Leads Vs FB Leads",       roles: CRM_ADMIN_ROLES },
    { href: "/crm-admin/integrations",   label: "Google Sheet & Meta",            roles: CRM_ADMIN_ROLES },
    { href: "/crm-admin/communication",  label: "Communication & Calls",          roles: CRM_ADMIN_ROLES },
    { href: "/crm-admin/imports",        label: "Real Time Lead Data",            roles: CRM_ADMIN_ROLES },
    { href: "/crm-admin/verify",         label: "Verify Data (Lead)",             roles: CRM_ADMIN_ROLES },
    { href: "/crm-admin/bdm-status",     label: "BDM & Status Data",              roles: CRM_ADMIN_ROLES },
    { href: "/crm-admin/targets",        label: "Weekly Target Summary" },
    { href: "/crm-admin/whatsapp",       label: "WhatsApp Message Log",           roles: CRM_ADMIN_ROLES },
    { href: "/crm-admin/old-crm",        label: "Old CRM Archive",                roles: CRM_ADMIN_ROLES },
    { href: "/crm-admin/campaigns",      label: "Campaign Lead - BDM Adjustment", roles: CRM_ADMIN_ROLES },
  ]},
  { section: "Masters", icon: Database, roles: CRM_ADMIN_ROLES, items: [
    { href: "/masters/bdm",      label: "BDM Master" },
  ]},
  { section: "Catalog & Pricing", icon: Layers, items: [
    { href: "/catalog/services",      label: "Services",      icon: Layers, permission: "services.manage" },
    { href: "/catalog/artists",       label: "Artists",       icon: Mic,    permission: "artists.manage" },
    { href: "/catalog/performers",    label: "Performers",    icon: Star,   permission: "artists.manage" },
    { href: "/catalog/pricing-rules", label: "Pricing Rules", icon: Tag,    permission: "pricing.manage" },
    { href: "/catalog/languages",     label: "Languages",     icon: Globe,  permission: "languages.manage" },
    { href: "/catalog/video-types",   label: "Video Types",   icon: Film,   permission: "video_types.manage" },
    { href: "/catalog/durations",     label: "Durations",     icon: Timer,  permission: "durations.manage" },
  ]},
  { section: "Sales", icon: Target, items: [
    { href: "/clients", label: "Clients",       icon: Building2 },
  ]},
  { section: "Product", icon: FolderKanban, items: [
    { href: "/projects",      label: "Projects",      icon: FolderKanban },
    { href: "/tasks",         label: "Tasks",         icon: CheckSquare },
    { href: "/time-tracking", label: "Time Tracking", icon: Clock },
  ]},
  { section: "Marketing", icon: Megaphone, items: [
    { href: "/content-calendar", label: "Content Calendar", icon: Calendar },
    { href: "/ads",              label: "Ads Tracking",     icon: TrendingUp },
    { href: "/marketing",        label: "Marketing",        icon: Megaphone },
  ]},
  { section: "HR Department", icon: Briefcase, items: [
    { href: "/hr/divisions",    label: "Division",         roles: HR_ROLES },
    { href: "/hr/departments",  label: "Department",       roles: HR_ROLES, permission: "departments.manage" },
    { href: "/hr/designations", label: "Designation",      roles: HR_ROLES, permission: "designations.manage" },
    { href: "/hr/employees",    label: "Employee Details", roles: HR_ROLES, permission: "employees.view" },
    { href: "/hr/salaries",     label: "Monthly Salary",   roles: HR_ROLES },
  ]},
  { section: "Configuration", icon: Settings2, items: [
    { href: "/config/categories",     label: "Main Category Master", roles: CRM_ADMIN_ROLES },
    { href: "/config/sub-categories", label: "Sub Category Master",  roles: CRM_ADMIN_ROLES },
    { href: "/config/download-db",    label: "Download DB",          roles: CRM_ADMIN_ROLES },
    { href: "/users",                 label: "User Master",          icon: UserCog },
    { href: "/admin/roles",           label: "Roles & Permissions",  icon: Shield,            permission: "roles.manage" },
    { href: "/admin/settings",        label: "Company Settings",     icon: SlidersHorizontal, permission: ["settings.company", "settings.quotation"] },
    { href: "/admin/activity-logs",   label: "Activity Log",         icon: Activity,          permission: "activity_logs.view" },
  ]},
];

const ROLE_BADGE: Record<string, string> = {
  SUPER_ADMIN:     "bg-primary text-primary-foreground",
  MANAGEMENT:      "bg-primary text-primary-foreground",
  PROJECT_MANAGER: "bg-emerald-400/20 text-emerald-300",
  SALES:           "bg-amber-400/20 text-amber-300",
};

function playNotificationBeep() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const gainNode = ctx.createGain();
    gainNode.connect(ctx.destination);
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    const osc = ctx.createOscillator();
    osc.connect(gainNode);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.12);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => ctx.close();
  } catch { /* noop */ }
}

const isActive = (pathname: string, href: string) =>
  pathname === href || (href !== "/crm" && pathname.startsWith(href + "/"));

/**
 * An item with `roles` or `permission` shows when the user's role is listed or their role grants the
 * permission (Admin → Roles & Permissions); other items follow the role matrix in lib/permissions.
 */
function visibleGroups(role: string, can: (permission: Permission) => boolean): NavGroup[] {
  const itemVisible = (i: NavItem, groupRoles?: string[]) => {
    if (i.roles || i.permission) return (!!i.roles && i.roles.includes(role)) || (!!i.permission && can(i.permission));
    return groupRoles ? true : canAccessNav(i.href, role);
  };
  return NAV.map((g) => ({
    ...g,
    items: g.roles && !g.roles.includes(role) ? [] : g.items.filter((i) => itemVisible(i, g.roles)),
  })).filter((g) => g.items.length > 0);
}

function Sidebar({ role, can, pathname, unreadCount, onSignOut, onClose }: {
  role: string;
  can: (permission: Permission) => boolean;
  pathname: string;
  unreadCount: number;
  onSignOut: () => void;
  onClose?: () => void;
}) {
  const groups = visibleGroups(role, can);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const active = groups.find((g) => g.items.some((i) => isActive(pathname, i.href)));
    return new Set(["Overview", active?.section].filter(Boolean) as string[]);
  });
  const toggle = (section: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section); else next.add(section);
      return next;
    });

  return (
    <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
      {groups.map(({ section, icon: GroupIcon, items }) => {
        const open = openGroups.has(section);
        const hasActive = items.some((i) => isActive(pathname, i.href));
        return (
          <div key={section}>
            <button
              type="button"
              onClick={() => toggle(section)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-bold uppercase tracking-wider transition-colors ${hasActive ? "text-white" : ""}`}
              style={{ color: hasActive ? undefined : "var(--sb-muted)" }}
              aria-expanded={open}
            >
              <GroupIcon className="size-3.5 shrink-0" />
              <span className="flex-1 text-left">{section}</span>
              <ChevronDown className={`size-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
            </button>
            {open && (
              <div className="space-y-0.5 mt-0.5 mb-2">
                {items.map((item) => {
                  const Icon = item.icon ?? Table2;
                  const isNotif = item.href === "/notifications";
                  return (
                    <Link key={item.href} href={item.href} onClick={onClose} className={`sidebar-item ${isActive(pathname, item.href) ? "active" : ""}`}>
                      <Icon className="size-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                      {isNotif && unreadCount > 0 && (
                        <span className="notif-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div className="pt-2 space-y-0.5" style={{ borderTop: "1px solid var(--sb-border)" }}>
        <Link href="/account/password" onClick={onClose} className={`sidebar-item ${isActive(pathname, "/account/password") ? "active" : ""}`}>
          <KeyRound className="size-4 shrink-0" />
          Change password
        </Link>
        <button onClick={onSignOut} className="sidebar-item w-full">
          <LogOut className="size-4 shrink-0" />
          Sign out
        </button>
      </div>
    </nav>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, logout, token, _hasHydrated } = useAuthStore();
  const router      = useRouter();
  const pathname    = usePathname()!;
  const queryClient = useQueryClient();
  const unreadRef   = useRef(0);
  const origTitleRef = useRef("Voice Tunes India");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const me = useMe();

  const { data: notifData } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<Array<{ read: boolean }>>("/notifications"),
    enabled: !!token,
    staleTime: 60_000,
    select: (d) => d.filter((n) => !n.read).length,
  });
  const unreadCount = notifData ?? 0;

  // Auth guard
  useEffect(() => {
    if (!_hasHydrated) return;
    if (!user) { router.push("/login"); return; }
    if (user.role === "CLIENT") router.push("/portal");
  }, [user, _hasHydrated, router]);

  // Reset tab title on focus
  useEffect(() => {
    const onFocus = () => { unreadRef.current = 0; document.title = origTitleRef.current; };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Notification handler — new leads also refresh CRM lists
  const handleNewNotification = useCallback((notif: LiveNotification) => {
    playNotificationBeep();
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    if (notif?.type === "lead-assigned") queryClient.invalidateQueries({ queryKey: ["crm"] });
    if (!document.hasFocus()) {
      unreadRef.current += 1;
      document.title = notif?.title
        ? `(${unreadRef.current}) ${notif.title.slice(0, 30)} — Voice Tunes India`
        : `(${unreadRef.current}) New notification — Voice Tunes India`;
    }
  }, [queryClient]);

  // Live notifications, plus task boards and CRM lists refreshing when something changes elsewhere
  useRealtime(!!token && _hasHydrated, handleNewNotification);

  if (!_hasHydrated || !user) return null;

  const roleBadge = ROLE_BADGE[user.role] || "bg-slate-400/20 text-slate-300";
  const roleLabel = user.role === "SALES" ? "BDM" : (me.user?.role?.name ?? user.role.replace(/_/g, " "));
  const signOut = () => { logout(); queryClient.clear(); router.push("/login"); };
  const isCrm = CRM_ROLES.includes(user.role);
  // Everywhere except the form itself
  const showCreateQuotation = me.can("quotations.create") && !pathname.startsWith("/quotations/new");

  const brand = (
    <div className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid var(--sb-border)" }}>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <BrandMark size={32} />
          <span className="font-bold text-white text-[15px] tracking-tight">Voice Tunes India</span>
        </div>
        <button
          onClick={() => setSidebarOpen(false)}
          className="lg:hidden size-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Close menu"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex items-center gap-3">
        <div
          className="size-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
          style={{ background: "var(--brand-yellow)", color: "var(--brand-black)" }}
        >
          {user.initials || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate leading-tight">{user.name?.split(" ")[0]}</p>
          <span className={`inline-flex text-[10px] font-bold px-1.5 py-0.5 rounded-full mt-0.5 capitalize ${roleBadge}`}>
            {roleLabel}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden print:block print:h-auto print:overflow-visible" style={{ background: "var(--background)" }}>
      {/* Desktop sidebar */}
      <aside
        className="no-print hidden lg:flex w-[240px] shrink-0 flex-col h-screen sticky top-0"
        style={{ background: "var(--sb-bg)", borderRight: "1px solid var(--sb-border)" }}
      >
        {brand}
        <Sidebar key={user.role} role={user.role} can={me.can} pathname={pathname} unreadCount={unreadCount} onSignOut={signOut} />
      </aside>

      {/* Mobile sidebar */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <aside
            className="relative w-[270px] max-w-[85vw] flex flex-col h-full z-10 animate-slide-in-left"
            style={{ background: "var(--sb-bg)", borderRight: "1px solid var(--sb-border)" }}
          >
            {brand}
            <Sidebar role={user.role} can={me.can} pathname={pathname} unreadCount={unreadCount} onSignOut={signOut} onClose={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden print:block print:h-auto print:overflow-visible">
        <header
          className="no-print lg:hidden flex items-center gap-3 px-4 h-14 shrink-0 z-10"
          style={{ background: "var(--sb-bg)", borderBottom: "1px solid var(--sb-border)" }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="size-9 rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/10 transition-colors"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <div className="flex items-center gap-2 flex-1">
            <BrandMark size={26} />
            <span className="font-bold text-white text-sm tracking-tight">Voice Tunes India</span>
          </div>
          <Link href="/notifications" className="relative size-9 rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/10 transition-colors">
            <Bell className="size-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-red-500 ring-2 ring-black" />
            )}
          </Link>
        </header>

        {(isCrm || showCreateQuotation) && (
          <div className="no-print flex items-center gap-2 px-4 md:px-6 py-2 border-b border-border/60 bg-card shrink-0">
            {isCrm ? <CrmTopBar /> : <div className="flex-1" />}
            {showCreateQuotation && (
              <Button asChild size="sm" className="h-9 shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground">
                <Link href="/quotations/new" title="Create quotation">
                  <FileSignature className="size-4" /><span className="hidden sm:inline">Create quotation</span>
                </Link>
              </Button>
            )}
          </div>
        )}

        <main className="flex-1 overflow-y-auto print:overflow-visible">
          <div className="p-4 md:p-6 max-w-[1600px] print:p-0 print:max-w-none">{children}</div>
        </main>
      </div>

      <LeadDrawer />
      <AddInquiryDialog />
    </div>
  );
}
