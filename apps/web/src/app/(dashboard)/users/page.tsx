"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { UserCog, Plus, Pencil, Trash2, Eye, EyeOff, WifiOff } from "lucide-react";

type User = {
  id: string;
  name: string;
  username: string;
  email: string | null;
  role: string;
  initials?: string;
  isActive: boolean;
  lastLoginAt: string | null;
  /** Set when the account belongs to an employee (they can sign in with it) */
  employeeCode: string | null;
};

type FormState = {
  name: string;
  username: string;
  email: string;
  password: string;
  role: string;
  /** "active" | "inactive" */
  status: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  username: "",
  email: "",
  password: "",
  role: "TEAM_MEMBER",
  status: "active",
};

const ROLES = [
  { value: "SUPER_ADMIN",     label: "Super Admin" },
  { value: "MANAGEMENT",      label: "Management" },
  { value: "PROJECT_MANAGER", label: "Project Manager" },
  { value: "DEVELOPER",       label: "Developer" },
  { value: "DESIGNER",        label: "Designer" },
  { value: "MARKETING",       label: "Marketing" },
  { value: "ADS_TEAM",        label: "Ads Team" },
  { value: "SALES",           label: "Sales" },
  { value: "SUPPORT",         label: "Support" },
  { value: "HR",              label: "HR" },
  { value: "TEAM_MEMBER",     label: "Team Member" },
  { value: "CLIENT",          label: "Client" },
];

const ROLE_BADGE: Record<string, string> = {
  SUPER_ADMIN: "badge-blue", MANAGEMENT: "badge-blue", PROJECT_MANAGER: "badge-purple",
  DEVELOPER: "badge-green", DESIGNER: "badge-sky", MARKETING: "badge-amber",
  ADS_TEAM: "badge-sky", SALES: "badge-green", SUPPORT: "badge-gray",
  HR: "badge-purple", TEAM_MEMBER: "badge-gray", CLIENT: "badge-amber",
};

const HUE = [200, 230, 160, 280, 30, 340, 50, 100];
function avatarHue(name: string) {
  return `hsl(${HUE[name.charCodeAt(0) % HUE.length]} 55% 42%)`;
}

function validateForm(form: FormState, isEdit: boolean): string | null {
  if (!form.name.trim()) return "Full name is required.";
  if (!form.username.trim()) return "Username is required.";
  if (form.username.trim().length < 2) return "Username must be at least 2 characters.";
  if (!/^[a-z0-9_.-]+$/i.test(form.username.trim()))
    return "Username can only contain letters, numbers, dots, underscores, and hyphens.";
  // Staff who sign in with their username or employee ID may have no email address
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
    return "Please enter a valid email address.";
  if (!isEdit && form.password && form.password.length < 6)
    return "Password must be at least 6 characters.";
  if (isEdit && form.password && form.password.length < 6)
    return "New password must be at least 6 characters.";
  return null;
}

// ── UserForm defined OUTSIDE the page component to prevent focus loss ──────
interface UserFormProps {
  form: FormState;
  onChange: (field: keyof FormState, value: string) => void;
  isEdit: boolean;
  showPassword: boolean;
  onTogglePassword: () => void;
  error?: string;
  roles: Array<{ value: string; label: string }>;
}

