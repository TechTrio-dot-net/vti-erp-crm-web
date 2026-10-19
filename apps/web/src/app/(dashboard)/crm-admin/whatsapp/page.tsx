"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/crm";
import { useCrmUi } from "@/store/crm";
import { AdminOnly, BdmSelect, DataTable, DateRangeFilter, ErrorState, FilterBar, LoadingBlock, PageHeader, lastDays } from "@/components/crm/ui";

type Row = { id: string; phone: string; message: string | null; createdAt: string; userName: string | null; leadId: string | null; leadName: string | null };

export default function WhatsappLogPage() {
  return <AdminOnly><WhatsappLog /></AdminOnly>;
}

function WhatsappLog() {
  const openLead = useCrmUi((s) => s.openLead);
  const [range, setRange] = useState(lastDays(7));
  const [bdm, setBdm] = useState("");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "whatsapp", range, bdm],
    queryFn: () => api<{ rows: Row[] }>(`/crm/reports/whatsapp-log?from=${range.from}&to=${range.to}${bdm ? `&bdm=${bdm}` : ""}`),
  });
  return (
    <div className="page space-y-5">
      <PageHeader title="WhatsApp Message Log" subtitle="Chats BDMs opened from a lead (WhatsApp button in the lead window)" />
      <FilterBar><DateRangeFilter value={range} onChange={setRange} /><BdmSelect value={bdm} onChange={setBdm} /></FilterBar>
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <DataTable
          csvName="whatsapp-log"
          rows={data.rows}
          empty="No WhatsApp chats opened in this period"
          onRowClick={(r) => r.leadId && openLead(r.leadId)}
          columns={[
            { key: "createdAt", label: "When", render: (r) => fmtDateTime(r.createdAt) },
            { key: "userName", label: "BDM" },
            { key: "leadName", label: "Lead", className: "font-semibold" },
            { key: "phone", label: "WhatsApp number" },
            { key: "message", label: "Message", className: "text-muted-foreground" },
          ]}
        />
      )}
    </div>
  );
}
