"use client";

import { ActiveBadge, CrudPage, type CrudConfig } from "@/components/erp/admin/CrudPage";
import { RequirePermission } from "@/components/erp/RequirePermission";
import type { Id } from "@/lib/erp/types";

interface Performer {
  id: Id;
  code: string;
  name: string;
  is_active: boolean;
  sort_order: number;
}

const config: CrudConfig<Performer> = {
  title: "Performers",
  description: "On-camera talent for video types that require a performer, such as green screen videos. Quotations show the code only.",
  endpoint: "/admin/performers",
  singular: "Performer",
  searchPlaceholder: "Search by code or name",
  activeFilter: true,
  recordLabel: (row) => `${row.code} — ${row.name}`,
  columns: [
    { key: "code", header: "Code", cell: (row) => <span className="font-medium text-neutral-900">{row.code}</span> },
    { key: "name", header: "Name", cell: (row) => row.name },
    { key: "sort", header: "Order", cell: (row) => row.sort_order },
    { key: "active", header: "Status", cell: (row) => <ActiveBadge active={row.is_active} /> },
  ],
  fields: [
    { name: "code", label: "Code", type: "text", required: true, placeholder: "e.g. SH" },
    { name: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Shailee Ma'am" },
    { name: "sort_order", label: "Display order", type: "number", step: "1" },
    { name: "is_active", label: "Active", type: "checkbox" },
  ],
  toForm: (row) => ({
    code: row?.code ?? "",
    name: row?.name ?? "",
    sort_order: String(row?.sort_order ?? 0),
    is_active: row?.is_active ?? true,
  }),
};

export default function PerformersPage() {
  return (
    <RequirePermission permission="artists.manage">
      <CrudPage config={config} />
    </RequirePermission>
  );
}
