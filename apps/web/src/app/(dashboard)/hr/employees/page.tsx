"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { HR_ROLES, fmtDate, inr } from "@/lib/crm";
import { useMe } from "@/lib/erp/me";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, ErrorState, LoadingBlock, PageHeader, selectCls } from "@/components/crm/ui";

type EmployeeStatus = "active" | "inactive" | "on_leave" | "terminated";

type Employee = {
  id: string; userId: string | null; employeeCode: string | null; name: string; email: string | null; phone: string | null;
  divisionId: string | null; departmentId: string | null; designationId: string | null; joiningDate: string | null; monthlySalary: number;
  bankAccount: string | null; ifsc: string | null; pan: string | null; address: string | null; status: EmployeeStatus;
  divisionName: string | null; departmentName: string | null; designationName: string | null;
  username: string | null; role: string | null; loginActive: boolean | null; lastLoginAt: string | null;
};

const STATUSES: { value: EmployeeStatus; label: string; badge: string }[] = [
  { value: "active", label: "Active", badge: "badge-green" },
  { value: "on_leave", label: "On leave", badge: "badge-amber" },
  { value: "inactive", label: "Inactive", badge: "badge-gray" },
  { value: "terminated", label: "Terminated", badge: "badge-red" },
];

const FIELDS = ["employeeCode", "name", "email", "phone", "designationId", "divisionId", "departmentId", "joiningDate", "monthlySalary", "bankAccount", "ifsc", "pan", "address", "status"] as const;
type Form = Record<(typeof FIELDS)[number], string> & { loginEnabled: boolean; loginRole: string; loginPassword: string; loginUsername: string; linkUserId: string };
const EMPTY: Form = {
  ...(Object.fromEntries(FIELDS.map((f) => [f, f === "status" ? "active" : ""])) as Record<(typeof FIELDS)[number], string>),
  loginEnabled: false,
  loginRole: "TEAM_MEMBER",
  loginPassword: "",
  loginUsername: "",
  linkUserId: "",
};

