"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PaymentsIndex } from "@/lib/erp/types";
import { withQuery } from "@/lib/erp/api";
import { useApi } from "@/lib/erp/use-api";
import { useAuth } from "@/lib/erp/auth-context";
import { formatDate, formatMoney } from "@/lib/erp/format";
import { cn } from "@/lib/erp/cn";
import { DataTable, type Column } from "@/components/erp/DataTable";
import { RequirePermission } from "@/components/erp/RequirePermission";
import { PaymentStatusBadge } from "@/components/erp/payments/PaymentStatusBadge";
import { StatusBadge } from "@/components/erp/quotation/StatusBadge";
import { Alert, PageHeader } from "@/components/erp/ui/Card";
import { inputClass } from "@/components/erp/ui/FormInput";

type Row = PaymentsIndex["data"][number];
type Tab = "" | "pending" | "partial" | "paid" | "completed";

const COLUMNS: Column<Row>[] = [
  {
    key: "number",
    header: "Quotation",
    cell: (row) => (
      <div>
        <Link href={`/quotations/${row.id}#payments`} className="font-semibold text-ink underline decoration-brand decoration-2 underline-offset-4 hover:decoration-ink" onClick={(e) => e.stopPropagation()}>
          {row.quotation_number}
        </Link>
        <div className="mt-1">
          <StatusBadge status={row.status} />
        </div>
      </div>
    ),
  },
  {
    key: "client",
    header: "Client",
    cell: (row) => (
      <div>
        <p className="font-medium text-neutral-900">{row.client_name}</p>
        {row.client_company && <p className="text-xs text-neutral-500">{row.client_company}</p>}
        <p className="text-xs text-neutral-400">
          {row.created_by ?? "—"} · {formatDate(row.created_at)}
        </p>
      </div>
    ),
  },
  { key: "total", header: "Total", className: "text-right", cell: (row) => formatMoney(row.payment.total) },
  { key: "paid", header: "Received", className: "text-right", cell: (row) => <span className="font-medium text-neutral-900">{formatMoney(row.payment.paid)}</span> },
  {
    key: "pending",
    header: "Pending",
    className: "text-right",
    cell: (row) => <span className={cn(Number(row.payment.pending) > 0 && row.payment.status !== "completed" ? "font-semibold text-ink" : "text-neutral-400")}>{formatMoney(row.payment.pending)}</span>,
  },
  { key: "payment", header: "Payment", cell: (row) => <PaymentStatusBadge status={row.payment.status} /> },
];

export default function PaymentsPage() {
  return (
    <RequirePermission permission="payments.record">
      <PaymentsList />
    </RequirePermission>
  );
}

function PaymentsList() {
  const router = useRouter();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [paging, setPaging] = useState({ key: "", page: 1 });

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // A new tab or search starts again from the first page.
  const key = `${tab}|${search}`;
  const page = paging.key === key ? paging.page : 1;

  const { data, error, loading } = useApi<PaymentsIndex>(withQuery("/payments", { status: tab, search, page }));
  const summary = data?.summary;

  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: "", label: "All", count: summary?.quotations },
    { value: "pending", label: "Pending", count: summary ? summary.unpaid + summary.partial : undefined },
    { value: "partial", label: "Partly paid", count: summary?.partial },
    { value: "paid", label: "Fully paid", count: summary?.paid },
    { value: "completed", label: "Completed", count: summary?.completed },
  ];

  return (
    <>
      <PageHeader
        title="Payments"
        description={`Money received against ${can("quotations.view_all") ? "sent and accepted quotations" : "your sent and accepted quotations"}. Open a quotation to record a payment.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Received", summary && formatMoney(summary.received), "Across all payments"],
          ["Pending", summary && formatMoney(summary.pending), `${summary ? summary.unpaid + summary.partial : "—"} quotations still due`],
          ["Fully paid", summary?.paid, "Waiting to be marked complete"],
          ["Completed", summary?.completed, "Payment done and closed"],
        ].map(([label, value, hint]) => (
          <div key={label as string} className="rounded-xl border border-neutral-200 bg-paper p-5 shadow-sm">
            <p className="text-sm text-neutral-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-ink">{value ?? "—"}</p>
            <p className="mt-1 text-xs text-neutral-500">{hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Payment status">
          {tabs.map((option) => (
            <button
              key={option.value || "all"}
              type="button"
              role="tab"
              aria-selected={tab === option.value}
              onClick={() => setTab(option.value)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                tab === option.value ? "border-ink bg-brand text-ink" : "border-neutral-200 bg-paper text-neutral-700 hover:border-ink",
              )}
            >
              {option.label}
              {option.count !== undefined && <span className="ml-1.5 text-xs text-neutral-500">{option.count}</span>}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search quotation or client"
          aria-label="Search payments"
          className={cn(inputClass, "w-full sm:w-64")}
        />
      </div>

      {error && (
        <div className="mt-4">
          <Alert>{error.message}</Alert>
        </div>
      )}

      <div className="mt-4">
        <DataTable
          columns={COLUMNS}
          rows={data?.data ?? []}
          rowKey={(row) => row.id}
          loading={loading && !data}
          emptyMessage={search || tab ? "No quotations match." : "No sent or accepted quotations yet."}
          meta={data?.meta}
          onPageChange={(next) => setPaging({ key, page: next })}
          onRowClick={(row) => router.push(`/quotations/${row.id}#payments`)}
        />
      </div>
    </>
  );
}
