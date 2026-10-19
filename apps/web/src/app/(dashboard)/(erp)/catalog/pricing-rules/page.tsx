"use client";

import { ActiveBadge, CrudPage, defaultPayload, type CrudConfig, type CrudField, type FormValues, type Sources } from "@/components/erp/admin/CrudPage";
import { RequirePermission } from "@/components/erp/RequirePermission";
import type { Id, PricingUnit, QuotationLookups } from "@/lib/erp/types";
import { formatDate, formatMoney, trimNumber, unitSuffix } from "@/lib/erp/format";

interface Named {
  id: Id;
  name: string;
}

interface PricingRule {
  id: Id;
  name: string | null;
  service: Named & { slug: string };
  artist: (Named & { code: string }) | null;
  language: Named | null;
  source_language: Named | null;
  video_type: Named | null;
  performer: (Named & { code: string }) | null;
  unit: PricingUnit;
  base_price: string;
  cost_price: string | null;
  min_quantity: number;
  min_duration_minutes: string | null;
  max_duration_minutes: string | null;
  effective_from: string | null;
  effective_to: string | null;
  priority: number;
  is_active: boolean;
  notes: string | null;
}

const form = (s: Sources) => s.form as QuotationLookups | null | undefined;
const serviceSlug = (v: FormValues, s: Sources) => form(s)?.services.find((svc) => String(svc.id) === v.service_id)?.slug;
/** Whether the chosen service asks for a language (video editing doesn't). */
const usesLanguage = (v: FormValues, s: Sources) => form(s)?.services.find((svc) => String(svc.id) === v.service_id)?.fields.includes("language_id") ?? true;

function conditions(row: PricingRule): string {
  const parts = [
    row.source_language && row.language ? `${row.source_language.name} → ${row.language.name}` : row.language?.name,
    row.video_type?.name,
    row.performer?.code,
    row.min_duration_minutes || row.max_duration_minutes
      ? `${row.min_duration_minutes ? trimNumber(row.min_duration_minutes) : "0"}–${row.max_duration_minutes ? trimNumber(row.max_duration_minutes) : "∞"} min`
      : null,
    row.min_quantity > 1 ? `qty ≥ ${row.min_quantity}` : null,
    row.effective_from || row.effective_to ? `${formatDate(row.effective_from)} – ${row.effective_to ? formatDate(row.effective_to) : "open"}` : null,
  ].filter(Boolean);

  return parts.length ? parts.join(" · ") : "Any";
}

const fields: CrudField[] = [
  {
    name: "service_id",
    label: "Service",
    type: "select",
    required: true,
    options: (s) => form(s)?.services.filter((svc) => svc.is_quotable).map((svc) => ({ value: String(svc.id), label: svc.name })) ?? [],
  },
  {
    name: "artist_id",
    label: "Artist",
    type: "select",
    placeholder: "Any artist",
    options: (s, v) =>
      form(s)?.services.find((svc) => String(svc.id) === v.service_id)?.artists.map((a) => ({ value: String(a.id), label: `${a.code} — ${a.name}` })) ?? [],
  },
  {
    name: "video_type_id",
    label: "Video type",
    type: "select",
    placeholder: "Any video type",
    visible: (v, s) => serviceSlug(v, s) === "video-editing",
    options: (s) => form(s)?.video_types.map((t) => ({ value: String(t.id), label: t.name })) ?? [],
  },
  {
    name: "performer_id",
    label: "Performer",
    type: "select",
    placeholder: "Any performer",
    hint: "Only applies to video types that require a performer.",
    visible: (v, s) => serviceSlug(v, s) === "video-editing",
    options: (s) => form(s)?.performers.map((p) => ({ value: String(p.id), label: `${p.code} — ${p.name}` })) ?? [],
  },
  {
    name: "source_language_id",
    label: "Source language",
    type: "select",
    placeholder: "Any source language",
    visible: (v, s) => serviceSlug(v, s) === "dubbing",
    options: (s) => form(s)?.languages.map((l) => ({ value: String(l.id), label: l.name })) ?? [],
  },
  {
    name: "language_id",
    label: "Language",
    type: "select",
    placeholder: "Any language",
    hint: "For dubbing, this is the dubbing (target) language.",
    visible: usesLanguage,
    options: (s) => form(s)?.languages.map((l) => ({ value: String(l.id), label: l.name })) ?? [],
  },
  {
    name: "unit",
    label: "Pricing unit",
    type: "select",
    required: true,
    options: () => [
      { value: "per_minute", label: "Per minute (price × minutes × qty)" },
      { value: "per_second", label: "Per second (price × seconds × qty)" },
      { value: "per_unit", label: "Per unit (price × qty)" },
    ],
  },
  { name: "base_price", label: "Base price (₹)", type: "number", required: true, step: "0.01" },
  { name: "cost_price", label: "Cost price (₹)", type: "number", step: "0.01", hint: "Internal only — never shown on quotations." },
  { name: "min_duration_minutes", label: "Min duration (minutes)", type: "number", step: "0.01" },
  { name: "max_duration_minutes", label: "Max duration (minutes)", type: "number", step: "0.01" },
  { name: "min_quantity", label: "Minimum quantity", type: "number", step: "1" },
  { name: "priority", label: "Priority", type: "number", step: "1", hint: "Higher wins when several rules match." },
  { name: "effective_from", label: "Effective from", type: "date" },
  { name: "effective_to", label: "Effective to", type: "date" },
  { name: "name", label: "Label (optional)", type: "text", wide: true, placeholder: "e.g. Hindi standard rate" },
  { name: "notes", label: "Notes", type: "textarea" },
  { name: "is_active", label: "Active", type: "checkbox" },
];

