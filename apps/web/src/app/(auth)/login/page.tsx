"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/store/auth";
import { Eye, EyeOff, LayoutDashboard, Target, AtSign, Lock } from "lucide-react";
import { BrandLogo, BrandMark } from "@/components/BrandLogo";
import { landingPath } from "@/lib/permissions";

const FEATURES = [
  { icon: LayoutDashboard, label: "Projects & Tasks",  desc: "Kanban boards with real-time updates" },
  { icon: Target,          label: "CRM & Quotations",  desc: "Track leads, quote and collect payments" },
];


export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [registered, setRegistered] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams()!;
  const setAuth = useAuthStore((s) => s.setAuth);

  useEffect(() => {
    if (searchParams.get("registered") === "1") setRegistered(true);
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "include",
      });
      const text = await res.text();
      let data: { user?: unknown; token?: string; message?: string } = {};
      if (text?.trim()) {
        try { data = JSON.parse(text); } catch { data = {}; }
      }
      if (!res.ok) throw new Error(data.message || "Login failed");
      if (!data.user || !data.token) throw new Error("Invalid response");
      setAuth(data.user as any, data.token);
      const role = (data.user as { role?: string })?.role ?? "";
      router.push(landingPath(role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-background">
      {/* Left brand panel — black with the yellow logo, like the letterhead */}
      <div className="hidden lg:flex w-[420px] shrink-0 flex-col justify-between p-10 bg-black border-r border-neutral-800">
        <BrandLogo variant="white" width={220} />

        <div>
          <p className="text-2xl font-bold text-white leading-snug mb-3">
            Your company&apos;s<br />command center
          </p>
          <p className="text-sm leading-relaxed text-neutral-400">
            Manage projects, leads, clients, quotations, and your entire team — all in one place.
          </p>
        </div>

        <div className="space-y-4">
          {FEATURES.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="flex items-start gap-3">
              <div className="size-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
                <Icon className="size-4 text-primary" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">{label}</div>
                <div className="text-xs mt-0.5 text-neutral-400">{desc}</div>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-neutral-500">Voice Tunes India</p>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-7 animate-fade-up">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 lg:hidden">
            <BrandMark size={32} />
            <span className="font-bold text-foreground text-lg">Voice Tunes India</span>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Sign in</h1>
            <p className="text-muted-foreground text-sm mt-1">Welcome back — enter your credentials below</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-sm font-medium">Username, email or employee ID</Label>
              <div className="relative">
                <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. adarsh, name@company.com or VTI-0003"
                  required
                  autoComplete="username"
                  className="h-10 pl-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                  autoComplete="current-password"
                  className="h-10 pl-9 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {registered && (
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2.5 rounded-lg">
                Account created! Sign in to continue.
              </p>
            )}
            {error && (
              <p className="text-sm text-destructive bg-destructive/8 border border-destructive/20 px-3 py-2.5 rounded-lg">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full h-10 font-semibold text-sm mt-1" disabled={loading}>
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="size-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                  Signing in…
                </span>
              ) : "Sign in"}
            </Button>
          </form>

          <div className="flex items-center justify-center text-sm pt-1">
            <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground transition-colors text-sm">
              Forgot password?
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
