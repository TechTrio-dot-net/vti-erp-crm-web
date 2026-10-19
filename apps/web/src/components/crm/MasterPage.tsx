"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, ErrorState, LoadingBlock, PageHeader, selectCls, type Column } from "./ui";

type Row = Record<string, unknown> & { id: string; name: string; active?: boolean };

export type MasterField = {
  name: string;
  label: string;
  type?: "text" | "number" | "checkbox" | "select" | "textarea";
  required?: boolean;
  /** select options: static list or loaded from an endpoint returning [{id, name}] */
  options?: { endpoint: string; queryKey: unknown[] } | Array<{ value: string; label: string }>;
};

/** List + add/edit/delete page for a simple master table served by /api/masters/* */
export function MasterPage({
  title,
  subtitle,
  endpoint,
  queryKey,
  fields,
  columns,
  createDefaults = {},
}: {
  title: string;
  subtitle?: string;
  endpoint: string;
  queryKey: unknown[];
  fields: MasterField[];
  columns: Column<Row>[];
  createDefaults?: Record<string, unknown>;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});

  const { data, isLoading, isError } = useQuery({ queryKey, queryFn: () => api<Row[]>(endpoint) });
  const basePath = endpoint.split("?")[0];

  const save = useMutation({
    mutationFn: () => {
      const body = Object.fromEntries(fields.map((f) => [f.name, f.type === "number" ? (form[f.name] === "" ? null : Number(form[f.name])) : form[f.name] === "" ? null : form[f.name]]));
      return editing
        ? api(`${basePath}/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : api(basePath, { method: "POST", body: JSON.stringify({ ...createDefaults, ...body }) });
    },
    onSuccess: () => {
      toast.success(editing ? "Saved" : "Added");
      queryClient.invalidateQueries({ queryKey: [queryKey[0]] });
      setEditing(null);
      setCreating(false);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`${basePath}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Deleted");
      queryClient.invalidateQueries({ queryKey: [queryKey[0]] });
    },
  });

  const open = (row: Row | null) => {
    setForm(Object.fromEntries(fields.map((f) => [f.name, row ? (row[f.name] ?? (f.type === "checkbox" ? false : "")) : f.type === "checkbox" ? true : ""])));
    setEditing(row);
    setCreating(!row);
  };

  const actionColumn: Column<Row> = {
    key: "_actions",
    label: "",
    render: (row) => (
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => open(row)} aria-label={`Edit ${row.name}`}><Pencil className="size-3.5" /></Button>
        <Button
          variant="ghost" size="sm" className="h-7 px-2 hover:text-destructive"
          onClick={() => window.confirm(`Delete "${row.name}"?`) && remove.mutate(row.id)}
          aria-label={`Delete ${row.name}`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    ),
    csv: () => "",
  };

  return (
    <div className="page space-y-5">
      <PageHeader title={title} subtitle={subtitle}>
        <Button onClick={() => open(null)}><Plus className="size-4" />Add</Button>
      </PageHeader>
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <DataTable rows={data} columns={[...columns, actionColumn]} csvName={title.toLowerCase().replace(/\s+/g, "-")} empty={`No ${title.toLowerCase()} yet`} />
      )}

      <Dialog open={creating || !!editing} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? `Edit ${editing.name}` : `Add ${title.replace(/ Master$/, "")}`}</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            {fields.map((f) => (
              <FieldInput key={f.name} field={f} value={form[f.name]} onChange={(v) => setForm((s) => ({ ...s, [f.name]: v }))} />
            ))}
            {save.isError && <p className="text-sm text-destructive">{save.error.message}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button>
              <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: MasterField; value: unknown; onChange: (v: unknown) => void }) {
  const remote = field.options && !Array.isArray(field.options) ? field.options : null;
  const { data: remoteOptions } = useQuery({
    queryKey: remote?.queryKey ?? ["noop"],
    queryFn: () => api<Array<{ id: string; name: string }>>(remote!.endpoint),
    enabled: !!remote,
  });
  if (field.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="size-4" />
        {field.label}
      </label>
    );
  }
  if (field.type === "select") {
    const options = Array.isArray(field.options) ? field.options : (remoteOptions ?? []).map((o) => ({ value: o.id, label: o.name }));
    return (
      <div className="space-y-1.5">
        <Label>{field.label}{field.required && " *"}</Label>
        <select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} required={field.required} className={`${selectCls} w-full`}>
          <option value="">—</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    );
  }
  if (field.type === "textarea") {
    return (
      <div className="space-y-1.5">
        <Label>{field.label}</Label>
        <textarea rows={3} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label>{field.label}{field.required && " *"}</Label>
      <Input type={field.type === "number" ? "number" : "text"} value={(value as string | number) ?? ""} onChange={(e) => onChange(e.target.value)} required={field.required} />
    </div>
  );
}

export const activeColumn: Column<Row> = {
  key: "active",
  label: "Status",
  render: (r) => <span className={`badge ${r.active === false ? "badge-gray" : "badge-green"}`}>{r.active === false ? "Inactive" : "Active"}</span>,
  csv: (r) => (r.active === false ? "Inactive" : "Active"),
};
