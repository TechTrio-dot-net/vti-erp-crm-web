"use client";

import { useState, type FormEvent } from "react";
import type { PaymentOptions, QuotationPayments } from "@/lib/erp/types";
import { ApiError, api, openProtectedFile } from "@/lib/erp/api";
import { useApi } from "@/lib/erp/use-api";
import { formatDate, formatDateTime, formatMoney, trimNumber } from "@/lib/erp/format";
import { Button } from "../ui/Button";
import { Alert, Card, CardHeader } from "../ui/Card";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Field, FormInput, TextArea, inputClass, inputErrorClass } from "../ui/FormInput";
import { Icon } from "../ui/Icon";
import { Modal } from "../ui/Modal";
import { Select } from "../ui/Select";
import { useToast } from "../ui/Toast";
import { PaymentStatusBadge } from "./PaymentStatusBadge";

/** Today as YYYY-MM-DD in the browser's own calendar. */
function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A YYYY-MM-DD calendar day for display. */
function formatDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);

  return formatDate(new Date(year, month - 1, date).toISOString());
}

interface FormState {
  amount: string;
  received_by: string;
  method: string;
  method_detail: string;
  paid_on: string;
  reference: string;
  notes: string;
  attachment: File | null;
}

/**
 * Payments received against one quotation: totals, the list with screenshots,
 * recording a payment, and closing the account once everything is in.
 */
