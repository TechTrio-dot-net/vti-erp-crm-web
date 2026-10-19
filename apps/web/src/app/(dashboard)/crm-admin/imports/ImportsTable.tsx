"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { fmtDateTime, qs, stageMeta } from "@/lib/crm";
import { useCrmUi } from "@/store/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, DateRangeFilter, ErrorState, FilterBar, LoadingBlock, lastDays, selectCls } from "@/components/crm/ui";

type ImportRow = {
  id: string; status: string; error: string | null; raw: Record<string, unknown>; campaign: string | null; receivedAt: string; externalId: string;
  sourceName: string; sourceType: string; leadId: string | null; leadName: string | null; leadStage: string | null;
  mapped: { name: string; phone: string; email: string; city: string; campaign: string };
};

const STATUS_BADGE: Record<string, string> = { imported: "badge-green", duplicate: "badge-amber", error: "badge-red", ignored: "badge-gray" };
const STATUS_LABEL: Record<string, string> = { imported: "Lead created", duplicate: "Repeat enquiry", error: "Failed", ignored: "Ignored" };

/** Shared by "Real Time Lead Data" (everything) and "Verify Data" (failed rows to fix) */
export function ImportsTable({ fixedStatus }: { fixedStatus?: string }) {
  const queryClient = useQueryClient();
  const openLead = useCrmUi((s) => s.openLead);
  const [range, setRange] = useState(lastDays(fixedStatus ? 90 : 7));
  const [status, setStatus] = useState(fixedStatus ?? "");
  const [sourceId, setSourceId] = useState("");
  const [page, setPage] = useState(1);
  const [fixing, setFixing] = useState<ImportRow | null>(null);
  const [fix, setFix] = useState({ full_name: "", phone_number: "", email: "" });
  const limit = 100;

  const { data: sources } = useQuery({ queryKey: ["crm", "sources"], queryFn: () => api<{ sources: Array<{ id: string; name: string }> }>("/integrations/sources") });
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "imports", range, status, sourceId, page],
    queryFn: () => api<{ rows: ImportRow[]; total: number; statusCounts: Array<{ status: string; count: number }> }>(`/integrations/imports${qs({ ...range, status, sourceId, page, limit })}`),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["crm"] });

  const retry = useMutation({
    mutationFn: ({ id, overrides }: { id: string; overrides?: object }) => api<{ outcome: string }>(`/integrations/imports/${id}/retry`, { method: "POST", body: JSON.stringify({ overrides }) }),
    onSuccess: (r) => { toast[r.outcome === "error" ? "error" : "success"](r.outcome === "imported" ? "Lead created and assigned" : r.outcome === "duplicate" ? "Matched an existing open lead" : "Still failing — check the details"); setFixing(null); refresh(); },
  });
  const ignore = useMutation({
    mutationFn: (id: string) => api(`/integrations/imports/${id}/ignore`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => { toast.success("Row ignored"); refresh(); },
  });

  const pages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;

  return (
    <div className="space-y-5">
      <FilterBar>
        <DateRangeFilter value={range} onChange={(r) => { setRange(r); setPage(1); }} />
        {!fixedStatus && (
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={selectCls}>
            <option value="">All results</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
        <select value={sourceId} onChange={(e) => { setSourceId(e.target.value); setPage(1); }} className={selectCls}>
          <option value="">All sources</option>
          {sources?.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </FilterBar>
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <>
          <DataTable
            title={`${data.total} rows`}
            csvName={fixedStatus ? "verify-lead-data" : "realtime-lead-data"}
            rows={data.rows}
            empty={fixedStatus ? "No failed rows — everything imported cleanly 🎉" : "Nothing received in this period"}
            columns={[
              { key: "receivedAt", label: "Received", render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.receivedAt)}</span> },
              { key: "source", label: "Source", render: (r) => r.sourceName, csv: (r) => r.sourceName },
              { key: "name", label: "Name", render: (r) => r.mapped.name || <span className="text-red-600">missing</span>, csv: (r) => r.mapped.name },
              { key: "phone", label: "Mobile", render: (r) => r.mapped.phone || <span className="text-red-600">missing</span>, csv: (r) => r.mapped.phone },
              { key: "email", label: "Email", render: (r) => r.mapped.email || "—", csv: (r) => r.mapped.email },
              { key: "campaign", label: "Campaign", render: (r) => r.campaign ?? "—" },
              { key: "status", label: "Result", render: (r) => <div><span className={`badge ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status] ?? r.status}</span>{r.error && r.status !== "ignored" && <p className="text-[11px] text-red-600 mt-0.5 max-w-[220px]">{r.error}</p>}</div>, csv: (r) => `${STATUS_LABEL[r.status]}${r.error ? ` (${r.error})` : ""}` },
              {
                key: "lead", label: "Lead",
                render: (r) => r.leadId ? (
                  <button type="button" className="text-primary-text hover:underline text-left" onClick={() => openLead(r.leadId!)}>
                    {r.leadName} {r.leadStage && <span className={`badge ${stageMeta(r.leadStage).badge} ml-1`}>{stageMeta(r.leadStage).label}</span>}
                  </button>
                ) : r.status === "error" ? (
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="h-7" onClick={() => { setFixing(r); setFix({ full_name: r.mapped.name, phone_number: r.mapped.phone, email: r.mapped.email }); }}>Fix</Button>
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => ignore.mutate(r.id)}>Ignore</Button>
                  </div>
                ) : "—",
                csv: (r) => r.leadName,
              },
            ]}
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

      <Dialog open={!!fixing} onOpenChange={(o) => !o && setFixing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Fix and import row</DialogTitle></DialogHeader>
          {fixing && (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); retry.mutate({ id: fixing.id, overrides: fix }); }}>
              <p className="text-xs text-red-600">{fixing.error}</p>
              <div className="space-y-1.5"><Label>Name</Label><Input value={fix.full_name} onChange={(e) => setFix((f) => ({ ...f, full_name: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Mobile</Label><Input value={fix.phone_number} onChange={(e) => setFix((f) => ({ ...f, phone_number: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Email</Label><Input value={fix.email} onChange={(e) => setFix((f) => ({ ...f, email: e.target.value }))} /></div>
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Raw data received</summary>
                <pre className="mt-2 bg-muted/50 rounded p-2 overflow-x-auto">{JSON.stringify(fixing.raw, null, 2)}</pre>
              </details>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setFixing(null)}>Cancel</Button>
                <Button type="submit" disabled={retry.isPending}>{retry.isPending ? "Importing…" : "Import"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
