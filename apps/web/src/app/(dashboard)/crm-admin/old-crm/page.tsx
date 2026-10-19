"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminOnly, DataTable, ErrorState, LoadingBlock, PageHeader, selectCls } from "@/components/crm/ui";

type Row = Record<string, string | null>;

/** What the old PHP CRM's tables held, for people who never saw its database */
const LABELS: Record<string, string> = {
  re_leads: "Leads",
  re_leads_fups: "Follow-ups (calls and remarks)",
  lead_transferhistory: "Lead transfers",
  lead_log_data: "Automatic lead assignments",
  goold_api_media: "Meta lead-form rows",
  goold_api_media_master: "Google Sheet check log",
  bdm_master: "BDMs",
  user_master: "Logins",
  user_rights: "Login rights",
  campaign_master: "Campaigns",
  campaign_wise_bdm: "Campaign → BDM rules",
  status: "Statuses",
  lost_reasons: "Lost reasons",
  service_master: "Services",
  payment_due: "Payments due",
  payment_done: "Payments done",
  payment_approval_history: "Payment approvals",
  company_bank: "Company bank accounts",
  booking_installments: "Booking installments",
  booking_cheque_details: "Booking cheques",
  cheque_status_history: "Cheque status history",
  temp_sql_log: "System query log",
  last_call_record: "Last call records",
  main_menu: "Menus",
  sub_menu: "Sub-menus",
  dashboard_queries: "Dashboard queries",
  mytable: "Imported sheet (Voucher inquiries)",
};

const label = (table: string) => (LABELS[table] ? `${LABELS[table]} (${table})` : table);
const PAGE = 50;

export default function OldCrmArchivePage() {
  return <AdminOnly><OldCrmArchive /></AdminOnly>;
}

function OldCrmArchive() {
  const [table, setTable] = useState("re_leads_fups");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const tables = useQuery({ queryKey: ["crm", "archive"], queryFn: () => api<{ tables: Array<{ name: string; rows: number }> }>("/crm/archive") });
  const rows = useQuery({
    queryKey: ["crm", "archive", table, search, page],
    queryFn: () => api<{ total: number; columns: string[]; rows: Row[] }>(`/crm/archive/${encodeURIComponent(table)}?limit=${PAGE}&page=${page}${search ? `&q=${encodeURIComponent(search)}` : ""}`),
  });

  const columns = rows.data?.columns ?? [];
  const pages = rows.data ? Math.max(1, Math.ceil(rows.data.total / PAGE)) : 1;
  const totalRows = tables.data?.tables.reduce((n, t) => n + t.rows, 0) ?? 0;

  /** The whole table (or the search result), fetched in pages of 1,000 */
  const exportAll = async () => {
    setExporting(true);
    try {
      const all: Row[] = [];
      let header: string[] = [];
      for (let p = 1; ; p++) {
        const chunk = await api<{ total: number; columns: string[]; rows: Row[] }>(`/crm/archive/${encodeURIComponent(table)}?limit=1000&page=${p}${search ? `&q=${encodeURIComponent(search)}` : ""}`);
        all.push(...chunk.rows);
        header = chunk.columns;
        if (all.length >= chunk.total || !chunk.rows.length) break;
      }
      downloadCsv(`old-crm-${table}.csv`, header, all.map((r) => header.map((h) => r[h] ?? "")));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page space-y-5">
      <PageHeader
        title="Old CRM Archive"
        subtitle={tables.data ? `Every row of the old PHP CRM, exactly as it was — ${totalRows.toLocaleString("en-IN")} rows in ${tables.data.tables.length} tables` : "Every row of the old PHP CRM, exactly as it was"}
      >
        <Button variant="outline" disabled={exporting || !rows.data?.total} onClick={exportAll}>
          {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}Export table
        </Button>
      </PageHeader>

      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold">Table</p>
          <select value={table} onChange={(e) => { setTable(e.target.value); setPage(1); }} className={`${selectCls} w-96 max-w-full`}>
            {tables.data?.tables.map((t) => <option key={t.name} value={t.name}>{label(t.name)} — {t.rows.toLocaleString("en-IN")}</option>)}
          </select>
        </div>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); setPage(1); }}>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any column (name, mobile, remark…)" className="h-9 pl-8 w-80" />
          </div>
          <Button type="submit" size="sm" variant="outline" className="h-9">Search</Button>
        </form>
      </div>

      {tables.isError || rows.isError ? <ErrorState /> : rows.isLoading || !rows.data ? <LoadingBlock /> : (
        <>
          <DataTable
            title={`${LABELS[table] ?? table} · ${rows.data.total.toLocaleString("en-IN")} rows${search ? ` matching “${search}”` : ""}`}
            rows={rows.data.rows}
            empty={search ? "No rows match" : "This table is empty"}
            columns={columns.map((c) => ({
              key: c,
              label: c,
              className: "max-w-xs",
              render: (r: Row) => (r[c] === null || r[c] === "" ? <span className="text-muted-foreground/50">—</span> : <span className="line-clamp-3 whitespace-pre-wrap" title={r[c] ?? ""}>{r[c]}</span>),
            }))}
          />
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="text-muted-foreground">Page {page} of {pages.toLocaleString("en-IN")}</span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
