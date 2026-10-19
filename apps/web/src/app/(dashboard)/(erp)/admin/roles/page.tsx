"use client";

import { useState } from "react";
import type { Id, Role } from "@/lib/erp/types";
import { ApiError, api } from "@/lib/erp/api";
import { useApi } from "@/lib/erp/use-api";
import { humanize } from "@/lib/erp/format";
import { cn } from "@/lib/erp/cn";
import { RequirePermission } from "@/components/erp/RequirePermission";
import { Badge } from "@/components/erp/ui/Badge";
import { Button } from "@/components/erp/ui/Button";
import { Alert, Card, CardHeader, PageHeader } from "@/components/erp/ui/Card";
import { ConfirmDialog } from "@/components/erp/ui/ConfirmDialog";
import { Checkbox, FormInput } from "@/components/erp/ui/FormInput";
import { Icon } from "@/components/erp/ui/Icon";
import { Modal } from "@/components/erp/ui/Modal";
import { useToast } from "@/components/erp/ui/Toast";

interface PermissionGroup {
  module: string;
  permissions: { id: Id; slug: string; name: string }[];
}

interface Draft {
  roleId: Id;
  name: string;
  description: string;
  permissions: string[];
}

export default function RolesPage() {
  return (
    <RequirePermission permission="roles.manage">
      <Roles />
    </RequirePermission>
  );
}

function Roles() {
  const toast = useToast();
  const roles = useApi<{ data: Role[] }>("/admin/roles");
  const groups = useApi<{ data: PermissionGroup[] }>("/admin/permissions").data?.data ?? [];
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [creating, setCreating] = useState(false);
  const [newRole, setNewRole] = useState({ name: "", description: "" });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const list = roles.data?.data ?? [];
  const selected = list.find((r) => r.id === selectedId) ?? list[0];

  if (!selected) {
    return roles.error ? <Alert>{roles.error.message}</Alert> : <PageHeader title="Roles & Permissions" />;
  }

  // Unsaved edits apply only to the role they were made on.
  const current: Draft =
    draft?.roleId === selected.id
      ? draft
      : { roleId: selected.id, name: selected.name, description: selected.description ?? "", permissions: selected.permissions ?? [] };
  const isSuperAdmin = selected.slug === "super-admin";
  const edit = (patch: Partial<Draft>) => setDraft({ ...current, ...patch });

  function toggle(slug: string, on: boolean) {
    edit({ permissions: on ? [...current.permissions, slug] : current.permissions.filter((p) => p !== slug) });
  }

  function toggleModule(group: PermissionGroup, on: boolean) {
    const slugs = group.permissions.map((p) => p.slug);
    edit({ permissions: on ? Array.from(new Set([...current.permissions, ...slugs])) : current.permissions.filter((p) => !slugs.includes(p)) });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.put(`/admin/roles/${selected!.id}`, { name: current.name, description: current.description, permissions: current.permissions });
      toast.success(`Role “${current.name}” saved.`);
      setDraft(null);
      roles.reload();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  async function create() {
    setSaving(true);
    setError(null);
    try {
      const response = await api.post<{ data: Role }>("/admin/roles", { ...newRole, permissions: [] });
      toast.success(`Role “${response.data.name}” created. Now choose its permissions.`);
      setCreating(false);
      setNewRole({ name: "", description: "" });
      setSelectedId(response.data.id);
      roles.reload();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      await api.delete(`/admin/roles/${selected!.id}`);
      toast.success("Role deleted.");
      setSelectedId(null);
      roles.reload();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setSaving(false);
      setConfirmDelete(false);
    }
  }

  const dirty = draft?.roleId === selected.id;

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        description="Admins get access according to the permissions assigned to their role. The Super Admin always has full access."
        actions={
          <Button
            onClick={() => {
              setError(null);
              setCreating(true);
            }}
          >
            <Icon name="plus" className="h-4 w-4" />
            New role
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card className="self-start">
          <ul className="divide-y divide-neutral-100">
            {list.map((role) => (
              <li key={role.id}>
                <button
                  onClick={() => {
                    setSelectedId(role.id);
                    setError(null);
                  }}
                  className={cn("flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm", role.id === selected.id ? "bg-brand/20" : "hover:bg-neutral-50")}
                >
                  <span>
                    <span className={cn("block font-medium", role.id === selected.id ? "text-ink font-semibold" : "text-neutral-900")}>{role.name}</span>
                    <span className="text-xs text-neutral-500">
                      {role.users_count} user(s) · {role.permissions?.length ?? 0} permission(s)
                    </span>
                  </span>
                  {role.is_system && <Badge>System</Badge>}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title={selected.name}
            description={isSuperAdmin ? "Super Admin always has every permission." : `${current.permissions.length} permission(s) selected`}
            actions={
              <>
                {!selected.is_system && (
                  <Button variant="ghost" size="sm" className="text-ink hover:bg-ink" onClick={() => setConfirmDelete(true)}>
                    <Icon name="trash" className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                )}
                {dirty && (
                  <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
                    Discard
                  </Button>
                )}
                <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
                  Save changes
                </Button>
              </>
            }
          />
          <div className="space-y-5 p-5">
            {error && <Alert>{Object.values(error.errors)[0]?.[0] ?? error.message}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormInput label="Role name" value={current.name} onChange={(e) => edit({ name: e.target.value })} required />
              <FormInput label="Description" value={current.description} onChange={(e) => edit({ description: e.target.value })} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {groups.map((group) => {
                const allOn = group.permissions.every((p) => isSuperAdmin || current.permissions.includes(p.slug));
                return (
                  <div key={group.module} className="rounded-lg border border-neutral-200">
                    <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-4 py-2.5 rounded-t-lg">
                      <p className="text-sm font-semibold text-neutral-800">{humanize(group.module)}</p>
                      {!isSuperAdmin && (
                        <button className="text-xs font-medium text-ink underline decoration-brand decoration-2 underline-offset-2 hover:decoration-ink" onClick={() => toggleModule(group, !allOn)}>
                          {allOn ? "Clear all" : "Select all"}
                        </button>
                      )}
                    </div>
                    <div className="space-y-2.5 p-4">
                      {group.permissions.map((permission) => (
                        <Checkbox
                          key={permission.slug}
                          label={permission.name}
                          hint={permission.slug}
                          disabled={isSuperAdmin}
                          checked={isSuperAdmin || current.permissions.includes(permission.slug)}
                          onChange={(on) => toggle(permission.slug, on)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New role"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={create} loading={saving}>
              Create role
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert>{Object.values(error.errors)[0]?.[0] ?? error.message}</Alert>}
          <FormInput label="Role name" required value={newRole.name} onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} placeholder="e.g. Sales Executive" />
          <FormInput label="Description" value={newRole.description} onChange={(e) => setNewRole({ ...newRole, description: e.target.value })} />
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete role?"
        message={`“${selected.name}” will be deleted. Roles that are still assigned to users can't be deleted.`}
        confirmLabel="Delete"
        loading={saving}
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}
