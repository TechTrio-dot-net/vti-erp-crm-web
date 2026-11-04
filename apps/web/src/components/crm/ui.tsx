"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, WifiOff } from "lucide-react";
import { api } from "@/lib/api";
import { addDays, today, type Bdm, isCoordination, isBdm, isCrmAdmin, OUTCOME_LEGEND, STAGE_LEGEND, WON_LOST_LEGEND } from "@/lib/crm";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const selectCls =
  "h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
export const textareaCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring";

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function useBdms(options: { includeInactive?: boolean } = {}) {
  return useQuery({
    queryKey: ["crm", "bdms", options.includeInactive ?? false],
    queryFn: () => api<Bdm[]>(`/crm/bdms${options.includeInactive ? "?includeInactive=true" : ""}`),
    staleTime: 60_000,
  });
}

export function useServices() {
  return useQuery({
    queryKey: ["masters", "services"],
    queryFn: () => api<Array<{ id: string; name: string; price: number | null; active: boolean }>>("/masters/services"),
    staleTime: 5 * 60_000,
  });
}

export type Range = { from: string; to: string };

export const rangePresets = [
  { label: "Today", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

export const lastDays = (days: number): Range => ({ from: addDays(today(), -(days - 1)), to: today() });

/** From/to date inputs with quick presets */
export function DateRangeFilter({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} className={selectCls} aria-label="From date" />
      <span className="text-muted-foreground text-sm">to</span>
      <input type="date" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} className={selectCls} aria-label="To date" />
      <div className="flex gap-1">
        {rangePresets.map((p) => {
          const r = lastDays(p.days);
          const active = r.from === value.from && r.to === value.to;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(r)}
              className={`px-2.5 h-9 rounded-lg text-xs font-medium border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "border-input text-muted-foreground hover:text-foreground"}`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** BDM picker — admins only; BDMs always see their own data */
export function BdmSelect({ value, onChange, allLabel = "All BDMs", includeUnassigned = false }: { value: string; onChange: (v: string) => void; allLabel?: string; includeUnassigned?: boolean }) {
  const role = useAuthStore((s) => s.user?.role);
  const { data: bdms } = useBdms();
  if (role === "SALES") return null;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={selectCls} aria-label="BDM">
      <option value="">{allLabel}</option>
      {includeUnassigned && <option value="unassigned">Unassigned</option>}
      {bdms?.map((b) => (
        <option key={b.id} value={b.id}>{b.name}</option>
      ))}
    </select>
  );
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="card p-4 flex flex-wrap items-center gap-3">{children}</div>;
}

export function StatCard({ label, value, sub, tone = "blue", icon: Icon, onClick, active = false }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode;
  tone?: "blue" | "green" | "amber" | "red" | "sky" | "purple";
  icon?: React.ComponentType<{ className?: string }>;
  /** Makes the whole card a button — a tile that narrows the table below it to what it counts */
  onClick?: () => void;
  /** That filter is the one in force, so the card is ringed to show where the table's rows come from */
  active?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between mb-3">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        {Icon && <div className={`icon-chip size-9 icon-chip-${tone}`}><Icon className="size-4" /></div>}
      </div>
      <div className="text-3xl font-bold tabular-nums">{value}</div>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </>
  );
  const cls = `card animate-fade-up kpi-${tone} p-5 ${active ? "ring-2 ring-ring" : ""}`;
  if (!onClick) return <div className={cls}>{body}</div>;
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`${cls} w-full text-left transition hover:shadow-md`}>
      {body}
    </button>
  );
}

export function ErrorState({ message = "Could not load this report" }: { message?: string }) {
  return (
    <div className="card flex flex-col items-center justify-center py-14 gap-3 text-center">
      <div className="size-12 rounded-2xl bg-muted flex items-center justify-center"><WifiOff className="size-6 text-muted-foreground" /></div>
      <p className="font-semibold">{message}</p>
      <p className="text-sm text-muted-foreground">Check your connection or try again.</p>
    </div>
  );
}

export function LoadingBlock({ rows = 6 }: { rows?: number }) {
  return (
    <div className="card p-5 space-y-3">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-8" />)}
    </div>
  );
}

export type Column<T> = {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  /** plain value for CSV export (defaults to row[key]) */
  csv?: (row: T) => unknown;
  /** Kept out of the table but still exported, so trimming the screen never thins the CSV */
  csvOnly?: boolean;
  className?: string;
  align?: "right";
};

/** Simple table with empty state and CSV export of the visible rows */
export function DataTable<T extends Record<string, unknown>>({
  title,
  rows,
  columns,
  empty = "Nothing here yet",
  csvName,
  onRowClick,
  rowClassName,
  footer,
  actions,
  legend,
}: {
  title?: string;
  rows: T[];
  columns: Column<T>[];
  empty?: string;
  csvName?: string;
  onRowClick?: (row: T) => void;
  /** Extra classes for one row, e.g. to colour a salesperson who has stopped calling */
  rowClassName?: (row: T) => string | undefined;
  footer?: React.ReactNode;
  actions?: React.ReactNode;
  /** Shows the key to the row colours above the first row; say which reading of them the rows use */
  legend?: "stage" | "outcome" | "wonLost";
}) {
  const onScreen = columns.filter((c) => !c.csvOnly);
  const exportCsv = async () => {
    const { downloadCsv } = await import("@/lib/crm");
    downloadCsv(
      `${csvName}-${today()}.csv`,
      columns.map((c) => c.label),
      rows.map((r) => columns.map((c) => (c.csv ? c.csv(r) : (r[c.key] as unknown))))
    );
  };
  return (
    <div className="card">
      {(title || csvName || actions) && (
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-border/50">
          {title && <p className="text-[15px] font-semibold">{title}</p>}
          <span className="badge badge-gray">{rows.length}</span>
          <div className="ml-auto flex items-center gap-2">
            {actions}
            {csvName && rows.length > 0 && (
              <Button variant="outline" size="sm" onClick={exportCsv}><Download className="size-3.5" />CSV</Button>
            )}
          </div>
        </div>
      )}
      {legend && rows.length > 0 && <StatusLegend of={legend} />}
      {rows.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">{empty}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>{onScreen.map((c) => <th key={c.key} className={c.align === "right" ? "text-right" : undefined}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={(row.id as string) ?? i} onClick={onRowClick ? () => onRowClick(row) : undefined} className={`${onRowClick ? "cursor-pointer" : ""} ${rowClassName?.(row) ?? ""}`.trim() || undefined}>
                  {onScreen.map((c) => (
                    <td key={c.key} className={`${c.className ?? ""} ${c.align === "right" ? "text-right tabular-nums" : ""}`}>
                      {c.render ? c.render(row) : ((row[c.key] as React.ReactNode) ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {footer}
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * The key to the row colours. A table that tints its rows is a wall of orange, yellow, green and red with
 * nothing saying which is which, so it carries this strip above the first row. The badges are the ones the
 * rows themselves use, at their own colour rather than the ringed version a tinted row shows.
 */
export function StatusLegend({ of = "stage" }: { of?: "stage" | "outcome" | "wonLost" }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 border-b border-border/50">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Row colour</span>
      {(of === "wonLost" ? WON_LOST_LEGEND : of === "outcome" ? OUTCOME_LEGEND : STAGE_LEGEND).map((l) => (
        <span key={l.label} className={`badge ${l.badge}`}>{l.label}</span>
      ))}
    </div>
  );
}

/** CRM admins only; `coordination` also lets the coordination role in (lost leads, weekly targets) */
export function AdminOnly({ children, coordination = false, bdm = false }: { children: React.ReactNode; coordination?: boolean; bdm?: boolean }) {
  const role = useAuthStore((s) => s.user?.role);
  if (!isCrmAdmin(role) && !(coordination && isCoordination(role)) && !(bdm && isBdm(role))) {
    return <ErrorState message="This page is only available to CRM admins" />;
  }
  return <>{children}</>;
}
