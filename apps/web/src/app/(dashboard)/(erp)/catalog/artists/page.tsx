"use client";

import { ActiveBadge, CrudPage, type CrudConfig } from "@/components/erp/admin/CrudPage";
import { RequirePermission } from "@/components/erp/RequirePermission";
import { Badge } from "@/components/erp/ui/Badge";
import type { Id } from "@/lib/erp/types";

interface Artist {
  id: Id;
  code: string;
  name: string;
  gender: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  is_active: boolean;
  services: { id: Id; name: string; slug: string }[];
  languages: { id: Id; name: string }[];
  pricing_rules_count: number;
}

type ServiceOption = { id: Id; name: string; status: string };
type LanguageOption = { id: Id; name: string };

const config: CrudConfig<Artist> = {
  title: "Artists",
  description:
    "Video editors, voice artists and dubbing artists. Link each artist to the services they provide and the languages they perform in. Quotations show the artist code only — the name stays here.",
  endpoint: "/admin/artists",
  singular: "Artist",
  searchPlaceholder: "Search code or name",
  activeFilter: true,
  sources: { services: "/services", languages: "/languages" },
  filters: [
    {
      name: "service_id",
      label: "Services",
      options: (s) => ((s.services as ServiceOption[] | null) ?? []).map((svc) => ({ value: String(svc.id), label: svc.name })),
    },
  ],
  recordLabel: (row) => `${row.code} — ${row.name}`,
  columns: [
    { key: "code", header: "Code", cell: (row) => <span className="font-mono text-xs font-medium text-neutral-900">{row.code}</span> },
    { key: "name", header: "Name", cell: (row) => <span className="font-medium text-neutral-900">{row.name}</span> },
    { key: "gender", header: "Gender", cell: (row) => <span className="capitalize text-neutral-600">{row.gender ?? "—"}</span> },
    {
      key: "languages",
      header: "Languages",
      cell: (row) =>
        row.languages.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.languages.map((lang) => (
              <Badge key={lang.id} tone="soft">
                {lang.name}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-neutral-400">All</span>
        ),
    },
    {
      key: "services",
      header: "Services",
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.services.map((svc) => (
            <Badge key={svc.id} tone="soft">
              {svc.name}
            </Badge>
          ))}
        </div>
      ),
    },
    { key: "rules", header: "Pricing rules", cell: (row) => row.pricing_rules_count, className: "text-center" },
    { key: "active", header: "Status", cell: (row) => <ActiveBadge active={row.is_active} /> },
  ],
  fields: [
    { name: "code", label: "Artist code", type: "text", required: true, placeholder: "e.g. VO_F_DP0002" },
    { name: "name", label: "Name", type: "text", required: true },
    {
      name: "gender",
      label: "Gender",
      type: "select",
      placeholder: "Not specified",
      hint: "Recorded for reference only; quotations are never filtered by gender.",
      options: () => [
        { value: "female", label: "Female" },
        { value: "male", label: "Male" },
        { value: "other", label: "Other" },
      ],
    },
    { name: "phone", label: "Phone", type: "text" },
    { name: "email", label: "Email", type: "email", wide: true },
    {
      name: "service_ids",
      label: "Services provided",
      type: "multiselect",
      required: true,
      options: (s) => ((s.services as ServiceOption[] | null) ?? []).map((svc) => ({ value: String(svc.id), label: svc.name })),
    },
    {
      name: "language_ids",
      label: "Languages performed",
      type: "multiselect",
      hint: "Leave empty to offer this artist for every language.",
      options: (s) => ((s.languages as LanguageOption[] | null) ?? []).map((lang) => ({ value: String(lang.id), label: lang.name })),
    },
    { name: "notes", label: "Notes", type: "textarea" },
    { name: "is_active", label: "Active", type: "checkbox", hint: "Inactive artists are hidden from new quotations." },
  ],
  toForm: (row) => ({
    code: row?.code ?? "",
    name: row?.name ?? "",
    gender: row?.gender ?? "",
    phone: row?.phone ?? "",
    email: row?.email ?? "",
    service_ids: row?.services.map((svc) => String(svc.id)) ?? [],
    language_ids: row?.languages.map((lang) => String(lang.id)) ?? [],
    notes: row?.notes ?? "",
    is_active: row?.is_active ?? true,
  }),
};

export default function ArtistsPage() {
  return (
    <RequirePermission permission="artists.manage">
      <CrudPage config={config} />
    </RequirePermission>
  );
}
