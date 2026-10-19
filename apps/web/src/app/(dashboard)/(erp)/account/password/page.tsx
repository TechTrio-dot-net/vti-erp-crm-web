"use client";

import { useState, type FormEvent } from "react";
import { ApiError, postRoute } from "@/lib/erp/api";
import { Button } from "@/components/erp/ui/Button";
import { Alert, Card, PageHeader } from "@/components/erp/ui/Card";
import { FormInput } from "@/components/erp/ui/FormInput";
import { useToast } from "@/components/erp/ui/Toast";
import { useAuthStore } from "@/store/auth";

export default function ChangePasswordPage() {
  const toast = useToast();
  const setToken = useAuthStore((s) => s.setToken);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      // Changing the password ends every session, so the API hands this device replacement tokens
      const response = await postRoute<{ message: string; token: string }>("/api/auth/change-password", {
        current_password: current,
        password,
        password_confirmation: confirmation,
      });
      setToken(response.token);
      toast.success(response.message);
      setCurrent("");
      setPassword("");
      setConfirmation("");
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Change password" description="Choose a new password for your account. Your other devices will be signed out." />

      <Card className="max-w-lg">
        <form onSubmit={submit} className="space-y-4 p-5">
          {error && error.status !== 422 && <Alert>{error.message}</Alert>}
          <FormInput
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            error={error?.field("current_password")}
            required
          />
          <FormInput
            label="New password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error?.field("password")}
            hint="At least 8 characters with letters and numbers."
            required
          />
          <FormInput
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            error={error?.field("password_confirmation")}
            required
          />
          <div className="flex justify-end">
            <Button type="submit" loading={saving}>
              Change password
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
