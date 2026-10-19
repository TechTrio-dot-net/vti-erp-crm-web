"use client";

import { AdminOnly, PageHeader } from "@/components/crm/ui";
import { ImportsTable } from "./ImportsTable";

export default function RealTimeLeadDataPage() {
  return (
    <AdminOnly>
      <div className="page space-y-5">
        <PageHeader title="Real Time Lead Data" subtitle="Every row received from Google Sheets and Meta, and what happened to it (refreshes every 30s)" />
        <ImportsTable />
      </div>
    </AdminOnly>
  );
}