export function PaymentsPanel({ quotationId, currency, onChange }: { quotationId: string; currency: string; onChange?: () => void }) {
  const toast = useToast();
  const { data, error, reload } = useApi<{ data: QuotationPayments }>(`/quotations/${quotationId}/payments`);
  const options = useApi<{ data: PaymentOptions }>("/payments/options").data?.data;

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const state = data?.data;
  const summary = state?.summary;

  function refresh() {
    reload();
    onChange?.();
  }

  function openForm() {
    setFormError(null);
    setForm({
      amount: summary ? trimNumber(summary.pending) : "",
      received_by: "",
      method: "",
      method_detail: "",
      paid_on: today(),
      reference: "",
      notes: "",
      attachment: null,
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    // Every payment needs proof; the API refuses one without it too.
    if (!form.attachment) {
      setFormError(new ApiError(422, "Attach a screenshot of the payment.", { attachment: ["Attach a screenshot of the payment."] }));
      return;
    }

    const body = new FormData();
    for (const [key, value] of Object.entries(form)) {
      if (key === "attachment") {
        if (value) body.append("attachment", value as File);
      } else if (!(key === "method_detail" && form.method !== "custom")) {
        body.append(key, value as string);
      }
    }

    setBusy("record");
    setFormError(null);
    try {
      await api.post(`/quotations/${quotationId}/payments`, body);
      toast.success(`Payment of ${formatMoney(form.amount, currency)} recorded.`);
      setForm(null);
      refresh();
    } catch (e) {
      setFormError(e as ApiError);
    } finally {
      setBusy(null);
    }
  }

  async function act(key: string, request: () => Promise<unknown>, message: string) {
    setBusy(key);
    try {
      await request();
      toast.success(message);
      refresh();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  const set = (field: keyof FormState) => (e: { target: { value: string } }) =>
    setForm((current) => (current ? { ...current, [field]: e.target.value } : current));
  const fieldError = (name: string) => formError?.field(name);
  const paidShare = summary && Number(summary.total) > 0 ? Math.min(100, (Number(summary.paid) / Number(summary.total)) * 100) : 0;

  return (
    <Card>
      <CardHeader
        title="Payments"
        description={summary ? <PaymentStatusBadge status={summary.status} /> : "Money received against this quotation."}
        actions={
          summary && (
            <div className="flex flex-wrap gap-2">
              {summary.status === "paid" && (
                <Button size="sm" loading={busy === "complete"} disabled={busy !== null} onClick={() => act("complete", () => api.post(`/quotations/${quotationId}/payments/complete`), "Payment marked complete.")}>
                  <Icon name="checkCircle" className="h-3.5 w-3.5" />
                  Mark payment complete
                </Button>
              )}
              {summary.can_record && Number(summary.pending) > 0 && (
                <Button size="sm" variant={summary.status === "paid" ? "secondary" : "primary"} disabled={busy !== null} onClick={openForm}>
                  <Icon name="plus" className="h-3.5 w-3.5" />
                  Record payment
                </Button>
              )}
              {summary.status === "completed" && (
                <Button size="sm" variant="secondary" loading={busy === "reopen"} disabled={busy !== null} onClick={() => act("reopen", () => api.delete(`/quotations/${quotationId}/payments/complete`), "Payment reopened.")}>
                  Reopen
                </Button>
              )}
            </div>
          )
        }
      />

      {error && !state && (
        <div className="p-5">
          <Alert>{error.message}</Alert>
        </div>
      )}
      {!state && !error && <div className="m-5 h-20 animate-pulse rounded bg-neutral-50" />}

      {summary && state && (
        <>
          <div className="grid gap-4 p-5 sm:grid-cols-3">
            {[
              ["Quotation total", summary.total],
              ["Received", summary.paid],
              ["Pending", summary.pending],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-neutral-200 px-4 py-3">
                <p className="text-xs text-neutral-500">{label}</p>
                <p className="mt-1 text-lg font-semibold text-ink">{formatMoney(value, currency)}</p>
              </div>
            ))}
            <div className="sm:col-span-3">
              <div className="h-2 rounded-full bg-neutral-100" role="progressbar" aria-valuenow={Math.round(paidShare)} aria-valuemin={0} aria-valuemax={100} aria-label="Share of the total received">
                <div className="h-2 rounded-full bg-brand transition-all" style={{ width: `${paidShare}%` }} />
              </div>
              {summary.status === "paid" && (
                <p className="mt-2 text-xs text-neutral-600">The full amount is received. Mark the payment complete to close it.</p>
              )}
              {summary.status === "completed" && summary.completed_at && (
                <p className="mt-2 text-xs text-neutral-600">
                  Completed {formatDateTime(summary.completed_at)}
                  {summary.completed_by ? ` by ${summary.completed_by}` : ""}.
                </p>
              )}
            </div>
          </div>

          {state.payments.length === 0 ? (
            <p className="border-t border-neutral-100 px-5 py-8 text-center text-sm text-neutral-500">No payments recorded yet.</p>
          ) : (
            <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
              {state.payments.map((payment) => (
                <li key={payment.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold text-ink">
                      {formatMoney(payment.amount, currency)}
                      <span className="font-normal text-neutral-500"> · {formatDay(payment.paid_on)}</span>
                    </p>
                    <p className="text-sm text-neutral-700">
                      {payment.method_label} · Received by {payment.received_by_label}
                      {payment.reference && <span className="text-neutral-500"> · Ref {payment.reference}</span>}
                    </p>
                    {payment.notes && <p className="whitespace-pre-line text-xs text-neutral-600">{payment.notes}</p>}
                    <p className="text-xs text-neutral-400">Recorded by {payment.recorded_by ?? "Unknown"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {payment.attachment && (
                      <button
                        type="button"
                        onClick={() => openProtectedFile(`/payments/${payment.id}/attachment`).catch((e: ApiError) => toast.error(e.message))}
                        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:border-ink"
                        title={payment.attachment.name}
                      >
                        <Icon name="fileText" className="h-3.5 w-3.5" />
                        Screenshot
                      </button>
                    )}
                    {payment.can_delete && (
                      <Button variant="ghost" size="sm" aria-label="Remove payment" onClick={() => setRemoving(payment.id)} disabled={busy !== null}>
                        <Icon name="trash" className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        title="Record payment"
        description={summary ? `${formatMoney(summary.pending, currency)} pending of ${formatMoney(summary.total, currency)}.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)} disabled={busy === "record"}>
              Cancel
            </Button>
            <Button type="submit" form="record-payment" loading={busy === "record"}>
              Save payment
            </Button>
          </>
        }
      >
        {form && options && (
          <form id="record-payment" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            {formError && formError.status !== 422 && (
              <div className="sm:col-span-2">
                <Alert>{formError.message}</Alert>
              </div>
            )}
            <FormInput
              label="Amount received (₹)"
              required
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              value={form.amount}
              onChange={set("amount")}
              error={fieldError("amount")}
            />
            <FormInput label="Payment date" required type="date" max={today()} value={form.paid_on} onChange={set("paid_on")} error={fieldError("paid_on")} />
            <Select
              label="Received by"
              required
              placeholder="Select one"
              options={options.receivers}
              value={form.received_by}
              onChange={(received_by) => setForm({ ...form, received_by })}
              error={fieldError("received_by")}
            />
            <Select
              label="Payment method"
              required
              placeholder="Select method"
              options={options.methods}
              value={form.method}
              onChange={(method) => setForm({ ...form, method })}
              error={fieldError("method")}
            />
            {form.method === "custom" && (
              <FormInput
                className="sm:col-span-2"
                label="Method name"
                required
                placeholder="e.g. Paytm, PhonePe"
                maxLength={60}
                value={form.method_detail}
                onChange={set("method_detail")}
                error={fieldError("method_detail")}
              />
            )}
            <FormInput
              className="sm:col-span-2"
              label="Reference"
              placeholder="Transaction ID, cheque number…"
              maxLength={100}
              value={form.reference}
              onChange={set("reference")}
              error={fieldError("reference")}
            />
            <Field
              className="sm:col-span-2"
              label="Payment screenshot"
              required
              htmlFor="payment-attachment"
              error={fieldError("attachment")}
              hint={`JPG, PNG, WebP or PDF, up to ${Math.round(options.max_attachment_bytes / 1024 / 1024)} MB.`}
            >
              <input
                id="payment-attachment"
                type="file"
                required
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => setForm({ ...form, attachment: e.target.files?.[0] ?? null })}
                className={`${inputClass} file:mr-3 file:rounded file:border-0 file:bg-neutral-100 file:px-2 file:py-1 file:text-sm ${fieldError("attachment") ? inputErrorClass : ""}`}
              />
            </Field>
            <TextArea className="sm:col-span-2" label="Notes" rows={2} maxLength={1000} value={form.notes} onChange={set("notes")} error={fieldError("notes")} />
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        title="Remove payment?"
        message="The payment and its screenshot will be deleted, and the pending amount goes back up. This is recorded in the activity log."
        confirmLabel="Remove"
        loading={busy === "remove"}
        onConfirm={() => {
          const id = removing!;
          setRemoving(null);
          act("remove", () => api.delete(`/payments/${id}`), "Payment removed.");
        }}
        onClose={() => setRemoving(null)}
      />
    </Card>
  );
}
