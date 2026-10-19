"use client";

import { ActiveBadge, CrudPage, type CrudConfig } from "@/components/erp/admin/CrudPage";
import { RequirePermission } from "@/components/erp/RequirePermission";
import type { Id } from "@/lib/erp/types";

interface Language {
  id: Id;
  name: string;
  code: string | null;
  is_active: boolean;
  sort_order: number;
}

const config: CrudConfig<Language> = {
  title: "Languages",
  description: "Languages available in quotation dropdowns (voice over, video editing and dubbing).",
  endpoint: "/admin/languages",
  singular: "Language",
  searchPlaceholder: "Search name or code",
  activeFilter: true,
  recordLabel: (row) => row.name,
  columns: [
    { key: "name", header: "Name", cell: (row) => <span className="font-medium text-neutral-900">{row.name}</span> },
    { key: "code", header: "Code", cell: (row) => row.code ?? "—" },
    { key: "sort", header: "Order", cell: (row) => row.sort_order },
    { key: "active", header: "Status", cell: (row) => <ActiveBadge active={row.is_active} /> },
  ],
  fields: [
    { name: "name", label: "Name", type: "text", required: true },
    { name: "code", label: "Code", type: "text", placeholder: "e.g. hi", hint: "Optional ISO code" },
    { name: "sort_order", label: "Display order", type: "number", step: "1" },
    { name: "is_active", label: "Active", type: "checkbox", hint: "Inactive languages are hidden from new quotations." },
  ],
  toForm: (row) => ({ name: row?.name ?? "", code: row?.code ?? "", sort_order: String(row?.sort_order ?? 0), is_active: row?.is_active ?? true }),
};

export default function LanguagesPage() {
  return (
    <RequirePermission permission="languages.manage">
      <CrudPage config={config} />
    </RequirePermission>
  );
}
