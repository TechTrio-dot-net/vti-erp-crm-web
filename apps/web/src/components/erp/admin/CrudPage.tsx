"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import type { Id, Option, Paginated } from "@/lib/erp/types";
import { ApiError, api, withQuery } from "@/lib/erp/api";
import { useApi } from "@/lib/erp/use-api";
import { cn } from "@/lib/erp/cn";
import { DataTable, type Column } from "../DataTable";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Alert, PageHeader } from "../ui/Card";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Checkbox, Field, FormInput, TextArea, inputClass } from "../ui/FormInput";
import { Icon } from "../ui/Icon";
import { Modal } from "../ui/Modal";
import { Select } from "../ui/Select";
import { useToast } from "../ui/Toast";

export type FormValue = string | boolean | string[];
export type FormValues = Record<string, FormValue>;
/** Data loaded from `CrudConfig.sources`, keyed by source name (the response's `data`). */
export type Sources = Record<string, unknown>;

export interface CrudField {
  name: string;
  label: string;
  type: "text" | "email" | "number" | "textarea" | "checkbox" | "select" | "multiselect" | "date" | "password";
  required?: boolean;
  placeholder?: string;
  hint?: string;
  step?: string;
  options?: (sources: Sources, values: FormValues) => Option[];
  /** Multiselect payload type: record ids (default) or plain strings. */
  valueType?: "id" | "string";
  visible?: (values: FormValues, sources: Sources) => boolean;
  wide?: boolean;
}

export interface CrudFilter {
  name: string;
  label: string;
  options: (sources: Sources) => Option[];
}

export interface CrudConfig<T> {
  title: string;
  description?: string;
  /** e.g. "/admin/languages" — must support index/store/update/destroy. */
  endpoint: string;
  singular: string;
  columns: Column<T>[];
  fields: CrudField[];
  /** Form values for a record, or defaults for a new one. */
  toForm: (record: T | null) => FormValues;
  toPayload?: (values: FormValues, record: T | null, sources: Sources) => Record<string, unknown>;
  /** Extra data for dropdowns: name → API path returning `{ data }`. */
  sources?: Record<string, string>;
  filters?: CrudFilter[];
  activeFilter?: boolean;
  searchPlaceholder?: string;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean | ((row: T) => boolean);
  recordLabel: (row: T) => string;
}

/** Converts form values to an API payload: "" → null, numbers parsed, multiselects as ids. */
export function defaultPayload(fields: CrudField[], values: FormValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const field of fields) {
    const value = values[field.name];

    if (field.type === "checkbox") payload[field.name] = Boolean(value);
    else if (field.type === "multiselect") payload[field.name] = Array.isArray(value) ? (field.valueType === "string" ? value : value.map(Number)) : [];
    else if (value === "" || value === undefined) payload[field.name] = null;
    else if (field.type === "number") payload[field.name] = Number(value);
    else payload[field.name] = value;
  }

  return payload;
}

export function ActiveBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? "brand" : "muted"}>{active ? "Active" : "Inactive"}</Badge>;
}

function useSources(paths?: Record<string, string>): Sources {
  const key = paths ? JSON.stringify(paths) : "";
  const [state, setState] = useState<{ key: string; data: Sources }>({ key: "", data: {} });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const entries = Object.entries(JSON.parse(key) as Record<string, string>);

    Promise.all(
      entries.map(([name, path]) =>
        api
          .get<{ data: unknown }>(path)
          .then((response) => [name, response.data] as const)
          .catch(() => [name, null] as const),
      ),
    ).then((results) => !cancelled && setState({ key, data: Object.fromEntries(results) }));

    return () => {
      cancelled = true;
    };
  }, [key]);

  return state.data;
}

