"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandLogo";

const CLIENT_NAV = [
  { href: "/portal", label: "Dashboard", icon: "▦" },
  { href: "/portal/projects", label: "My Projects", icon: "▤" },
  { href: "/portal/tasks", label: "Tasks", icon: "✓" },
  { href: "/portal/approvals", label: "Pending Approvals", icon: "◎" },
  { href: "/portal/calendar", label: "Content Calendar", icon: "📅" },
  { href: "/portal/ads", label: "Ad Campaigns", icon: "📊" },
];

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, logout, _hasHydrated } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname()!;

  useEffect(() => {
    if (!_hasHydrated) return;
    if (!user) { router.push("/login"); return; }
    if (user.role !== "CLIENT") router.push("/dashboard");
  }, [user, _hasHydrated, router]);

  if (!_hasHydrated || !user || user.role !== "CLIENT") return null;

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="w-56 border-r bg-card flex flex-col">
        <div className="p-4 border-b">
          <BrandMark size={32} />
          <div className="font-semibold text-foreground mt-2">Client Portal</div>
          <div className="flex items-center gap-3 mt-4">
            <div className="size-9 rounded-full bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground">
              {user.initials || "?"}
            </div>
            <div className="min-w-0">
              <div className="font-medium text-sm truncate">{user.name?.split(" ")[0]}</div>
              <div className="text-xs text-muted-foreground">Client</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-auto">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-2 py-1.5">
            Menu
          </div>
          {CLIENT_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 px-2 py-2 rounded-md text-sm ${
                pathname === item.href
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              }`}
            >
              <span className="text-muted-foreground">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t">
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground hover:text-foreground"
            onClick={() => {
              logout();
              router.push("/login");
            }}
          >
            Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6 bg-muted/30">{children}</main>
    </div>
  );
}
