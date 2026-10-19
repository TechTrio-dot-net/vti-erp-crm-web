"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth";
import { api } from "./api";
import type { User } from "./types";

export const ME_QUERY_KEY = ["erp", "me"] as const;

/**
 * The signed-in user's role and permission slugs, shared by the sidebar and every quotation, catalog
 * and admin page. Permissions only decide what is shown; the API enforces them.
 */
export function useMe() {
  const token = useAuthStore((s) => s.token);
  const query = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => api.get<{ data: User }>("/auth/me").then((r) => r.data),
    enabled: !!token,
    staleTime: 60_000,
  });
  const user = query.data;

  const can = (permission: string | string[]) => {
    if (!user) return false;
    if (user.is_super_admin) return true;
    const wanted = Array.isArray(permission) ? permission : [permission];
    return wanted.some((slug) => user.permissions?.includes(slug));
  };

  return { ...query, user, can };
}
