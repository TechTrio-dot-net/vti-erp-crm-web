"use client";

import { useEffect, useState } from "react";
import type { Id, Paginated } from "@/lib/erp/types";
import { withQuery } from "@/lib/erp/api";
import { useApi } from "@/lib/erp/use-api";
import { formatDateTime, humanize } from "@/lib/erp/format";
import { cn } from "@/lib/erp/cn";
import { DataTable, type Column } from "@/components/erp/DataTable";
import { RequirePermission } from "@/components/erp/RequirePermission";
import { Badge, type BadgeTone } from "@/components/erp/ui/Badge";
import { Alert, PageHeader } from "@/components/erp/ui/Card";
import { inputClass } from "@/components/erp/ui/FormInput";
import { Icon } from "@/components/erp/ui/Icon";
import { Select } from "@/components/erp/ui/Select";

interface LogEntry {
  id: Id;
  event: string;
  description: string;
  subject_type: string | null;
  subject_id: Id | null;
  user: string | null;
  ip_address: string | null;
  created_at: string;
}

const EVENT_TONES: Record<string, BadgeTone> = {
  created: "brand",
  updated: "soft",
  deleted: "dark",
  status_changed: "outline",
  login: "muted",
  logout: "muted",
};

const COLUMNS: Column<LogEntry>[] = [
  { key: "when", header: "When", cell: (row) => <span className="whitespace-nowrap text-xs">{formatDateTime(row.created_at)}</span> },
  { key: "user", header: "User", cell: (row) => row.user ?? "System" },
  { key: "event", header: "Event", cell: (row) => <Badge tone={EVENT_TONES[row.event] ?? "muted"}>{humanize(row.event)}</Badge> },
  { key: "description", header: "Description", cell: (row) => <span className="text-neutral-800">{row.description}</span> },
  { key: "subject", header: "Record", cell: (row) => (row.subject_type ? <span className="text-xs text-neutral-500">{`${row.subject_type} #${row.subject_id}`}</span> : "—") },
  { key: "ip", header: "IP", cell: (row) => <span className="font-mono text-xs text-neutral-500">{row.ip_address ?? "—"}</span> },
];

export default function ActivityLogsPage() {
  return (
    <RequirePermission permission="activity_logs.view">
      <ActivityLogs />
    </RequirePermission>
  );
}

function ActivityLogs() {
  const [page, setPage] = useState(1);
  const [event, setEvent] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data, error, loading } = useApi<Paginated<LogEntry>>(withQuery("/admin/activity-logs", { page, event, from, to, search }));

  return (
    <>
      <PageHeader title="Activity Log" description="Sign-ins and every change made to ERP data." />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search descriptions" aria-label="Search" className={cn(inputClass, "pl-9")} />
        </div>
        <Select
          className="w-44"
          aria-label="Event"
          placeholder="All events"
          options={Object.keys(EVENT_TONES).map((value) => ({ value, label: humanize(value) }))}
          value={event}
          onChange={(value) => {
            setEvent(value);
            setPage(1);
          }}
        />
        <input type="date" aria-label="From date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className={cn(inputClass, "w-40")} />
        <input type="date" aria-label="To date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className={cn(inputClass, "w-40")} />
      </div>

      {error && (
        <div className="mb-4">
          <Alert>{error.message}</Alert>
        </div>
      )}

      <DataTable columns={COLUMNS} rows={data?.data} rowKey={(row) => row.id} loading={loading} meta={data?.meta} onPageChange={setPage} emptyMessage="No activity matches your filters." />
    </>
  );
}
