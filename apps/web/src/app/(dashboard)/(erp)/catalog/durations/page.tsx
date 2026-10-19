"use client";

import { ActiveBadge, CrudPage, type CrudConfig } from "@/components/erp/admin/CrudPage";
import { RequirePermission } from "@/components/erp/RequirePermission";
import { trimNumber } from "@/lib/erp/format";
import type { Id } from "@/lib/erp/types";

interface Duration {
  id: Id;
  label: string;
  minutes: string;
  is_active: boolean;
  sort_order: number;
}

const config: CrudConfig<Duration> = {
  title: "Durations",
  description: "Preset durations in the quotation dropdown. Users can still enter a custom duration.",
  endpoint: "/admin/durations",
  singular: "Duration",
  searchPlaceholder: "Search durations",
  activeFilter: true,
  recordLabel: (row) => row.label,
  columns: [
    { key: "label", header: "Label", cell: (row) => <span className="font-medium text-neutral-900">{row.label}</span> },
    { key: "minutes", header: "Minutes", cell: (row) => trimNumber(row.minutes) },
    { key: "sort", header: "Order", cell: (row) => row.sort_order },
    { key: "active", header: "Status", cell: (row) => <ActiveBadge active={row.is_active} /> },
  ],
  fields: [
    { name: "label", label: "Label", type: "text", required: true, placeholder: "e.g. 5 Minutes" },
    { name: "minutes", label: "Minutes", type: "number", required: true, step: "0.01", hint: "Used in price calculations." },
    { name: "sort_order", label: "Display order", type: "number", step: "1" },
    { name: "is_active", label: "Active", type: "checkbox" },
  ],
  toForm: (row) => ({
    label: row?.label ?? "",
    minutes: row ? trimNumber(row.minutes) : "",
    sort_order: String(row?.sort_order ?? 0),
    is_active: row?.is_active ?? true,
  }),
};

export default function DurationsPage() {
  return (
    <RequirePermission permission="durations.manage">
      <CrudPage config={config} />
    </RequirePermission>
  );
}
