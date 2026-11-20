"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, fmtDay, qs, type CrmLead } from "@/lib/crm";
import { useCrmUi } from "@/store/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BdmSelect, ErrorState, LoadingBlock, PageHeader } from "@/components/crm/ui";
import { LeadTable } from "./LeadTable";

/** YYYY-MM-DD in local time, `days` from today */
const isoDay = (days = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const TABS = [
  { key: "pending", label: "Not contacted" },
  { key: "today", label: "Due today" },
  { key: "overdue", label: "Overdue" },
  { key: "open", label: "All open" },
  { key: "interested", label: "Interested" },
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
  // Interested tab: a date range, which date to go by, and an optional single day picked from the strip
  const interested = status === "interested";
  const [from, setFrom] = useState(() => isoDay(-29));
  const [to, setTo] = useState(() => isoDay());
  const [by, setBy] = useState<"interested" | "received">("interested");
  const [day, setDay] = useState("");
  const dateQuery = interested
    ? { from: day || from, to: day || to, dateField: by === "received" ? undefined : "interested", sort: by === "received" ? undefined : "interested" }
    : {};

  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "leads", status, search, bdm, page, dateQuery],
    queryFn: () => api<{ rows: CrmLead[]; total: number }>(`/crm/leads${qs({ status, q: search, bdm, page, limit, sort: ["today", "overdue", "open"].includes(status) ? "followup" : undefined, ...dateQuery })}`),
    placeholderData: (prev) => prev,
  });
  const days = useQuery({
    queryKey: ["crm", "interested-days", bdm, from, to, by],
    queryFn: () => api<{ days: { day: string; count: number }[] }>(`/crm/leads/interested-days${qs({ bdm, from, to, by })}`),
    enabled: interested,
  });
  const resetDay = () => { setDay(""); setPage(1); };
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

      {interested && (
        <div className="card p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Date by</span>
            <select value={by} onChange={(e) => { setBy(e.target.value as "interested" | "received"); resetDay(); }} className="h-9 rounded-md border bg-background px-2">
              <option value="interested">Turned interested on</option>
              <option value="received">Lead received on</option>
            </select>
            <span className="text-muted-foreground ml-2">From</span>
            <Input type="date" value={from} max={to} onChange={(e) => { if (e.target.value) { setFrom(e.target.value); resetDay(); } }} className="h-9 w-40" />
            <span className="text-muted-foreground">to</span>
            <Input type="date" value={to} min={from} onChange={(e) => { if (e.target.value) { setTo(e.target.value); resetDay(); } }} className="h-9 w-40" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={resetDay}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border ${!day ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}
            >
              All days · {days.data?.days.reduce((n, d) => n + d.count, 0) ?? "…"}
            </button>
            {days.data?.days.map((d) => (
              <button
                key={d.day}
                type="button"
                onClick={() => { setDay(d.day === day ? "" : d.day); setPage(1); }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium border ${day === d.day ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}
              >
                {fmtDay(d.day)} · {d.count}
              </button>
            ))}
            {days.data && days.data.days.length === 0 && <span className="text-xs text-muted-foreground py-1">No interested leads in this range</span>}
          </div>
        </div>
      )}

      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <>
          <LeadTable
            rows={data.rows}
            title={`${TABS.find((t) => t.key === status)?.label}${interested && day ? ` · ${fmtDay(day)}` : ""} · ${data.total} leads`}
            csvName={`leads-${status}${interested ? `-${day || `${from}_to_${to}`}` : ""}`}
            extraColumns={interested ? [{ key: "interestedAt", label: "Interested on", render: (l) => <span className="whitespace-nowrap">{fmtDate(l.interestedAt)}</span>, csv: (l) => l.interestedAt ?? "" }] : undefined}
          />
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
