"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  Id,
  LookupService,
  LookupVideoType,
  Option,
  Quotation,
  QuotationItemInput,
  QuotationLookups,
  QuotationValidity,
  ServiceField,
} from "@/lib/erp/types";
import { ApiError, api } from "@/lib/erp/api";
import { useAuth } from "@/lib/erp/auth-context";
import { useApi } from "@/lib/erp/use-api";
import { useCalculation } from "@/lib/erp/use-calculation";
import { formatDate, formatMoney, trimNumber, unitSuffix } from "@/lib/erp/format";
import { cn } from "@/lib/erp/cn";
import { Alert, Card, CardHeader } from "../ui/Card";
import { Button } from "../ui/Button";
import { FormInput, RadioGroup, TextArea } from "../ui/FormInput";
import { Select } from "../ui/Select";
import { Icon } from "../ui/Icon";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../ui/Toast";
import { CalculationSummary } from "./CalculationSummary";
import { servicesSubject } from "./QuotationDocument";
import { PresetOrCustomInput, type PresetOrCustomValue } from "./PresetOrCustomInput";

const DEFAULT_LABELS: Record<ServiceField, string> = {
  artist_id: "Artist",
  video_type_id: "Video Type",
  language_id: "Language",
  source_language_id: "Source Language",
};

// Service-specific wording from the brief; the fields themselves come from the API.
const SERVICE_LABELS: Record<string, Partial<Record<ServiceField, string>>> = {
  "video-editing": { artist_id: "Video Editor" },
  "voice-over": { artist_id: "Voice Artist" },
  dubbing: { artist_id: "Dubbing Artist", language_id: "Dubbing Language" },
};

const VALIDITY_OPTIONS: Option[] = [
  { value: "15_days", label: "15 days" },
  { value: "1_month", label: "1 month" },
  { value: "custom", label: "Custom" },
];

/** The date a custom validity ends, counted from when the quotation was (or is being) issued. */
function customValidUntil(issuedAt: string | undefined, days: string): string | null {
  const count = Number(days);
  if (!Number.isInteger(count) || count < 1) return null;

  const date = issuedAt ? new Date(issuedAt) : new Date();
  date.setDate(date.getDate() + count);

  return formatDate(date.toISOString());
}

interface Draft {
  artist_id: string;
  video_type_id: string;
  language_id: string;
  source_language_id: string;
  /** Asked for only when the chosen video type requires a performer. */
  performer_id: string;
  /** Asked for only when the chosen video type has no fixed rate. */
  custom_price: string;
  duration: PresetOrCustomValue;
  quantity: PresetOrCustomValue;
}

const DURATION_UNITS: Option[] = [
  { value: "minutes", label: "minutes" },
  { value: "seconds", label: "seconds" },
];

interface ClientDetails {
  client_name: string;
  client_company: string;
  client_email: string;
  client_phone: string;
  client_gstin: string;
  client_address: string;
  notes: string;
}

/** Text printed on the quotation; editable per quotation. */
interface DocumentFields {
  subject: string;
  details: string;
  scope: string;
  included_services: string;
  terms: string;
  prepared_by_name: string;
  prepared_by_phone: string;
  validity: QuotationValidity;
  /** Number of days, typed in when validity is "custom". */
  validity_days: string;
  include_gst: boolean;
}

const GST_OPTIONS: Option[] = [
  { value: "yes", label: "With GST" },
  { value: "no", label: "Without GST" },
];

function emptyDraft(presets: number[] = [1]): Draft {
  return {
    artist_id: "",
    video_type_id: "",
    language_id: "",
    source_language_id: "",
    performer_id: "",
    custom_price: "",
    duration: { mode: "preset", preset: "", custom: "", unit: "minutes" },
    quantity: { mode: "preset", preset: presets.includes(1) ? "1" : "", custom: "" },
  };
}

/**
 * Lines with no base price, where the price must be typed in: a service with no
 * fields (e.g. Website, quoted per unit) or a custom-price video type.
 */
function needsPrice(service: LookupService, videoType: LookupVideoType | undefined): boolean {
  return service.fields.length === 0 || Boolean(videoType?.custom_price);
}

