import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Role =
  | "SUPER_ADMIN"
  | "MANAGEMENT"
  | "PROJECT_MANAGER"
  | "DEVELOPER"
  | "DESIGNER"
  | "MARKETING"
  | "ADS_TEAM"
  | "SALES"
  | "SUPPORT"
  | "HR"
  | "TEAM_MEMBER"
  | "CLIENT";

export interface User {
  id: string;
  name: string;
  username: string;
  role: Role;
  initials?: string;
  clientId?: string;
  clientProfileId?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  _hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  setAuth: (user: User, token: string) => void;
  setToken: (token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),
      setAuth: (user, token) => {
        localStorage.setItem("token", token);
        set({ user: { ...user, clientId: user.clientId ?? user.clientProfileId }, token });
      },
      setToken: (token) => {
        localStorage.setItem("token", token);
        set({ token });
      },
      logout: () => {
        localStorage.removeItem("token");
        set({ user: null, token: null });
        // Clear the httpOnly refresh cookie too, so a signed-out browser can't silently resume
        fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
      },
    }),
    {
      name: "voicetunes-auth",
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