export default function EmployeesPage() {
  const role = useAuthStore((s) => s.user?.role);
  const { can, isLoading: permissionsLoading } = useMe();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("active");
  const [editing, setEditing] = useState<Employee | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);

  const allowed = (role && HR_ROLES.includes(role)) || can("employees.view");
  const canManage = (role && HR_ROLES.includes(role)) || can("employees.manage");

  const { data, isLoading, isError } = useQuery({ queryKey: ["hr", "employees", status], queryFn: () => api<Employee[]>(`/hr/employees?status=${status}`), enabled: !!allowed });
  const { data: divisions } = useQuery({ queryKey: ["masters", "divisions"], queryFn: () => api<Array<{ id: string; name: string }>>("/masters/divisions") });
  const { data: departments } = useQuery({ queryKey: ["masters", "departments"], queryFn: () => api<Array<{ id: string; name: string; divisionId: string | null }>>("/masters/departments") });
  const { data: designations } = useQuery({ queryKey: ["masters", "designations"], queryFn: () => api<Array<{ id: string; name: string; active: boolean }>>("/masters/designations") });
  const { data: roles } = useQuery({ queryKey: ["erp", "lookups", "roles"], queryFn: () => api<{ data: Array<{ slug: string; name: string }> }>("/v1/lookups/roles").then((r) => r.data), enabled: !!canManage });
  const { data: users } = useQuery({ queryKey: ["users", "directory"], queryFn: () => api<Array<{ id: string; name: string }>>("/users/directory"), enabled: !!canManage });

  const close = () => { setCreating(false); setEditing(null); };

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = Object.fromEntries(FIELDS.map((f) => [f, f === "monthlySalary" ? Number(form[f]) || 0 : form[f] === "" ? null : form[f]]));
      const hasAccount = !!editing?.userId;
      if (form.loginEnabled) {
        // Link an existing user account, or create/update the employee's own login
        if (!hasAccount && form.linkUserId) body.userId = form.linkUserId;
        else Object.assign(body, { loginEnabled: true, loginRole: form.loginRole, loginPassword: form.loginPassword || undefined, loginUsername: form.loginUsername || undefined });
      } else if (hasAccount && editing?.loginActive) {
        body.loginEnabled = false;
      }
      return editing
        ? api(`/hr/employees/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : api("/hr/employees", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => { toast.success("Employee saved"); close(); queryClient.invalidateQueries({ queryKey: ["hr"] }); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/hr/employees/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("Employee deleted"); queryClient.invalidateQueries({ queryKey: ["hr"] }); },
  });

  if (role && !allowed) {
    return permissionsLoading ? <LoadingBlock /> : <ErrorState message="Employee records are only available to HR, management and roles granted access" />;
  }

  const open = (e: Employee | null) => {
    setForm(
      e
        ? {
            ...(Object.fromEntries(FIELDS.map((f) => [f, e[f] == null ? "" : String(e[f])])) as Record<(typeof FIELDS)[number], string>),
            loginEnabled: !!e.userId && e.loginActive !== false,
            loginRole: e.role ?? "TEAM_MEMBER",
            loginPassword: "",
            loginUsername: e.username ?? "",
            linkUserId: "",
          }
        : EMPTY
    );
    setEditing(e);
    setCreating(!e);
  };
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const payroll = (data ?? []).filter((e) => e.status === "active").reduce((s, e) => s + e.monthlySalary, 0);
  const statusOf = (value: EmployeeStatus) => STATUSES.find((s) => s.value === value) ?? STATUSES[0];
  const hasAccount = !!editing?.userId;

  return (
    <div className="page space-y-5">
      <PageHeader title="Employee Details" subtitle={data ? `${data.length} employees · monthly payroll ${inr(payroll)}` : undefined}>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          <option value="all">All</option>
        </select>
        {canManage && <Button onClick={() => open(null)}><Plus className="size-4" />Add employee</Button>}
      </PageHeader>
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <DataTable
          rows={data}
          csvName="employees"
          empty="No employees yet"
          columns={[
            { key: "employeeCode", label: "Code" },
            { key: "name", label: "Employee", render: (e) => <div><p className="font-semibold">{e.name}</p><p className="text-xs text-muted-foreground">{[e.email, e.phone].filter(Boolean).join(" · ")}</p></div> },
            { key: "designationName", label: "Designation" },
            { key: "departmentName", label: "Department", render: (e) => [e.divisionName, e.departmentName].filter(Boolean).join(" / ") || "—" },
            { key: "joiningDate", label: "Joined", render: (e) => fmtDate(e.joiningDate) },
            { key: "monthlySalary", label: "Monthly salary", align: "right", render: (e) => inr(e.monthlySalary) },
            {
              key: "username",
              label: "Login",
              render: (e) =>
                e.username ? (
                  <div>
                    <p className={e.loginActive ? "" : "text-muted-foreground line-through"}>{e.username}</p>
                    <p className="text-xs text-muted-foreground">{e.role?.replace(/_/g, " ").toLowerCase()}</p>
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
              csv: (e) => e.username ?? "",
            },
            { key: "status", label: "Status", render: (e) => <span className={`badge ${statusOf(e.status).badge}`}>{statusOf(e.status).label}</span>, csv: (e) => statusOf(e.status).label },
            { key: "actions", label: "", csv: () => "", render: (e) => canManage && (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => open(e)} aria-label={`Edit ${e.name}`}><Pencil className="size-3.5" /></Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 hover:text-destructive" onClick={() => window.confirm(`Delete ${e.name}? Their salary history is deleted too and their login is disabled. Consider marking them inactive instead.`) && remove.mutate(e.id)} aria-label={`Delete ${e.name}`}><Trash2 className="size-3.5" /></Button>
              </div>
            ) },
          ]}
        />
      )}

      <Dialog open={creating || !!editing} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? `Edit ${editing.name}` : "Add employee"}</DialogTitle></DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Full name *</Label><Input value={form.name} onChange={set("name")} required /></div>
              <div className="space-y-1.5"><Label>Employee ID</Label><Input value={form.employeeCode} onChange={set("employeeCode")} placeholder={editing ? "" : "Generated, e.g. VTI-0012"} /></div>
              <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={set("email")} /></div>
              <div className="space-y-1.5"><Label>Mobile</Label><Input value={form.phone} onChange={set("phone")} /></div>
              <div className="space-y-1.5">
                <Label>Designation</Label>
                <select value={form.designationId} onChange={set("designationId")} className={`${selectCls} w-full`}>
                  <option value="">—</option>
                  {designations?.filter((d) => d.active || d.id === form.designationId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><Label>Joining date</Label><Input type="date" value={form.joiningDate} onChange={set("joiningDate")} /></div>
              <div className="space-y-1.5">
                <Label>Division</Label>
                <select value={form.divisionId} onChange={set("divisionId")} className={`${selectCls} w-full`}>
                  <option value="">—</option>
                  {divisions?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Department</Label>
                <select value={form.departmentId} onChange={set("departmentId")} className={`${selectCls} w-full`}>
                  <option value="">—</option>
                  {departments?.filter((d) => !form.divisionId || d.divisionId === form.divisionId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><Label>Monthly salary (₹)</Label><Input type="number" min={0} value={form.monthlySalary} onChange={set("monthlySalary")} /></div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <select value={form.status} onChange={set("status")} className={`${selectCls} w-full`}>
                  {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><Label>Bank account</Label><Input value={form.bankAccount} onChange={set("bankAccount")} /></div>
              <div className="space-y-1.5"><Label>IFSC</Label><Input value={form.ifsc} onChange={set("ifsc")} /></div>
              <div className="space-y-1.5"><Label>PAN</Label><Input value={form.pan} onChange={set("pan")} /></div>
              <div className="col-span-2 space-y-1.5"><Label>Address</Label><Input value={form.address} onChange={set("address")} /></div>
            </div>

            <fieldset className="rounded-lg border border-border p-3 space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" className="size-4" checked={form.loginEnabled} onChange={(e) => setForm((f) => ({ ...f, loginEnabled: e.target.checked }))} />
                Can sign in
              </label>
              <p className="text-xs text-muted-foreground">
                {form.loginEnabled
                  ? "Signs in with their employee ID, username or email. Only active employees can sign in; a new password, role change or deactivation signs them out everywhere."
                  : hasAccount ? "Their login will be disabled (kept for history)." : "No login account."}
              </p>
              {form.loginEnabled && (
                <div className="grid grid-cols-2 gap-3">
                  {!hasAccount && (
                    <div className="col-span-2 space-y-1.5">
                      <Label>Account</Label>
                      <select value={form.linkUserId} onChange={set("linkUserId")} className={`${selectCls} w-full`}>
                        <option value="">Create a new login</option>
                        {users?.map((u) => <option key={u.id} value={u.id}>Link existing user: {u.name}</option>)}
                      </select>
                    </div>
                  )}
                  {(hasAccount || !form.linkUserId) && (
                    <>
                      <div className="space-y-1.5">
                        <Label>Role *</Label>
                        <select value={form.loginRole} onChange={set("loginRole")} className={`${selectCls} w-full`} required>
                          {roles?.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
                          {roles && !roles.some((r) => r.slug === form.loginRole) && <option value={form.loginRole}>{form.loginRole}</option>}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Username</Label>
                        <Input value={form.loginUsername} onChange={set("loginUsername")} placeholder="Defaults to the employee ID" />
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <Label>{hasAccount ? "New password" : "Password *"}</Label>
                        <Input type="password" autoComplete="new-password" value={form.loginPassword} onChange={set("loginPassword")} required={!hasAccount} placeholder={hasAccount ? "Leave blank to keep the current password" : "At least 8 characters with letters and numbers"} />
                      </div>
                    </>
                  )}
                </div>
              )}
            </fieldset>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>Cancel</Button>
              <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
