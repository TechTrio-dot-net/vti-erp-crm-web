import type { ReactNode } from "react";
import { cn } from "@/lib/erp/cn";
import { Icon } from "./Icon";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-xl border border-neutral-200 bg-paper shadow-sm", className)}>{children}</section>;
}

export function CardHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-neutral-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// Brand-coloured messages: errors in ink, warnings in brand yellow, info neutral.
const ALERT_TONES = {
  error: { box: "border-ink bg-paper", icon: "bg-ink text-paper" },
  warning: { box: "border-brand bg-brand/15", icon: "bg-brand text-ink" },
  info: { box: "border-neutral-300 bg-paper", icon: "bg-neutral-200 text-ink" },
} as const;

export function Alert({ tone = "error", children }: { tone?: keyof typeof ALERT_TONES; children: ReactNode }) {
  const styles = ALERT_TONES[tone];

  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-lg border border-l-4 px-4 py-3 text-sm text-ink", styles.box)}>
      <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full", styles.icon)}>
        <Icon name="alert" className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
