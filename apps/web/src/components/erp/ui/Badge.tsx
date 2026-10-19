import type { ReactNode } from "react";
import { cn } from "@/lib/erp/cn";

// All badges use the Voice Tunes India palette (yellow #fccc13, black, white) plus neutral greys.
export type BadgeTone = "brand" | "soft" | "dark" | "outline" | "muted";

const TONES: Record<BadgeTone, string> = {
  brand: "bg-brand text-ink ring-brand",
  soft: "bg-brand/25 text-ink ring-brand",
  dark: "bg-ink text-paper ring-ink",
  outline: "bg-paper text-ink ring-ink",
  muted: "bg-neutral-100 text-neutral-600 ring-neutral-300",
};

export function Badge({ tone = "muted", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[tone], className)}>
      {children}
    </span>
  );
}
