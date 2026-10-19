"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { homePath } from "@/lib/permissions";
import { useAuth } from "@/lib/erp/auth-context";
import type { CrmLead } from "@/lib/crm";
import { RequirePermission } from "@/components/erp/RequirePermission";
import { QuotationForm } from "@/components/erp/quotation/QuotationForm";
import { Alert, PageHeader } from "@/components/erp/ui/Card";
import { Spinner } from "@/components/erp/ui/Spinner";

/** ?lead=<id> starts the quotation from a CRM lead: its contact details, and a link back to it */
function NewQuotation() {
  const leadId = useSearchParams()!.get("lead");
  const lead = useQuery({
    queryKey: ["crm", "lead", leadId],
    queryFn: () => api<CrmLead>(`/crm/leads/${leadId}`),
    enabled: !!leadId,
  });

  if (leadId && lead.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner label="Loading the lead…" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="New Quotation"
        description={
          lead.data
            ? `For CRM lead ${lead.data.name}. Prices are calculated by the server from the configured pricing rules.`
            : "Prices are calculated by the server from the configured pricing rules."
        }
      />
      {leadId && lead.isError && (
        <div className="mb-4">
          <Alert tone="warning">The lead could not be loaded, so this quotation won&apos;t be linked to it.</Alert>
        </div>
      )}
      <QuotationForm
        leadId={lead.data?.id}
        prefill={
          lead.data
            ? { client_name: lead.data.name, client_phone: lead.data.phone ?? "", client_email: lead.data.email ?? "", client_address: lead.data.city ?? "" }
            : undefined
        }
      />
    </>
  );
}

export default function NewQuotationPage() {
  const { user, can } = useAuth();
  const router = useRouter();
  const allowed = can("quotations.create");

  // Everyone lands here after signing in; send those who can't create quotations to their usual home page
  useEffect(() => {
    if (!allowed) router.replace(homePath(user.role?.slug ?? ""));
  }, [allowed, router, user.role?.slug]);

  if (!allowed) return null;

  return (
    <RequirePermission permission="quotations.create">
      <Suspense>
        <NewQuotation />
      </Suspense>
    </RequirePermission>
  );
}
