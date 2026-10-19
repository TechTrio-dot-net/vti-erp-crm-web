import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/erp/cn";
import { Icon, type IconName } from "./ui/Icon";

interface DashboardCardProps {
  label: string;
  value: ReactNode | undefined;
  icon: IconName;
  hint?: string;
  /** Placeholder figure for a module that isn't built yet. */
  demo?: boolean;
  /**
   * The list behind the figure. When set, the whole card is a link to it; leave
   * it out for figures with nothing to open (demo metrics, or pages the viewer
   * may not see).
   */
  href?: string;
}

export function DashboardCard({ label, value, icon, hint, demo, href }: DashboardCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink text-brand">
          <Icon name={icon} />
        </div>
        {demo && (
          <span className="rounded bg-brand/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink" title="Demo value until this module is built">
            Demo
          </span>
        )}
        {href && (
          <Icon
            name="chevronRight"
            className="h-4 w-4 text-neutral-300 transition-all group-hover:translate-x-0.5 group-hover:text-ink"
          />
        )}
      </div>
      <p className="mt-4 text-sm text-neutral-500">{label}</p>
      {value === undefined ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-neutral-100" />
      ) : (
        <p className="mt-1 text-2xl font-semibold tracking-tight text-ink">{value}</p>
      )}
      {hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
    </>
  );

  const frame = "block rounded-xl border border-neutral-200 bg-paper p-5 shadow-sm";

  if (!href) {
    return <div className={frame}>{body}</div>;
  }

  return (
    // No aria-label: it would replace the card's text, and the figure is the point.
    <Link
      href={href}
      className={cn(
        frame,
        "group transition hover:-translate-y-0.5 hover:border-brand hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
      )}
    >
      {body}
    </Link>
  );
}
