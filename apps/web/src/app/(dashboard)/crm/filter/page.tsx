"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { STAGES, qs, type CrmLead } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BdmSelect, ErrorState, LoadingBlock, PageHeader, lastDays, selectCls, useServices } from "@/components/crm/ui";
import { LeadTable } from "../leads/LeadTable";

const EMPTY = { q: "", status: "all", source: "", campaign: "", city: "", serviceId: "", manual: "", dateField: "created", ...lastDays(30), bdm: "" };

export default function LeadFilterPage() {
  const [draft, setDraft] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const { data: services } = useServices();
  const limit = 100;
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "filter", applied, page],
    queryFn: () => api<{ rows: CrmLead[]; total: number }>(`/crm/leads${qs({ ...applied, page, limit })}`),
    placeholderData: (prev) => prev,
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;

  return (
    <div className="page space-y-5">
      <PageHeader title="Lead Filter" subtitle="Find any set of leads and export them" />
      <form className="card p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3" onSubmit={(e) => { e.preventDefault(); setApplied(draft); setPage(1); }}>
        <Input value={draft.q} onChange={set("q")} placeholder="Name, mobile or email" className="h-9" />
        <select value={draft.status} onChange={set("status")} className={selectCls}>
          <option value="all">Any status</option>
          <option value="open">Open</option>
          <option value="pending">Not contacted</option>
          <option value="due">Follow-up due</option>
          <option value="overdue">Overdue</option>
          {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <BdmSelect value={draft.bdm} onChange={(v) => setDraft((d) => ({ ...d, bdm: v }))} includeUnassigned />
        <select value={draft.serviceId} onChange={set("serviceId")} className={selectCls}>
          <option value="">Any service</option>
          {services?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <Input value={draft.source} onChange={set("source")} placeholder="Source (exact, e.g. Meta Ads)" className="h-9" />
        <Input value={draft.campaign} onChange={set("campaign")} placeholder="Campaign (exact)" className="h-9" />
        <Input value={draft.city} onChange={set("city")} placeholder="City" className="h-9" />
        <select value={draft.manual} onChange={set("manual")} className={selectCls}>
          <option value="">Manual + imported</option>
          <option value="no">Imported only</option>
          <option value="only">Manual entries only</option>
        </select>
        <select value={draft.dateField} onChange={set("dateField")} className={selectCls}>
          <option value="created">Received date</option>
          <option value="assigned">Assigned date</option>
          <option value="followup">Follow-up date</option>
          <option value="contacted">Last contact date</option>
          <option value="closed">Closed date</option>
        </select>
        <input type="date" value={draft.from} onChange={set("from")} className={selectCls} aria-label="From" />
        <input type="date" value={draft.to} onChange={set("to")} className={selectCls} aria-label="To" />
        <div className="flex gap-2">
          <Button type="submit" className="flex-1">Apply</Button>
          <Button type="button" variant="outline" onClick={() => { setDraft(EMPTY); setApplied(EMPTY); setPage(1); }}>Reset</Button>
        </div>
      </form>
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <>
          <LeadTable rows={data.rows} title={`${data.total} leads found`} csvName="lead-filter" />
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