const config: CrudConfig<PricingRule> = {
  title: "Pricing Rules",
  description:
    "Base prices used by the quotation calculator. Leave a condition empty to match anything; when several rules match, the highest priority wins, then the most specific rule.",
  endpoint: "/admin/pricing-rules",
  singular: "Pricing rule",
  searchPlaceholder: "Search",
  activeFilter: true,
  sources: { form: "/lookups/quotation-form" },
  filters: [
    {
      name: "service_id",
      label: "Services",
      options: (s) => form(s)?.services.map((svc) => ({ value: String(svc.id), label: svc.name })) ?? [],
    },
  ],
  recordLabel: (row) => row.name || `${row.service.name}${row.artist ? ` — ${row.artist.code}` : ""}`,
  columns: [
    {
      key: "service",
      header: "Service / Artist",
      cell: (row) => (
        <div>
          <p className="font-medium text-neutral-900">{row.service.name}</p>
          <p className="text-xs text-neutral-500">{row.artist ? `${row.artist.code} · ${row.artist.name}` : "Any artist"}</p>
          {row.name && <p className="text-xs text-neutral-400">{row.name}</p>}
        </div>
      ),
    },
    { key: "conditions", header: "Conditions", cell: (row) => <span className="text-xs">{conditions(row)}</span> },
    {
      key: "price",
      header: "Base price",
      className: "text-right",
      cell: (row) => (
        <div>
          <p className="font-medium text-neutral-900">
            {formatMoney(row.base_price)}
            <span className="text-xs font-normal text-neutral-500"> {unitSuffix(row.unit)}</span>
          </p>
          {row.cost_price && <p className="text-xs text-neutral-400">Cost {formatMoney(row.cost_price)}</p>}
        </div>
      ),
    },
    { key: "priority", header: "Priority", cell: (row) => row.priority, className: "text-center" },
    { key: "active", header: "Status", cell: (row) => <ActiveBadge active={row.is_active} /> },
  ],
  fields,
  toForm: (row) => ({
    service_id: row ? String(row.service.id) : "",
    artist_id: row?.artist ? String(row.artist.id) : "",
    video_type_id: row?.video_type ? String(row.video_type.id) : "",
    performer_id: row?.performer ? String(row.performer.id) : "",
    source_language_id: row?.source_language ? String(row.source_language.id) : "",
    language_id: row?.language ? String(row.language.id) : "",
    unit: row?.unit ?? "per_minute",
    base_price: row ? trimNumber(row.base_price) : "",
    cost_price: row?.cost_price ? trimNumber(row.cost_price) : "",
    min_duration_minutes: row?.min_duration_minutes ? trimNumber(row.min_duration_minutes) : "",
    max_duration_minutes: row?.max_duration_minutes ? trimNumber(row.max_duration_minutes) : "",
    min_quantity: String(row?.min_quantity ?? 1),
    priority: String(row?.priority ?? 0),
    effective_from: row?.effective_from ?? "",
    effective_to: row?.effective_to ?? "",
    name: row?.name ?? "",
    notes: row?.notes ?? "",
    is_active: row?.is_active ?? true,
  }),
  // Conditions that don't apply to the chosen service are cleared rather than kept from an earlier choice.
  toPayload: (values, _record, sources) => {
    const payload = defaultPayload(fields, values);
    const slug = serviceSlug(values, sources);

    if (slug !== "dubbing") payload.source_language_id = null;
    if (!usesLanguage(values, sources)) payload.language_id = null;
    if (slug !== "video-editing") {
      payload.video_type_id = null;
      payload.performer_id = null;
    }

    return payload;
  },
};

export default function PricingRulesPage() {
  return (
    <RequirePermission permission="pricing.manage">
      <CrudPage config={config} />
    </RequirePermission>
  );
}
