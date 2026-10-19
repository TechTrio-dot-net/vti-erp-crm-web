"use client";

import { useState } from "react";
import { ApiError, api } from "@/lib/erp/api";
import { useApi } from "@/lib/erp/use-api";
import { RequirePermission } from "@/components/erp/RequirePermission";
import { Button } from "@/components/erp/ui/Button";
import { Alert, Card, CardHeader, PageHeader } from "@/components/erp/ui/Card";
import { Checkbox, FormInput, TextArea } from "@/components/erp/ui/FormInput";
import { useToast } from "@/components/erp/ui/Toast";

interface Setting {
  key: string;
  label: string;
  type: "string" | "text" | "number" | "boolean" | "list";
  description: string | null;
  value: unknown;
}

interface Group {
  group: string;
  settings: Setting[];
}

type FieldValue = string | boolean;

const GROUP_TITLES: Record<string, { title: string; description: string }> = {
  company: { title: "Company information", description: "Printed on quotations." },
  quotation: { title: "Quotation settings", description: "Numbering, validity and dropdown values." },
  tax: { title: "Tax", description: "GST applied to quotation subtotals." },
};

function toField(setting: Setting): FieldValue {
  if (setting.type === "boolean") return Boolean(setting.value);
  if (setting.type === "list") return Array.isArray(setting.value) ? setting.value.join(", ") : "";
  return setting.value === null || setting.value === undefined ? "" : String(setting.value);
}

function toValue(setting: Setting, field: FieldValue): unknown {
  if (setting.type === "boolean") return Boolean(field);
  if (setting.type === "list") {
    return String(field)
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map(Number);
  }
  return field;
}

export default function SettingsPage() {
  return (
    <RequirePermission permission={["settings.company", "settings.quotation"]}>
      <Settings />
    </RequirePermission>
  );
}

function Settings() {
  const toast = useToast();
  const { data, error: loadError, reload } = useApi<{ data: Group[] }>("/admin/settings");
  const [edits, setEdits] = useState<Record<string, FieldValue>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const groups = data?.data ?? [];
  const settings = groups.flatMap((g) => g.settings);
  const valueOf = (setting: Setting) => (setting.key in edits ? edits[setting.key] : toField(setting));
  const fieldError = (key: string) => error?.field(`values.${key}`) ?? error?.field(`values.${key.replace(/\./g, "\\.")}`);

  async function save() {
    setSaving(true);
    setError(null);
    const values = Object.fromEntries(settings.filter((s) => s.key in edits).map((s) => [s.key, toValue(s, edits[s.key])]));

    try {
      await api.put("/admin/settings", { values });
      toast.success("Settings saved.");
      setEdits({});
      reload();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Business settings stored in the database — no code changes needed."
        actions={
          <Button onClick={save} loading={saving} disabled={Object.keys(edits).length === 0}>
            Save settings
          </Button>
        }
      />

      <div className="space-y-6">
        {loadError && <Alert>{loadError.message}</Alert>}
        {error && error.status !== 422 && <Alert>{error.message}</Alert>}

        {groups.map((group) => (
          <Card key={group.group}>
            <CardHeader title={GROUP_TITLES[group.group]?.title ?? group.group} description={GROUP_TITLES[group.group]?.description} />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              {group.settings.map((setting) => {
                const value = valueOf(setting);
                const set = (next: FieldValue) => setEdits((current) => ({ ...current, [setting.key]: next }));

                if (setting.type === "boolean") {
                  return (
                    <div key={setting.key} className="sm:col-span-2">
                      <Checkbox label={setting.label} hint={setting.description ?? undefined} checked={Boolean(value)} onChange={set} />
                    </div>
                  );
                }

                if (setting.type === "text") {
                  return (
                    <TextArea
                      key={setting.key}
                      className="sm:col-span-2"
                      label={setting.label}
                      value={String(value)}
                      onChange={(e) => set(e.target.value)}
                      error={fieldError(setting.key)}
                      rows={setting.key === "quotation.terms" ? 5 : 3}
                    />
                  );
                }

                return (
                  <FormInput
                    key={setting.key}
                    label={setting.label}
                    type={setting.type === "number" ? "number" : "text"}
                    step={setting.type === "number" ? "any" : undefined}
                    value={String(value)}
                    onChange={(e) => set(e.target.value)}
                    error={fieldError(setting.key)}
                    hint={setting.type === "list" ? "Comma-separated, e.g. 1, 2, 3, 5, 10" : (setting.description ?? undefined)}
                  />
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