function UserForm({ form, onChange, isEdit, showPassword, onTogglePassword, error, roles }: UserFormProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5 col-span-2">
          <Label htmlFor="u-name">Full name *</Label>
          <Input
            id="u-name"
            value={form.name}
            onChange={(e) => onChange("name", e.target.value)}
            placeholder="e.g. Adarsh Sharma"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="u-username">Username *</Label>
          <Input
            id="u-username"
            value={form.username}
            onChange={(e) => onChange("username", e.target.value.toLowerCase())}
            placeholder="e.g. adarsh"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="u-email">Email</Label>
          <Input
            id="u-email"
            type="email"
            value={form.email}
            onChange={(e) => onChange("email", e.target.value)}
            placeholder="e.g. name@company.com"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5 col-span-2">
          <Label htmlFor="u-password">
            {isEdit ? "New password" : "Password"}
            <span className="text-muted-foreground font-normal ml-1 text-xs">
              {isEdit ? "(leave blank to keep current)" : "(default: changeme123)"}
            </span>
          </Label>
          <div className="relative">
            <Input
              id="u-password"
              type={showPassword ? "text" : "password"}
              value={form.password}
              onChange={(e) => onChange("password", e.target.value)}
              placeholder={isEdit ? "Leave blank to keep" : "Min. 6 characters"}
              autoComplete="new-password"
              className="pr-10"
            />
            <button
              type="button"
              onClick={onTogglePassword}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-1.5 col-span-2">
          <Label htmlFor="u-role">Role</Label>
          <select
            id="u-role"
            value={form.role}
            onChange={(e) => onChange("role", e.target.value)}
            className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {roles.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
            {!roles.some((r) => r.value === form.role) && <option value={form.role}>{form.role.replace(/_/g, " ")}</option>}
          </select>
          <p className="text-xs text-muted-foreground">Manage what each role can do under Roles &amp; Permissions.</p>
        </div>

        {isEdit && (
          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="u-status">Account</Label>
            <select
              id="u-status"
              value={form.status}
              onChange={(e) => onChange("status", e.target.value)}
              className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="active">Active — can sign in</option>
              <option value="inactive">Inactive — can&apos;t sign in</option>
            </select>
            <p className="text-xs text-muted-foreground">A new password, a role change or deactivating signs the user out everywhere.</p>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/8 border border-destructive/20 px-3 py-2.5 rounded-lg">
          {error}
        </p>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function UsersPage() {
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen]     = useState(false);
  const [deleteId, setDeleteId]     = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const [form, setForm]           = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string>("");
  const [showPassword, setShowPassword] = useState(false);

  const handleChange = useCallback((field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFormError("");
  }, []);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["users"],
    queryFn: () => api<User[]>("/users"),
  });
  // System roles plus any custom roles; without users.manage, Super Admin and Management aren't offered
  const { data: roleOptions } = useQuery({
    queryKey: ["erp", "lookups", "roles"],
    queryFn: () => api<{ data: Array<{ slug: string; name: string }> }>("/v1/lookups/roles").then((r) => r.data),
  });
  const roles = roleOptions?.map((r) => ({ value: r.slug, label: r.name })) ?? ROLES;
  const roleName = (slug: string) => roles.find((r) => r.value === slug)?.label ?? slug.replace(/_/g, " ");
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const shown = (data ?? []).filter(
    (u) => !term || [u.name, u.username, u.email, u.employeeCode].some((v) => v?.toLowerCase().includes(term))
  );

  const createMutation = useMutation({
    mutationFn: (body: object) => api("/users", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (newUser: any) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      setShowPassword(false);
      toast.success(`User "${newUser?.name || form.name}" created`, {
        description: "A welcome email with login credentials has been sent.",
      });
    },
    onError: (err: Error) => {
      setFormError(err.message || "Failed to create user.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      api(`/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setEditOpen(false);
      setEditingUser(null);
      setForm(EMPTY_FORM);
      setShowPassword(false);
      toast.success("User updated successfully.");
    },
    onError: (err: Error) => {
      setFormError(err.message || "Failed to update user.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setDeleteId(null);
      toast.success("User deleted.");
    },
    onError: (err: Error) => {
      toast.error("Failed to delete user.", { description: err.message });
      setDeleteId(null);
    },
  });

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setFormError("");
    setShowPassword(false);
    setCreateOpen(true);
  };

  const openEdit = (u: User) => {
    setEditingUser(u);
    setForm({ name: u.name, username: u.username, email: u.email ?? "", password: "", role: u.role, status: u.isActive ? "active" : "inactive" });
    setFormError("");
    setShowPassword(false);
    setEditOpen(true);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateForm(form, false);
    if (err) { setFormError(err); return; }
    createMutation.mutate({
      name: form.name.trim(),
      username: form.username.trim(),
      email: form.email.trim() || null,
      password: form.password || undefined,
      role: form.role,
    });
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    const err = validateForm(form, true);
    if (err) { setFormError(err); return; }
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      username: form.username.trim(),
      email: form.email.trim() || null,
      role: form.role,
      isActive: form.status === "active",
    };
    if (form.password) body.password = form.password;
    updateMutation.mutate({ id: editingUser.id, body });
  };

  if (isError) return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 text-center animate-fade-up">
      <div className="size-12 rounded-2xl bg-muted flex items-center justify-center">
        <WifiOff className="size-6 text-muted-foreground" />
      </div>
      <p className="font-semibold text-foreground">Could not load users</p>
      <p className="text-sm text-muted-foreground">Check your connection or try refreshing.</p>
    </div>
  );

  if (isLoading || !data) return (
    <div className="flex items-center justify-center gap-3 text-muted-foreground py-20">
      <div className="size-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <span className="text-sm">Loading users…</span>
    </div>
  );

  return (
    <div className="page space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="page-subtitle">Control login access — Super Admin only</p>
        </div>
        <Button onClick={openCreate}><Plus className="size-4" />Create User</Button>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border/50">
          <p className="text-[15px] font-semibold">All Users</p>
          <div className="flex items-center gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, username, email or employee ID" className="h-8 w-72" />
            <span className="badge badge-gray">{shown.length} of {data.length}</span>
          </div>
        </div>

        {data.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><UserCog className="size-6 text-muted-foreground" /></div>
            <p className="font-semibold">No users yet</p>
            <Button onClick={openCreate} className="mt-4"><Plus className="size-4" />Create User</Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Username</th><th>Employee ID</th><th>Email</th><th>Role</th><th>Last sign-in</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {shown.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div
                          className="avatar avatar-sm text-white font-bold shrink-0"
                          style={{ background: avatarHue(u.name) }}
                        >
                          {u.initials || u.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="font-semibold">{u.name}</span>
                      </div>
                    </td>
                    <td className="font-mono text-sm text-muted-foreground">{u.username}</td>
                    <td className="font-mono text-sm text-muted-foreground">{u.employeeCode ?? "—"}</td>
                    <td className="text-muted-foreground">{u.email ?? "—"}</td>
                    <td>
                      <span className={`badge ${ROLE_BADGE[u.role] || "badge-gray"}`}>
                        {roleName(u.role)}
                      </span>
                    </td>
                    <td className="text-sm text-muted-foreground whitespace-nowrap">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never"}
                    </td>
                    <td>
                      <span className={`badge ${u.isActive ? "badge-green" : "badge-gray"}`}>{u.isActive ? "Active" : "Inactive"}</span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => openEdit(u)}
                          className="h-7 px-2 text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => setDeleteId(u.id)}
                          className="h-7 px-2 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Create dialog ── */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setFormError(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create User</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 pt-1">
            <UserForm
              form={form}
              onChange={handleChange}
              isEdit={false}
              showPassword={showPassword}
              onTogglePassword={() => setShowPassword((v) => !v)}
              error={formError}
              roles={roles}
            />
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <span className="size-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                    Creating…
                  </span>
                ) : "Create User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ── */}
      <Dialog open={editOpen} onOpenChange={(o) => { if (!o) { setEditOpen(false); setEditingUser(null); setFormError(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User — {editingUser?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4 pt-1">
            <UserForm
              form={form}
              onChange={handleChange}
              isEdit={true}
              showPassword={showPassword}
              onTogglePassword={() => setShowPassword((v) => !v)}
              error={formError}
              roles={roles}
            />
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <span className="size-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                    Saving…
                  </span>
                ) : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation dialog ── */}
      <Dialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground pt-1">
            Are you sure you want to delete{" "}
            <strong className="text-foreground">
              {data.find((u) => u.id === deleteId)?.name ?? "this user"}
            </strong>
            ? This action cannot be undone.
          </p>
          <DialogFooter className="pt-4">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
