"use client";

import Link from "next/link";
import { Zap, Home, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
      <div className="w-full max-w-md text-center space-y-6 animate-fade-up">
        {/* Logo */}
        <div className="flex justify-center">
          <div className="size-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Zap className="size-6 text-primary-text" />
          </div>
        </div>

        {/* Error code */}
        <div>
          <p className="text-[80px] font-black leading-none tracking-tighter text-foreground/10 select-none">
            404
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground -mt-3">
            Page not found
          </h1>
          <p className="text-muted-foreground text-sm mt-2">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold shadow-sm hover:bg-primary/90 transition-colors"
          >
            <Home className="size-4" />
            Go to Dashboard
          </Link>
          <button
            onClick={() => history.back()}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-border bg-card text-sm font-semibold shadow-xs hover:bg-muted/60 transition-colors"
          >
            <ArrowLeft className="size-4" />
            Go back
          </button>
        </div>
      </div>
    </div>
  );
}
