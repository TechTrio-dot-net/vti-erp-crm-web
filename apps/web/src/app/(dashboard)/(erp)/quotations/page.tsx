"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Option, Paginated, Quotation, QuotationStatus } from "@/lib/erp/types";
import { withQuery } from "@/lib/erp/api";
import { useApi } from "@/lib/erp/use-api";
import { useAuth } from "@/lib/erp/auth-context";
import { formatDate, formatMoney } from "@/lib/erp/format";
import { DataTable, type Column } from "@/components/erp/DataTable";
import { RequirePermission } from "@/components/erp/RequirePermission";
import { STATUS_OPTIONS, StatusBadge } from "@/components/erp/quotation/StatusBadge";
import { Alert, PageHeader } from "@/components/erp/ui/Card";
import { buttonClass } from "@/components/erp/ui/Button";
import { inputClass } from "@/components/erp/ui/FormInput";
import { Select } from "@/components/erp/ui/Select";
import { Icon } from "@/components/erp/ui/Icon";

const COLUMNS: Column<Quotation>[] = [
  {
    key: "number",
    header: "Quotation",
    cell: (q) => (
      <Link href={`/quotations/${q.id}`} className="font-semibold text-ink underline decoration-brand decoration-2 underline-offset-4 hover:decoration-ink" onClick={(e) => e.stopPropagation()}>
        {q.quotation_number}
      </Link>
    ),
  },
  {
    key: "client",
    header: "Client",
    cell: (q) => (
      <div>
        <p className="font-medium text-neutral-900">{q.client_name}</p>
        {q.client_company && <p className="text-xs text-neutral-500">{q.client_company}</p>}
      </div>
    ),
  },
  { key: "items", header: "Services", cell: (q) => q.items_count, className: "text-center" },
  { key: "total", header: "Grand total", cell: (q) => <span className="font-medium text-neutral-900">{formatMoney(q.grand_total, q.currency)}</span>, className: "text-right" },
  { key: "status", header: "Status", cell: (q) => <StatusBadge status={q.status} /> },
  { key: "creator", header: "Created by", cell: (q) => q.created_by?.name ?? "—" },
  { key: "date", header: "Created", cell: (q) => formatDate(q.created_at) },
];

const STATUS_ORDER = STATUS_OPTIONS.map((option) => option.value as QuotationStatus);

/**
 * Views spanning several statuses, listed above the single statuses. These are
 * what the dashboard's "Pending quotations" and "Total quotation value" cards open.
 */
const STATUS_PRESETS: Option[] = [
  { value: "draft,sent", label: "Pending (draft or sent)" },
  { value: "draft,sent,accepted", label: "Open (not rejected or cancelled)" },
];

/** "sent,draft" and "draft, sent" are the same filter; order them one way so the dropdown recognises it. */
function normaliseStatus(value: string | null): string {
  if (!value) return "";

  const chosen = new Set(value.split(",").map((status) => status.trim()));

  return STATUS_ORDER.filter((status) => chosen.has(status)).join(",");
}

/** A YYYY-MM-DD calendar day for display, read as that day wherever the browser is. */
function formatDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);

  return new Date(year, month - 1, date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function QuotationsPage() {
  return (
    <RequirePermission permission={["quotations.view", "quotations.view_all"]}>
      {/* The list reads its filters from the URL, which needs a Suspense boundary. */}
      <Suspense>
        <QuotationList />
      </Suspense>
    </RequirePermission>
  );
}

function QuotationList() {
  const router = useRouter();
  const params = useSearchParams()!;
  const { can } = useAuth();

  // The URL is the only place the filters live. A dashboard card or a shared
  // link opens the list already narrowed; refresh and Back keep the view; and
  // the sidebar's plain /quotations link shows everything again.
  const status = normaliseStatus(params.get("status"));
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const search = params.get("search") ?? "";

  const setFilters = (changes: Partial<Record<"status" | "from" | "to" | "search", string>>) => {
    router.replace(withQuery("/quotations", { status, from, to, search, ...changes }), { scroll: false });
  };

  // Any change of filter returns to the first page.
  const filterKey = [status, from, to, search].join("|");
  const [paging, setPaging] = useState({ filterKey, page: 1 });
  const page = paging.filterKey === filterKey ? paging.page : 1;
  const setPage = (next: number) => setPaging({ filterKey, page: next });

  // The search box types ahead of the URL, which only updates once typing pauses.
  const [searchInput, setSearchInput] = useState(search);
  const [lastUrlSearch, setLastUrlSearch] = useState(search);
  // What the box last wrote to the URL, so its own update isn't mistaken for an outside one.
  const [pushedSearch, setPushedSearch] = useState<string | null>(null);

  if (search !== lastUrlSearch) {
    setLastUrlSearch(search);
    setPushedSearch(null);
    // Changed from outside the box (a link, Back): show what the URL now says.
    // Echoes of the box's own update are skipped, or keys typed while the URL
    // was catching up would be wiped out.
    if (search !== pushedSearch) setSearchInput(search);
  }

  useEffect(() => {
    if (searchInput === search) return;

    const timer = setTimeout(() => {
      setPushedSearch(searchInput);
      router.replace(withQuery("/quotations", { status, from, to, search: searchInput }), { scroll: false });
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput, search, status, from, to, router]);

  const { data, error, loading } = useApi<Paginated<Quotation>>(withQuery("/quotations", { page, status, from, to, search }));

  // A combination with no named view (from a hand-edited link) still shows in the dropdown.
  const statusOptions = [...STATUS_PRESETS, ...STATUS_OPTIONS];
  if (status && !statusOptions.some((option) => option.value === status)) {
    statusOptions.unshift({ value: status, label: status.split(",").map((s) => STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s).join(" or ") });
  }

  const dateLabel = from && to && from === to ? formatDay(from) : [from && `from ${formatDay(from)}`, to && `to ${formatDay(to)}`].filter(Boolean).join(" ");
  const filtered = Boolean(search || status || from || to);

  return (
    <>
      <PageHeader
        title="Quotations"
        description={can("quotations.view_all") ? "All quotations across the company." : "Quotations you have created."}
        actions={
          can("quotations.create") && (
            <Link href="/quotations/new" className={buttonClass()}>
              <Icon name="plus" className="h-4 w-4" />
              New quotation
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search number, client or company"
            className={`${inputClass} pl-9`}
            aria-label="Search quotations"
          />
        </div>
        <Select
          className="w-64"
          aria-label="Filter by status"
          placeholder="All statuses"
          options={statusOptions}
          value={status}
          onChange={(value) => setFilters({ status: value })}
        />
        {dateLabel && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand bg-brand/15 py-1 pl-3 pr-1 text-sm text-ink">
            <Icon name="calendar" className="h-3.5 w-3.5" />
            Created {dateLabel}
            <button
              type="button"
              onClick={() => setFilters({ from: "", to: "" })}
              className="rounded-full p-1 text-neutral-600 hover:bg-brand/30 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              aria-label="Clear the date filter"
            >
              <Icon name="x" className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4">
          <Alert>{error.message}</Alert>
        </div>
      )}

      <DataTable
        columns={COLUMNS}
        rows={data?.data}
        rowKey={(q) => q.id}
        loading={loading}
        meta={data?.meta}
        onPageChange={setPage}
        onRowClick={(q) => router.push(`/quotations/${q.id}`)}
        emptyMessage={filtered ? "No quotations match your filters." : "No quotations yet."}
      />
    </>
  );
}