/** The line described by the draft, or null while it's incomplete. */
function buildItem(service: LookupService | undefined, draft: Draft, videoType: LookupVideoType | undefined): QuotationItemInput | null {
  if (!service?.is_quotable) return null;

  const item: QuotationItemInput = { service_id: service.id, quantity: 0 };

  for (const field of service.fields) {
    if (!draft[field]) return null;
    item[field] = draft[field];
  }

  if (videoType?.requires_performer) {
    if (!draft.performer_id) return null;
    item.performer_id = draft.performer_id;
  }

  // Blank = the base price from the pricing rules. Some lines have no base price to fall back on.
  if (draft.custom_price.trim() !== "") {
    const price = Number(draft.custom_price);
    if (!(price > 0)) return null;
    item.custom_price = price;
  } else if (needsPrice(service, videoType)) {
    return null;
  }

  if (service.fields.length > 0) {
    if (draft.duration.mode === "preset") {
      if (!draft.duration.preset) return null;
      item.duration_id = draft.duration.preset;
    } else {
      const amount = Number(draft.duration.custom);
      // Durations travel in minutes to 2 places; the API recovers whole seconds exactly.
      const minutes = draft.duration.unit === "seconds" ? Math.round((amount / 60) * 100) / 100 : amount;
      if (!(minutes > 0)) return null;
      item.duration_minutes = minutes;
    }
  }

  const quantity = Number(draft.quantity.mode === "preset" ? draft.quantity.preset : draft.quantity.custom);
  if (!Number.isInteger(quantity) || quantity < 1) return null;
  item.quantity = quantity;

  return item;
}

function toItemInput(line: NonNullable<Quotation["items"]>[number]): QuotationItemInput {
  return {
    service_id: line.service_id,
    artist_id: line.artist_id,
    language_id: line.language_id,
    source_language_id: line.source_language_id,
    video_type_id: line.video_type_id,
    performer_id: line.performer_id ?? null,
    // A per-unit line (e.g. Website) has no duration: it is saved as 0 minutes, and sent back without one
    ...(line.duration_id ? { duration_id: line.duration_id } : Number(line.duration_minutes) > 0 ? { duration_minutes: Number(line.duration_minutes) } : {}),
    quantity: line.quantity,
    custom_price: line.custom_price ?? null,
  };
}

function documentFromQuotation(q: Quotation): Partial<DocumentFields> {
  return {
    subject: q.subject ?? "",
    details: q.details ?? "",
    scope: q.scope ?? "",
    included_services: q.included_services ?? "",
    terms: q.terms ?? "",
    prepared_by_name: q.prepared_by_name ?? "",
    prepared_by_phone: q.prepared_by_phone ?? "",
    validity: q.validity,
    validity_days: q.validity_days ? String(q.validity_days) : "",
    include_gst: q.include_gst,
  };
}

