"use client";

import { useParams } from "next/navigation";
import type { Quotation } from "@/lib/erp/types";
import { useApi } from "@/lib/erp/use-api";
import { QuotationForm } from "@/components/erp/quotation/QuotationForm";
import { Alert, PageHeader } from "@/components/erp/ui/Card";
import { Spinner } from "@/components/erp/ui/Spinner";

export default function EditQuotationPage() {
  const { id } = useParams<{ id: string }>()!;
  const { data, error } = useApi<{ data: Quotation }>(`/quotations/${id}`);
  const quotation = data?.data;

  if (error) return <Alert>{error.message}</Alert>;
  if (!quotation) {
    return (
      <div className="flex justify-center py-20">
        <Spinner label="Loading quotation…" />
      </div>
    );
  }

  if (!quotation.can.update) {
    return <Alert tone="warning">This quotation can no longer be edited.</Alert>;
  }

  return (
    <>
      <PageHeader
        title={`Edit ${quotation.quotation_number}`}
        description="Saving re-prices every line with the pricing rules in force today."
      />
      <QuotationForm initial={quotation} />
    </>
  );
}
