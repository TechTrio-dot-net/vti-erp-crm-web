"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { Quotation, QuotationLookups, QuotationStatus } from "@/lib/erp/types";
import { ApiError, api } from "@/lib/erp/api";
import { useApi } from "@/lib/erp/use-api";
import { useAuth } from "@/lib/erp/auth-context";
import { PaymentsPanel } from "@/components/erp/payments/PaymentsPanel";
import { QuotationDocument } from "@/components/erp/quotation/QuotationDocument";
import { StatusBadge } from "@/components/erp/quotation/StatusBadge";
import { Alert } from "@/components/erp/ui/Card";
import { Button, buttonClass } from "@/components/erp/ui/Button";
import { ConfirmDialog } from "@/components/erp/ui/ConfirmDialog";
import { Icon } from "@/components/erp/ui/Icon";
import { Spinner } from "@/components/erp/ui/Spinner";
import { useToast } from "@/components/erp/ui/Toast";
import { CRM_ROLES } from "@/lib/crm";
import { useAuthStore } from "@/store/auth";
import { useCrmUi } from "@/store/crm";

const STATUS_ACTIONS: Record<QuotationStatus, { label: string; variant: "primary" | "secondary" | "danger" }> = {
  sent: { label: "Mark as sent", variant: "primary" },
  accepted: { label: "Mark accepted", variant: "primary" },
  rejected: { label: "Mark rejected", variant: "secondary" },
  draft: { label: "Revert to draft", variant: "secondary" },
  cancelled: { label: "Cancel quotation", variant: "danger" },
};

export default function QuotationPage() {
  const { id } = useParams<{ id: string }>()!;
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const role = useAuthStore((s) => s.user?.role);
  const openLead = useCrmUi((s) => s.openLead);
  const { data, error, reload } = useApi<{ data: Quotation }>(`/quotations/${id}`);
  const lookups = useApi<{ data: QuotationLookups }>("/lookups/quotation-form").data?.data;
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const q = data?.data;

  if (error && !q) return <Alert>{error.message}</Alert>;
  if (!q) {
    return (
      <div className="flex justify-center py-20">
        <Spinner label="Loading quotation…" />
      </div>
    );
  }

  async function changeStatus(status: QuotationStatus) {
    setBusy(status);
    try {
      await api.patch(`/quotations/${q!.id}/status`, { status });
      toast.success(`Quotation marked ${status}.`);
      reload();
    } catch (e) {
      toast.error((e as ApiError).field("status") ?? (e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    try {
      await api.delete(`/quotations/${q!.id}`);
      toast.success(`Quotation ${q!.quotation_number} deleted.`);
      router.push("/quotations");
    } catch (e) {
      toast.error((e as ApiError).message);
      setBusy(null);
      setConfirmDelete(false);
    }
  }

  const editable = q.can.update && !["accepted", "cancelled"].includes(q.status);

  return (
    <>
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/quotations" className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100" aria-label="Back to quotations">
            <Icon name="chevronLeft" />
          </Link>
          <h1 className="text-xl font-semibold text-ink">{q.quotation_number}</h1>
          <StatusBadge status={q.status} />
          {q.lead_id && CRM_ROLES.includes(role ?? "") && (
            <button type="button" onClick={() => openLead(q.lead_id!)} className={buttonClass("ghost", "sm")}>
              <Icon name="users" className="h-3.5 w-3.5" />
              CRM lead
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {q.next_statuses.map((status) => (
            <Button key={status} variant={STATUS_ACTIONS[status].variant} size="sm" loading={busy === status} disabled={busy !== null} onClick={() => changeStatus(status)}>
              {STATUS_ACTIONS[status].label}
            </Button>
          ))}
          {editable && (
            <Link href={`/quotations/${q.id}/edit`} className={buttonClass("secondary", "sm")}>
              <Icon name="pencil" className="h-3.5 w-3.5" />
              Edit
            </Link>
          )}
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Icon name="printer" className="h-3.5 w-3.5" />
            Print / Save PDF
          </Button>
          {q.can.delete && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} className="text-ink hover:bg-ink hover:text-paper">
              <Icon name="trash" className="h-3.5 w-3.5" />
              Delete
            </Button>
          )}
        </div>
      </div>

      {q.notes && (
        <div className="no-print mx-auto mb-4 max-w-[210mm]">
          <Alert tone="info">
            <span className="font-medium">Internal notes:</span> <span className="whitespace-pre-line">{q.notes}</span>
          </Alert>
        </div>
      )}

      <QuotationDocument quotation={q} company={lookups?.company} />

      {/* Not printed: payments are internal. Shown while payable, or once anything has been received. */}
      {can("payments.record") && (!["rejected", "cancelled"].includes(q.status) || Number(q.payment.paid) > 0) && (
        <div id="payments" className="no-print mx-auto mt-6 max-w-[210mm] scroll-mt-20">
          <PaymentsPanel quotationId={q.id} currency={q.currency} onChange={reload} />
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete quotation?"
        message={`${q.quotation_number} for ${q.client_name} will be removed from all lists. This is recorded in the activity log.`}
        confirmLabel="Delete"
        loading={busy === "delete"}
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}
