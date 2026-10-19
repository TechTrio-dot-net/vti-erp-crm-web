import type { ReactNode } from "react";
import type { PaginationMeta } from "@/lib/erp/types";
import { cn } from "@/lib/erp/cn";
import { Icon } from "./ui/Icon";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string | number;
  loading?: boolean;
  emptyMessage?: string;
  meta?: PaginationMeta;
  onPageChange?: (page: number) => void;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({ columns, rows, rowKey, loading, emptyMessage = "No records found.", meta, onPageChange, onRowClick }: DataTableProps<T>) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-paper shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead className="bg-neutral-50">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn("whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500", column.className)}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={cn("divide-y divide-neutral-100", loading && rows && "opacity-60")}>
            {!rows && loading &&
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  {columns.map((column) => (
                    <td key={column.key} className="px-4 py-3.5">
                      <div className="h-3.5 w-3/4 animate-pulse rounded bg-neutral-100" />
                    </td>
                  ))}
                </tr>
              ))}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-neutral-500">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {rows?.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn("align-top", onRowClick && "cursor-pointer hover:bg-neutral-50")}
              >
                {columns.map((column) => (
                  <td key={column.key} className={cn("px-4 py-3 text-neutral-700", column.className)}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {meta && meta.last_page > 1 && onPageChange && (
        <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-3 text-sm text-neutral-600">
          <span>
            Showing {meta.from}–{meta.to} of {meta.total}
          </span>
          <div className="flex items-center gap-1">
            <PageButton disabled={meta.current_page <= 1} onClick={() => onPageChange(meta.current_page - 1)} label="Previous page" icon="chevronLeft" />
            <span className="px-2">
              Page {meta.current_page} of {meta.last_page}
            </span>
            <PageButton disabled={meta.current_page >= meta.last_page} onClick={() => onPageChange(meta.current_page + 1)} label="Next page" icon="chevronRight" />
          </div>
        </div>
      )}
    </div>
  );
}

function PageButton({ disabled, onClick, label, icon }: { disabled: boolean; onClick: () => void; label: string; icon: "chevronLeft" | "chevronRight" }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className="rounded-md p-1.5 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 disabled:opacity-40"
    >
      <Icon name={icon} className="h-4 w-4" />
    </button>
  );
}
