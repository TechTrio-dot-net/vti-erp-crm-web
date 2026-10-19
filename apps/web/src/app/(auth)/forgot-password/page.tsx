"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, ArrowLeft, CheckCircle2, AtSign } from "lucide-react";
import { BrandMark } from "@/components/BrandLogo";

export default function ForgotPasswordPage() {
  const [email, setEmail]   = useState("");
  const [sent, setSent]     = useState(false);
  const [error, setError]   = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { message?: string }).message || "Request failed");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm text-center animate-fade-up space-y-5">
          <div className="size-16 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto">
            <CheckCircle2 className="size-8 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Check your email</h1>
            <p className="text-muted-foreground text-sm mt-2">
              If an account exists for <strong className="text-foreground">{email}</strong>,
              we&apos;ve sent a password reset link.
            </p>
          </div>
          <Link href="/login">
            <Button variant="outline" className="w-full h-10">
              <ArrowLeft className="size-4" />Back to sign in
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm animate-fade-up space-y-7">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <BrandMark size={32} />
          <span className="font-bold text-foreground text-lg">Voice Tunes India</span>
        </div>

        <div>
          <div className="size-12 rounded-xl bg-muted flex items-center justify-center mb-4">
            <Mail className="size-5 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Reset password</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Enter your email, username or employee ID and we&apos;ll email a reset link to the address on your account.
            Accounts without an email address need an admin to reset the password.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-sm font-medium text-foreground">Email, username or employee ID</Label>
            <div className="relative">
              <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                id="email"
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com or VTI-0003"
                required
                autoComplete="username"
                className="h-10 pl-9"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/8 border border-destructive/20 px-3 py-2.5 rounded-lg">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full h-10 font-semibold" disabled={loading}>
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="size-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                Sending…
              </span>
            ) : "Send reset link"}
          </Button>
        </form>

        <Link
          href="/login"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors justify-center"
        >
          <ArrowLeft className="size-3.5" />Back to sign in
        </Link>
      </div>
    </div>
  );
}
