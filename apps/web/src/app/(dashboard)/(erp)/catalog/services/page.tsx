"use client";

import Link from "next/link";
import { CrudPage, type CrudConfig } from "@/components/erp/admin/CrudPage";
import { RequirePermission } from "@/components/erp/RequirePermission";
import { Badge } from "@/components/erp/ui/Badge";
import type { Id, ServiceField } from "@/lib/erp/types";

interface Service {
  id: Id;
  name: string;
  slug: string;
  description: string | null;
  status: "active" | "coming_soon" | "inactive";
  fields: ServiceField[] | null;
  artist_restricted: boolean;
  sort_order: number;
  artists_count: number;
  pricing_rules_count: number;
  // Sales CRM
  category_id: Id | null;
  sub_category_id: Id | null;
  price: number | null;
}

type Category = { id: Id; name: string; parent_id: Id | null };
const categoriesOf = (sources: Record<string, unknown>) => (sources.categories as Category[] | null) ?? [];

const STATUS = {
  active: { label: "Active", tone: "brand" },
  coming_soon: { label: "Coming soon", tone: "soft" },
  inactive: { label: "Inactive", tone: "muted" },
} as const;

// What the quotation form asks for, besides duration and quantity.
const FIELD_LABELS: Record<ServiceField, string> = {
  artist_id: "Artist",
  video_type_id: "Video type",
  source_language_id: "Source language",
  language_id: "Language",
};

/** Count that links through to the page where those records are managed. */
function CountLink({ count, href, title }: { count: number; href: string; title: string }) {
  return (
    <Link href={href} title={title} className="font-medium text-neutral-900 underline decoration-brand decoration-2 underline-offset-4 hover:text-ink">
      {count}
    </Link>
  );
}

const config: CrudConfig<Service> = {
  title: "Services",
  description:
    "One list of services for quotations and the sales CRM. Add a service, choose what its quotation form asks for, then give it artists and pricing rules — no code change needed. A service with no fields (e.g. Website) is quoted per unit at the price entered on the quotation. One marked “coming soon” is listed but can't be quoted yet. Category and price are used by CRM leads.",
  endpoint: "/admin/services",
  sources: { categories: "/lookups/categories" },
  singular: "Service",
  searchPlaceholder: "Search services",
  recordLabel: (row) => row.name,
  canDelete: (row) => row.artists_count === 0 && row.pricing_rules_count === 0,
  columns: [
    {
      key: "name",
      header: "Service",
      cell: (row) => (
        <div>
          <p className="font-medium text-neutral-900">{row.name}</p>
          <p className="text-xs text-neutral-500">{row.slug}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Badge>
          {row.artist_restricted && <Badge tone="soft">Artist by coordination</Badge>}
        </div>
      ),
    },
    {
      key: "fields",
      header: "Quotation asks for",
      cell: (row) =>
        row.fields && row.fields.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.fields.map((field) => (
              <Badge key={field} tone="soft">
                {FIELD_LABELS[field]}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-neutral-400">Not set up</span>
        ),
    },
    {
      key: "artists",
      header: "Artists",
      cell: (row) => <CountLink count={row.artists_count} href={`/catalog/artists?service_id=${row.id}`} title={`Artists for ${row.name}`} />,
      className: "text-center",
    },
    {
      key: "rules",
      header: "Pricing rules",
      cell: (row) => (
        <CountLink count={row.pricing_rules_count} href={`/catalog/pricing-rules?service_id=${row.id}`} title={`Pricing rules for ${row.name}`} />
      ),
      className: "text-center",
    },
    { key: "sort", header: "Order", cell: (row) => row.sort_order, className: "text-center" },
  ],
  fields: [
    { name: "name", label: "Name", type: "text", required: true },
    {
      name: "status",
      label: "Status",
      type: "select",
      required: true,
      placeholder: undefined,
      options: () => Object.entries(STATUS).map(([value, { label }]) => ({ value, label })),
    },
    {
      name: "fields",
      label: "Quotation form asks for",
      type: "multiselect",
      valueType: "string",
      hint: "Duration and quantity are always asked. Leave empty and the service is listed but can't be quoted yet.",
      options: () => (Object.keys(FIELD_LABELS) as ServiceField[]).map((value) => ({ value, label: FIELD_LABELS[value] })),
    },
    {
      name: "artist_restricted",
      label: "Artist chosen by coordination only",
      type: "checkbox",
      hint: "On: the artist is hidden from anyone without the “Choose the artist where a service reserves it” permission, and those quotations price at the service's standard rate (a pricing rule with no artist) until it is assigned.",
    },
    { name: "sort_order", label: "Display order", type: "number", step: "1" },
    { name: "description", label: "Description", type: "textarea" },
    {
      name: "category_id",
      label: "CRM main category",
      type: "select",
      placeholder: "None",
      options: (sources) => categoriesOf(sources).filter((c) => !c.parent_id).map((c) => ({ value: c.id, label: c.name })),
    },
    {
      name: "sub_category_id",
      label: "CRM sub category",
      type: "select",
      placeholder: "None",
      options: (sources, values) =>
        categoriesOf(sources)
          .filter((c) => c.parent_id && (!values.category_id || c.parent_id === values.category_id))
          .map((c) => ({ value: c.id, label: c.name })),
    },
    { name: "price", label: "CRM list price (₹)", type: "number", step: "0.01", hint: "Shown on leads. Quotations are priced by pricing rules." },
  ],
  toForm: (row) => ({
    name: row?.name ?? "",
    status: row?.status ?? "coming_soon",
    fields: row?.fields ?? [],
    artist_restricted: row?.artist_restricted ?? false,
    sort_order: String(row?.sort_order ?? 0),
    description: row?.description ?? "",
    category_id: row?.category_id ?? "",
    sub_category_id: row?.sub_category_id ?? "",
    price: row?.price === null || row?.price === undefined ? "" : String(row.price),
  }),
};

export default function ServicesPage() {
  return (
    <RequirePermission permission="services.manage">
      <CrudPage config={config} />
    </RequirePermission>
  );
}
