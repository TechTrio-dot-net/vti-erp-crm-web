"use client";

import { AdminOnly, PageHeader } from "@/components/crm/ui";
import { ImportsTable } from "../imports/ImportsTable";

export default function VerifyLeadDataPage() {
  return (
    <AdminOnly>
      <div className="page space-y-5">
        <PageHeader title="Verify Data (Lead)" subtitle="Rows that could not become leads — fix the details and import, or ignore them" />
        <ImportsTable fixedStatus="error" />
      </div>
    </AdminOnly>
  );
}
