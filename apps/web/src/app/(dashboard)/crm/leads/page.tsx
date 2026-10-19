"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { qs, type CrmLead } from "@/lib/crm";
import { useCrmUi } from "@/store/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BdmSelect, ErrorState, LoadingBlock, PageHeader } from "@/components/crm/ui";
import { LeadTable } from "./LeadTable";

const TABS = [
  { key: "pending", label: "Not contacted" },
  { key: "today", label: "Due today" },
  { key: "overdue", label: "Overdue" },
  { key: "open", label: "All open" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "all", label: "Everything" },
];

export default function MyLeadsPage() {
  const params = useSearchParams()!;
  const openInquiry = useCrmUi((s) => s.openInquiry);
  const [status, setStatus] = useState(() => (TABS.some((t) => t.key === params.get("status")) ? params.get("status")! : "open"));
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [bdm, setBdm] = useState("");
  const [page, setPage] = useState(1);
  const limit = 50;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "leads", status, search, bdm, page],
    queryFn: () => api<{ rows: CrmLead[]; total: number }>(`/crm/leads${qs({ status, q: search, bdm, page, limit, sort: ["today", "overdue", "open"].includes(status) ? "followup" : undefined })}`),
    placeholderData: (prev) => prev,
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;

  return (
    <div className="page space-y-5">
      <PageHeader title="Leads" subtitle="Click a lead to call, WhatsApp and log the follow-up">
        <Button onClick={openInquiry}><UserPlus className="size-4" />Add Inquiry</Button>
      </PageHeader>

      <div className="card p-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 bg-muted/50 rounded-lg p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => { setStatus(t.key); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${status === t.key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <form className="flex items-center gap-2 ml-auto" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); setPage(1); }}>
          <BdmSelect value={bdm} onChange={(v) => { setBdm(v); setPage(1); }} includeUnassigned />
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, mobile or email" className="h-9 pl-8 w-56" />
          </div>
          <Button type="submit" size="sm" variant="outline" className="h-9">Search</Button>
        </form>
      </div>

      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <>
          <LeadTable rows={data.rows} title={`${TABS.find((t) => t.key === status)?.label} · ${data.total} leads`} csvName={`leads-${status}`} />
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="text-muted-foreground">Page {page} of {pages}</span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
