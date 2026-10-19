"use client";

import { ActiveBadge, CrudPage, type CrudConfig } from "@/components/erp/admin/CrudPage";
import { RequirePermission } from "@/components/erp/RequirePermission";
import type { Id } from "@/lib/erp/types";

interface VideoType {
  id: Id;
  name: string;
  description: string | null;
  requires_performer: boolean;
  custom_price: boolean;
  is_active: boolean;
  sort_order: number;
}

function pricing(row: VideoType): string {
  if (row.custom_price) return "Custom price";
  return row.requires_performer ? "Per performer" : "Standard";
}

const config: CrudConfig<VideoType> = {
  title: "Video Types",
  description: "Video categories used when quoting video editing. Their rates are set under Pricing Rules.",
  endpoint: "/admin/video-types",
  singular: "Video type",
  searchPlaceholder: "Search video types",
  activeFilter: true,
  recordLabel: (row) => row.name,
  columns: [
    { key: "name", header: "Name", cell: (row) => <span className="font-medium text-neutral-900">{row.name}</span> },
    { key: "pricing", header: "Pricing", cell: (row) => pricing(row) },
    { key: "description", header: "Description", cell: (row) => row.description ?? "—" },
    { key: "sort", header: "Order", cell: (row) => row.sort_order },
    { key: "active", header: "Status", cell: (row) => <ActiveBadge active={row.is_active} /> },
  ],
  fields: [
    { name: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Green Screen Video" },
    { name: "sort_order", label: "Display order", type: "number", step: "1" },
    { name: "description", label: "Description", type: "textarea" },
    {
      name: "requires_performer",
      label: "Requires a performer",
      type: "checkbox",
      hint: "The quotation asks who performs, and each performer can have their own pricing rule.",
    },
    {
      name: "custom_price",
      label: "Custom price",
      type: "checkbox",
      hint: "No fixed rate: the price is entered on each quotation.",
    },
    { name: "is_active", label: "Active", type: "checkbox" },
  ],
  toForm: (row) => ({
    name: row?.name ?? "",
    description: row?.description ?? "",
    sort_order: String(row?.sort_order ?? 0),
    requires_performer: row?.requires_performer ?? false,
    custom_price: row?.custom_price ?? false,
    is_active: row?.is_active ?? true,
  }),
};

export default function VideoTypesPage() {
  return (
    <RequirePermission permission="video_types.manage">
      <CrudPage config={config} />
    </RequirePermission>
  );
}
