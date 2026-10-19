"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/lib/erp/auth-context";
import { Card } from "./ui/Card";
import { Icon } from "./ui/Icon";

/** Hides a page from users without access. The API enforces the same rule. */
export function RequirePermission({ permission, children }: { permission: string | string[]; children: ReactNode }) {
  const { can } = useAuth();

  if (can(permission)) return <>{children}</>;

  return (
    <Card className="mx-auto mt-10 max-w-md p-8 text-center">
      <Icon name="shield" className="mx-auto h-8 w-8 text-neutral-400" />
      <h1 className="mt-3 text-base font-semibold text-neutral-900">Access restricted</h1>
      <p className="mt-1 text-sm text-neutral-500">You don&apos;t have permission to view this page. Contact a Super Admin if you need access.</p>
    </Card>
  );
}
