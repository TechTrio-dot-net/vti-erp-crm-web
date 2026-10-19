"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth";
import type { User } from "./types";
import { ApiError } from "./api";
import { useMe } from "./me";
import { Button } from "@/components/erp/ui/Button";
import { Spinner } from "@/components/erp/ui/Spinner";

interface AuthContextValue {
  user: User;
  /** True if the user holds any of the given permission slugs. Display only — the API enforces access. */
  can: (permission: string | string[]) => boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Loads the signed-in user's permissions for the quotation, catalog and admin pages */
export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const signOut = useAuthStore((s) => s.logout);
  const { user, error, refetch, can } = useMe();

  const logout = useCallback(async () => {
    signOut();
    queryClient.clear();
    router.replace("/login");
  }, [signOut, queryClient, router]);

  const canRef = useCallback((permission: string | string[]) => can(permission), [can]);
  const value = useMemo(() => (user ? { user, can: canRef, logout } : null), [user, canRef, logout]);

  if (!value) {
    const status = error instanceof ApiError ? error.status : 0;
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        {error && status !== 401 ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-neutral-600">{error.message}</p>
            <Button variant="secondary" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <Spinner label="Loading your workspace…" />
        )}
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
