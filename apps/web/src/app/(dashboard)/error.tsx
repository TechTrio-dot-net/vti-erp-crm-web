"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console for debugging; swap with Sentry/etc. when added
    console.error("[DashboardError]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center animate-fade-up">
      <div className="size-14 rounded-2xl bg-destructive/10 flex items-center justify-center mb-5">
        <AlertTriangle className="size-7 text-destructive" />
      </div>

      <h2 className="text-xl font-bold tracking-tight text-foreground mb-2">
        Something went wrong
      </h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        {error.message || "An unexpected error occurred. Please try again or go back to the dashboard."}
      </p>

      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold shadow-sm hover:bg-primary/90 transition-colors"
        >
          <RefreshCw className="size-4" />
          Try again
        </button>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-border bg-card text-sm font-semibold shadow-xs hover:bg-muted/60 transition-colors"
        >
          <Home className="size-4" />
          Dashboard
        </Link>
      </div>

      {error.digest && (
        <p className="text-[11px] text-muted-foreground/60 mt-6 font-mono">
          Error ID: {error.digest}
        </p>
      )}
    </div>
  );
}