/** Generic list + create/edit modal + delete for admin-managed data. */
export function CrudPage<T extends { id: Id }>({ config }: { config: CrudConfig<T> }) {
  const toast = useToast();
  const sources = useSources(config.sources);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState("");
  // Filters can be pre-set from the URL, e.g. /admin/artists?service_id=2.
  const searchParams = useSearchParams()!;
  const [filters, setFilters] = useState<Record<string, string>>(() =>
    Object.fromEntries((config.filters ?? []).map((filter) => [filter.name, searchParams.get(filter.name) ?? ""])),
  );
  const [editing, setEditing] = useState<{ record: T | null } | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [formError, setFormError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<T | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const list = useApi<Paginated<T>>(withQuery(config.endpoint, { page, search, is_active: active, per_page: 25, ...filters }));

  const canEdit = config.canEdit ?? true;
  const canDelete = (row: T) => (typeof config.canDelete === "function" ? config.canDelete(row) : (config.canDelete ?? true));
  const visibleFields = config.fields.filter((field) => !field.visible || field.visible(values, sources));

  function openForm(record: T | null) {
    setValues(config.toForm(record));
    setFormError(null);
    setEditing({ record });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;

    setSaving(true);
    setFormError(null);
    const payload = config.toPayload ? config.toPayload(values, editing.record, sources) : defaultPayload(visibleFields, values);

    try {
      if (editing.record) await api.put(`${config.endpoint}/${editing.record.id}`, payload);
      else await api.post(config.endpoint, payload);

      toast.success(`${config.singular} ${editing.record ? "updated" : "created"}.`);
      setEditing(null);
      list.reload();
    } catch (error) {
      setFormError(error as ApiError);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);

    try {
      await api.delete(`${config.endpoint}/${deleting.id}`);
      toast.success(`${config.singular} deleted.`);
      list.reload();
    } catch (error) {
      toast.error((error as ApiError).message);
    } finally {
      setDeleteBusy(false);
      setDeleting(null);
    }
  }

  const columns: Column<T>[] = [
    ...config.columns,
    ...(canEdit || config.canDelete !== false
      ? [
          {
            key: "_actions",
            header: <span className="sr-only">Actions</span>,
            className: "w-24 text-right",
            cell: (row: T) => (
              <div className="flex justify-end gap-1">
                {canEdit && (
                  <button onClick={() => openForm(row)} className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" aria-label={`Edit ${config.recordLabel(row)}`}>
                    <Icon name="pencil" className="h-4 w-4" />
                  </button>
                )}
                {canDelete(row) && (
                  <button onClick={() => setDeleting(row)} className="rounded p-1.5 text-neutral-400 hover:bg-ink hover:text-paper" aria-label={`Delete ${config.recordLabel(row)}`}>
                    <Icon name="trash" className="h-4 w-4" />
                  </button>
                )}
              </div>
            ),
          },
        ]
      : []),
  ];

  const hasGeneralError = formError && (formError.status !== 422 || Object.keys(formError.errors).every((key) => !visibleFields.some((f) => key === f.name || key.startsWith(`${f.name}.`))));

  return (
    <>
      <PageHeader
        title={config.title}
        description={config.description}
        actions={
          config.canCreate !== false && (
            <Button onClick={() => openForm(null)}>
              <Icon name="plus" className="h-4 w-4" />
              Add {config.singular.toLowerCase()}
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={config.searchPlaceholder ?? "Search"}
            aria-label="Search"
            className={cn(inputClass, "pl-9")}
          />
        </div>
        {config.filters?.map((filter) => (
          <Select
            key={filter.name}
            className="w-48"
            aria-label={filter.label}
            placeholder={`All ${filter.label.toLowerCase()}`}
            options={filter.options(sources)}
            value={filters[filter.name] ?? ""}
            onChange={(value) => {
              setFilters((current) => ({ ...current, [filter.name]: value }));
              setPage(1);
            }}
          />
        ))}
        {config.activeFilter && (
          <Select
            className="w-36"
            aria-label="Status"
            placeholder="All"
            options={[
              { value: "1", label: "Active" },
              { value: "0", label: "Inactive" },
            ]}
            value={active}
            onChange={(value) => {
              setActive(value);
              setPage(1);
            }}
          />
        )}
      </div>

      {list.error && (
        <div className="mb-4">
          <Alert>{list.error.message}</Alert>
        </div>
      )}

      <DataTable columns={columns} rows={list.data?.data} rowKey={(row) => row.id} loading={list.loading} meta={list.data?.meta} onPageChange={setPage} />

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.record ? `Edit ${config.singular.toLowerCase()}` : `Add ${config.singular.toLowerCase()}`}
        description={editing?.record ? config.recordLabel(editing.record) : undefined}
        size={config.fields.length > 8 ? "lg" : "md"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="crud-form" loading={saving}>
              Save
            </Button>
          </>
        }
      >
        <form id="crud-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          {hasGeneralError && (
            <div className="sm:col-span-2">
              <Alert>{Object.values(formError!.errors)[0]?.[0] ?? formError!.message}</Alert>
            </div>
          )}
          {visibleFields.map((field) => (
            <FieldControl
              key={field.name}
              field={field}
              value={values[field.name]}
              values={values}
              sources={sources}
              error={formError?.field(field.name) ?? formError?.field(`${field.name}.0`)}
              onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))}
            />
          ))}
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${config.singular.toLowerCase()}?`}
        message={deleting ? `“${config.recordLabel(deleting)}” will be deleted. Records in use can't be deleted — deactivate them instead.` : ""}
        confirmLabel="Delete"
        loading={deleteBusy}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

function FieldControl({ field, value, values, sources, error, onChange }: {
  field: CrudField;
  value: FormValue | undefined;
  values: FormValues;
  sources: Sources;
  error?: string;
  onChange: (value: FormValue) => void;
}) {
  const wide = field.wide || field.type === "textarea" || field.type === "multiselect" || field.type === "checkbox";
  const className = wide ? "sm:col-span-2" : undefined;

  switch (field.type) {
    case "checkbox":
      return (
        <div className={className}>
          <Checkbox label={field.label} hint={field.hint} checked={Boolean(value)} onChange={onChange} />
        </div>
      );
    case "textarea":
      return (
        <TextArea className={className} label={field.label} hint={field.hint} required={field.required} error={error} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      );
    case "select":
      return (
        <Select
          className={className}
          label={field.label}
          hint={field.hint}
          required={field.required}
          error={error}
          placeholder={field.placeholder ?? "Select…"}
          options={field.options?.(sources, values) ?? []}
          value={String(value ?? "")}
          onChange={onChange}
        />
      );
    case "multiselect": {
      const selected = Array.isArray(value) ? value : [];
      const options = field.options?.(sources, values) ?? [];
      return (
        <Field className={className} label={field.label} hint={field.hint} error={error} required={field.required}>
          <div className="grid gap-2 rounded-md border border-neutral-200 p-3 sm:grid-cols-2">
            {options.length === 0 && <p className="text-xs text-neutral-500">Loading options…</p>}
            {options.map((option) => (
              <Checkbox
                key={option.value}
                label={option.label}
                checked={selected.includes(option.value)}
                onChange={(checked) => onChange(checked ? [...selected, option.value] : selected.filter((v) => v !== option.value))}
              />
            ))}
          </div>
        </Field>
      );
    }
    default:
      return (
        <FormInput
          className={className}
          label={field.label}
          hint={field.hint}
          required={field.required}
          error={error}
          type={field.type}
          step={field.step}
          placeholder={field.placeholder}
          autoComplete={field.type === "password" ? "new-password" : undefined}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