/** Quotation generator: service tabs, service configuration, client details, document text and live summary. */
export function QuotationForm({ initial, prefill, leadId }: {
  initial?: Quotation;
  /** Client details to start a new quotation with (e.g. from a CRM lead) */
  prefill?: Partial<ClientDetails>;
  /** The CRM lead a new quotation is written for */
  leadId?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const lookupsQuery = useApi<{ data: QuotationLookups }>("/lookups/quotation-form");
  const lookups = lookupsQuery.data?.data;

  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [items, setItems] = useState<QuotationItemInput[]>(() => initial?.items?.map(toItemInput) ?? []);
  const [client, setClient] = useState<ClientDetails>(() => ({
    client_name: initial?.client_name ?? prefill?.client_name ?? "",
    client_company: initial?.client_company ?? prefill?.client_company ?? "",
    client_email: initial?.client_email ?? prefill?.client_email ?? "",
    client_phone: initial?.client_phone ?? prefill?.client_phone ?? "",
    client_gstin: initial?.client_gstin ?? "",
    client_address: initial?.client_address ?? prefill?.client_address ?? "",
    notes: initial?.notes ?? "",
  }));
  // Only fields the user has touched (or loaded from an existing quotation); the rest fall back to defaults.
  const [doc, setDoc] = useState<Partial<DocumentFields>>(() => (initial ? documentFromQuotation(initial) : {}));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiError | null>(null);

  const services = lookups?.services ?? [];
  const activeService = services.find((s) => s.slug === activeSlug) ?? services.find((s) => s.is_quotable) ?? services[0];
  const selectedVideoType = activeService?.fields.includes("video_type_id")
    ? lookups?.video_types.find((v) => String(v.id) === draft.video_type_id)
    : undefined;
  const draftItem = buildItem(activeService, draft, selectedVideoType);

  const includeGst = doc.include_gst ?? true;
  const preview = useCalculation(draftItem ? [draftItem] : null, includeGst);
  const totals = useCalculation(items.length > 0 ? items : null, includeGst);

  const lineError = (field: string) => preview.error?.field(`items.0.${field}`);
  const previewProblem = preview.error && (preview.error.field("items.0.service_id") ?? (preview.error.status !== 422 ? preview.error.message : undefined));

  if (lookupsQuery.error && !lookups) {
    return <Alert>{lookupsQuery.error.message}</Alert>;
  }

  if (!lookups || !activeService) {
    return (
      <div className="flex justify-center py-20">
        <Spinner label="Loading services…" />
      </div>
    );
  }

  const documentDefaults: DocumentFields = {
    subject: "",
    details: "",
    scope: "",
    included_services: "",
    terms: lookups.document.terms,
    prepared_by_name: user.name,
    prepared_by_phone: user.employee?.phone ?? "",
    validity: "15_days",
    validity_days: "",
    include_gst: true,
  };
  const document: DocumentFields = { ...documentDefaults, ...doc };

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const setClientField = (field: keyof ClientDetails) => (e: { target: { value: string } }) =>
    setClient((current) => ({ ...current, [field]: e.target.value }));
  const setDocField = (field: keyof DocumentFields) => (e: { target: { value: string } }) =>
    setDoc((current) => ({ ...current, [field]: e.target.value }));

  function selectService(slug: string) {
    setActiveSlug(slug);
    // Artists and video types differ per service; keep language, duration and quantity.
    setDraft((current) => ({ ...current, artist_id: "", video_type_id: "", performer_id: "", custom_price: "" }));
  }

  /** Picking an artist clears a language that artist doesn't perform in. */
  function selectArtist(artistId: string) {
    const artist = activeService.artists.find((a) => String(a.id) === artistId);
    const covered = !artist || artist.language_ids.length === 0 || artist.language_ids.some((id) => String(id) === draft.language_id);
    update({ artist_id: artistId, ...(covered ? {} : { language_id: "" }) });
  }

  function addToQuotation() {
    if (!draftItem || !preview.data) return;
    setItems((current) => [...current, draftItem]);
    setDraft(emptyDraft(lookups?.quantity_presets));
    toast.success(`${activeService?.name} added to the quotation.`);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);

    const payload = {
      ...client,
      ...document,
      validity_days: document.validity === "custom" && document.validity_days !== "" ? Number(document.validity_days) : null,
      ...(!initial && leadId ? { lead_id: leadId } : {}),
      items,
    };

    try {
      const response = initial
        ? await api.put<{ data: Quotation }>(`/quotations/${initial.id}`, payload)
        : await api.post<{ data: Quotation }>("/quotations", payload);

      toast.success(`Quotation ${response.data.quotation_number} ${initial ? "updated" : "created"}.`);
      router.push(`/quotations/${response.data.id}`);
    } catch (error) {
      setSaveError(error as ApiError);
      setSaving(false);
    }
  }

  // The price box: blank uses the base price from the pricing rules; a typed
  // price replaces it in the same unit (per unit when there is no base price).
  const previewLine = preview.data?.items[0];
  const priceRequired = needsPrice(activeService, selectedVideoType);
  const priceUnit = previewLine?.unit ?? (priceRequired ? "per_unit" : null);
  const priceHint = selectedVideoType?.custom_price
    ? `${selectedVideoType.name} has no fixed rate. Enter the price per unit; it's multiplied by the quantity.`
    : activeService.fields.length === 0
      ? `Enter the price for ${activeService.name} per unit; it's multiplied by the quantity.`
      : previewLine?.base_price
        ? `Base price ${formatMoney(previewLine.base_price, preview.data?.currency)} ${unitSuffix(previewLine.unit)}. Leave blank to use it, or enter your own rate.`
        : previewLine
          ? "No base price for this selection; your price is per unit."
          : previewProblem
            ? "No base price for this selection. Enter a price per unit to quote it."
            : "Leave blank to use the base price.";

  const labels = { ...DEFAULT_LABELS, ...SERVICE_LABELS[activeService.slug] };
  const languageOptions: Option[] = lookups.languages.map((l) => ({ value: String(l.id), label: l.name }));
  // Artists are identified by code only — their real names never leave the admin screens.
  const selectedArtist = activeService.artists.find((a) => String(a.id) === draft.artist_id);
  // An artist with no languages recorded is offered for every language.
  const spokenLanguages =
    selectedArtist && selectedArtist.language_ids.length > 0
      ? languageOptions.filter((o) => selectedArtist.language_ids.some((id) => String(id) === o.value))
      : languageOptions;
  const fieldOptions: Record<ServiceField, Option[]> = {
    artist_id: activeService.artists.map((a) => ({ value: String(a.id), label: a.code })),
    video_type_id: lookups.video_types.map((v) => ({ value: String(v.id), label: v.name })),
    source_language_id: languageOptions,
    // The dubbing language can't be the same as the source language.
    language_id: spokenLanguages.filter((o) => !(activeService.fields.includes("source_language_id") && o.value === draft.source_language_id)),
  };

  // Coordination assigns artists to saved lines straight from the summary.
  const artistOptions: Record<Id, Option[]> = Object.fromEntries(
    services.map((service) => [service.id, service.artists.map((a) => ({ value: a.id, label: a.code }))]),
  );

  function assignArtist(index: number, artistId: string) {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, artist_id: artistId || undefined } : item)));
  }

  const summaryMode = items.length > 0 ? "quotation" : "preview";
  const summary = summaryMode === "quotation" ? totals : preview;
  const itemErrors = saveError ? Object.entries(saveError.errors).filter(([key]) => key.startsWith("items")) : [];
  const fieldError = (name: string) => saveError?.field(name);
  const autoSubject = servicesSubject(totals.data?.items ?? []);

  return (
    <div className="space-y-6">
      {/* Services */}
      <Card>
        <CardHeader title="Services" description="Choose the service to configure. Add as many services as the quotation needs." />
        <div className="flex flex-wrap gap-2 p-4" role="tablist">
          {services.map((service) => (
            <button
              key={service.id}
              type="button"
              role="tab"
              aria-selected={service.id === activeService.id}
              onClick={() => selectService(service.slug)}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors",
                service.id === activeService.id
                  ? "border-ink bg-brand text-ink shadow-sm"
                  : "border-neutral-200 bg-paper text-neutral-700 hover:border-ink hover:bg-brand/15",
              )}
            >
              {service.name}
              {!service.is_quotable && (
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] uppercase", service.id === activeService.id ? "bg-ink/10" : "bg-neutral-100 text-neutral-500")}>
                  Soon
                </span>
              )}
            </button>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Configure service */}
          <Card>
            <CardHeader title="Configure Service Details" description={activeService.name} />
            {activeService.is_quotable ? (
              <>
                <div className="grid gap-4 p-5 sm:grid-cols-2">
                  {activeService.fields.map((field) => (
                    <Fragment key={field}>
                      <Select
                        label={labels[field]}
                        required
                        placeholder={`Select ${labels[field].toLowerCase()}`}
                        options={fieldOptions[field]}
                        value={draft[field]}
                        onChange={(value) => (field === "artist_id" ? selectArtist(value) : update({ [field]: value } as Partial<Draft>))}
                        error={lineError(field)}
                        hint={field === "artist_id" && fieldOptions.artist_id.length === 0 ? "No active artists for this service yet." : undefined}
                      />
                      {field === "video_type_id" && selectedVideoType?.requires_performer && (
                        <Select
                          label="Performer"
                          required
                          placeholder="Select performer"
                          options={lookups.performers.map((p) => ({ value: String(p.id), label: p.code }))}
                          value={draft.performer_id}
                          onChange={(performer_id) => update({ performer_id })}
                          error={lineError("performer_id")}
                          hint={`The rate for ${selectedVideoType.name} depends on who performs.`}
                        />
                      )}
                    </Fragment>
                  ))}
                  {activeService.fields.length > 0 && (
                    <PresetOrCustomInput
                      label="Duration"
                      required
                      placeholder="Select duration"
                      customLabel="Custom duration…"
                      units={DURATION_UNITS}
                      step="any"
                      min="0.01"
                      options={lookups.durations.map((d) => ({ value: String(d.id), label: d.label }))}
                      value={draft.duration}
                      onChange={(duration) => update({ duration })}
                      error={lineError("duration_id") ?? lineError("duration_minutes")}
                    />
                  )}
                  <PresetOrCustomInput
                    label="Quantity"
                    required
                    placeholder="Select quantity"
                    customLabel="Custom quantity…"
                    step="1"
                    min="1"
                    options={lookups.quantity_presets.map((q) => ({ value: String(q), label: String(q) }))}
                    value={draft.quantity}
                    onChange={(quantity) => update({ quantity })}
                    error={lineError("quantity")}
                  />
                  <FormInput
                    label={priceUnit ? `Price (₹ ${unitSuffix(priceUnit)})` : "Price (₹)"}
                    required={priceRequired}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0.01"
                    placeholder={previewLine?.base_price ? trimNumber(previewLine.base_price) : priceRequired ? "Enter price" : "Base price"}
                    value={draft.custom_price}
                    onChange={(e) => update({ custom_price: e.target.value })}
                    error={lineError("custom_price")}
                    hint={priceHint}
                  />
                </div>

                {previewProblem && (
                  <div className="px-5 pb-2">
                    <Alert tone="warning">{previewProblem}</Alert>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-neutral-200 bg-neutral-50 px-5 py-3">
                  <p className="text-sm text-neutral-600">
                    {preview.loading ? (
                      "Calculating…"
                    ) : preview.data ? (
                      <>
                        Price for this service:{" "}
                        <span className="font-semibold text-ink">{formatMoney(preview.data.items[0].line_total, preview.data.currency)}</span>
                        {includeGst && lookups.tax.enabled && <span className="text-neutral-400"> + {lookups.tax.label}</span>}
                      </>
                    ) : (
                      "Complete all fields to see the price."
                    )}
                  </p>
                  <Button onClick={addToQuotation} disabled={!draftItem || !preview.data || preview.loading}>
                    <Icon name="plus" className="h-4 w-4" />
                    Add to quotation
                  </Button>
                </div>
              </>
            ) : (
              <div className="px-5 py-12 text-center">
                <Icon name="clock" className="mx-auto h-8 w-8 text-neutral-300" />
                <p className="mt-3 text-sm font-medium text-ink">{activeService.name} pricing is not set up yet</p>
                <p className="mt-1 text-sm text-neutral-500">The fields and pricing rules for this service will be defined later.</p>
              </div>
            )}
          </Card>

          {/* Client */}
          <Card>
            <CardHeader title="Client Details" description="Only the client name is required." />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <FormInput label="Client name" required value={client.client_name} onChange={setClientField("client_name")} error={fieldError("client_name")} hint="Printed after “To,” e.g. Paresh Sir" />
              <FormInput label="Company" value={client.client_company} onChange={setClientField("client_company")} error={fieldError("client_company")} />
              <FormInput label="Email" type="email" value={client.client_email} onChange={setClientField("client_email")} error={fieldError("client_email")} />
              <FormInput label="Phone" value={client.client_phone} onChange={setClientField("client_phone")} error={fieldError("client_phone")} />
              <FormInput label="GSTIN" value={client.client_gstin} onChange={setClientField("client_gstin")} error={fieldError("client_gstin")} maxLength={15} />
              <TextArea label="Address" className="sm:col-span-2" value={client.client_address} onChange={setClientField("client_address")} error={fieldError("client_address")} />
            </div>
          </Card>

          {/* Document */}
          <Card>
            <CardHeader title="Quotation Document" description="Printed on the letterhead. The terms default from Settings and can be changed for this quotation." />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <FormInput
                className="sm:col-span-2"
                label="Quotation for"
                placeholder={autoSubject || "e.g. AI and Green Screen Video Development"}
                value={document.subject}
                onChange={setDocField("subject")}
                error={fieldError("subject")}
                hint={autoSubject ? `Leave blank to print “Quotation for ${autoSubject}”.` : "Leave blank to use the services you add."}
              />
              <TextArea
                className="sm:col-span-2"
                label="Details"
                rows={5}
                placeholder="Describe the project or your company — printed under “Quotation for …”."
                value={document.details}
                onChange={setDocField("details")}
                error={fieldError("details")}
                hint={
                  lookups.document.details ? (
                    <button
                      type="button"
                      onClick={() => setDoc((current) => ({ ...current, details: lookups.document.details }))}
                      className="font-medium text-ink underline decoration-brand decoration-2 underline-offset-2 hover:decoration-ink"
                    >
                      Insert standard company introduction
                    </button>
                  ) : undefined
                }
              />
              <TextArea
                className="sm:col-span-2"
                label="Project scope (client requirements)"
                rows={3}
                placeholder="e.g. The project covers the complete development of AI Videos and Green Screen Videos with professional production quality."
                value={document.scope}
                onChange={setDocField("scope")}
                error={fieldError("scope")}
              />
              <TextArea
                className="sm:col-span-2"
                label="Included services"
                rows={4}
                placeholder={"One per line, e.g.\nAI Video Development\nProfessional Voice Over (Language/Accent as required)"}
                value={document.included_services}
                onChange={setDocField("included_services")}
                error={fieldError("included_services")}
                hint="Printed as a bullet list under Project Scope."
              />
              <div className="sm:col-span-2">
                <RadioGroup
                  label="GST"
                  name="include_gst"
                  options={GST_OPTIONS}
                  value={document.include_gst ? "yes" : "no"}
                  onChange={(value) => setDoc((current) => ({ ...current, include_gst: value === "yes" }))}
                  error={fieldError("include_gst")}
                  hint={document.include_gst ? `${lookups.tax.label} at ${lookups.tax.rate}% is added to the subtotal.` : "No GST is added; the grand total equals the subtotal."}
                />
              </div>
              <div className="sm:col-span-2">
                <RadioGroup
                  label="Valid for"
                  name="validity"
                  options={VALIDITY_OPTIONS}
                  value={document.validity}
                  onChange={(value) => setDoc((current) => ({ ...current, validity: value as QuotationValidity }))}
                  error={fieldError("validity")}
                />
                {document.validity === "custom" && (
                  <FormInput
                    className="mt-3 max-w-xs"
                    label="Number of days"
                    required
                    type="number"
                    inputMode="numeric"
                    step="1"
                    min="1"
                    max="365"
                    autoFocus={!initial}
                    placeholder="e.g. 1"
                    value={document.validity_days}
                    onChange={setDocField("validity_days")}
                    error={fieldError("validity_days")}
                    hint={(() => {
                      const until = customValidUntil(initial?.created_at, document.validity_days);
                      return until ? `Valid until ${until}.` : "Between 1 and 365 days.";
                    })()}
                  />
                )}
              </div>
              <TextArea
                className="sm:col-span-2"
                label="Terms & conditions"
                rows={6}
                value={document.terms}
                onChange={setDocField("terms")}
                error={fieldError("terms")}
                hint="One term per line."
              />
              <FormInput label="Prepared by" value={document.prepared_by_name} onChange={setDocField("prepared_by_name")} error={fieldError("prepared_by_name")} />
              <FormInput
                label="Prepared by — phone"
                value={document.prepared_by_phone}
                onChange={setDocField("prepared_by_phone")}
                error={fieldError("prepared_by_phone")}
                placeholder="+91 70488 13189"
              />
              <TextArea
                className="sm:col-span-2"
                label="Internal notes"
                value={client.notes}
                onChange={setClientField("notes")}
                error={fieldError("notes")}
                hint="For your team only — not printed on the quotation."
              />
            </div>
          </Card>
        </div>

        {/* Summary */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <CalculationSummary
            calculation={summary.data}
            loading={summary.loading}
            mode={summaryMode}
            onRemove={summaryMode === "quotation" ? (index) => setItems((current) => current.filter((_, i) => i !== index)) : undefined}
            artistOptions={artistOptions}
            onAssignArtist={summaryMode === "quotation" ? assignArtist : undefined}
            footer={
              <div className="space-y-3">
                {saveError && (saveError.status !== 422 || itemErrors.length > 0) && <Alert>{itemErrors[0]?.[1][0] ?? saveError.message}</Alert>}
                {saveError?.status === 422 && itemErrors.length === 0 && <Alert>Please correct the highlighted fields.</Alert>}
                {totals.error && <Alert>{Object.values(totals.error.errors)[0]?.[0] ?? totals.error.message}</Alert>}
                {items.length === 0 && (
                  <p className="text-xs text-neutral-500">
                    {preview.data ? "Click “Add to quotation” to include this service." : "Add at least one service to save the quotation."}
                  </p>
                )}
                <Button className="w-full" onClick={save} loading={saving} disabled={items.length === 0 || totals.loading || Boolean(totals.error)}>
                  {initial ? "Save changes" : "Save quotation"}
                </Button>
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}
