"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ShoppingBag, Repeat, PhoneCall, UserX } from "lucide-react";
import { api } from "@/lib/api";
import { fmtCallDuration, fmtDateTime, inr, qs, stageBadgeWonLost, stageMeta, stageRowWonLost } from "@/lib/crm";
import { Input } from "@/components/ui/input";
import { ClientHistory, type ClientHistoryTarget } from "@/components/crm/ClientHistory";
import {
  AdminOnly, BdmSelect, DataTable, DateRangeFilter, ErrorState, FilterBar, LoadingBlock, PageHeader, StatCard,
  lastDays, selectCls,
} from "@/components/crm/ui";

type Row = {
  id: string; name: string; companyName: string; phone: string | null; email: string | null; city: string | null;
  source: string | null; campaign: string | null; service: string | null; stage: string;
  statusLabel: string | null; lostReason: string | null;
  cameAt: string; assignedAt: string | null; closedAt: string | null; firstCallAt: string | null; lastCallAt: string | null;
  calls: number; callsConnected: number; talkSec: number;
  orders: number; firstOrderAt: string | null; lastOrderAt: string | null; orderValue: number; orderPaid: number;
  estimatedValue: number | null; assignedName: string | null;
};
type Totals = { leads: number; ordered: number; repeat: number; lost: number; calls: number; value: number; paid: number };
/** `capped` means the period holds more clients than the list sends; the tiles still count all of them */
type Payload = { rows: Row[]; totals: Totals; capped: boolean };

/** What a row's "Orders" column counts. Drafts are never orders — nothing has reached the client yet. */
const ORDER_SCOPES = [
  { value: "confirmed", label: "Orders: accepted or paid" },
  { value: "all", label: "Orders: every quotation sent" },
];
const STAGE_FILTERS = [
  { value: "", label: "All leads" },
  { value: "open", label: "Open leads" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

export default function ClientLeisurePage() {
  return <AdminOnly><ClientLeisure /></AdminOnly>;
}

function ClientLeisure() {
  const [range, setRange] = useState(lastDays(90));
  const [bdm, setBdm] = useState("");
  const [stage, setStage] = useState("");
  const [orders, setOrders] = useState("confirmed");
  const [q, setQ] = useState("");
  /** Set by the tiles above the table: "" is everyone, the rest narrow the rows to what that tile counts */
  const [view, setView] = useState<"" | "ordered" | "repeat">("");
  const [open, setOpen] = useState<ClientHistoryTarget | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "client-leisure", range, bdm, stage, orders, view],
    queryFn: () => api<Payload>(`/crm/reports/client-leisure${qs({ from: range.from, to: range.to, bdm, stage, orders, has: view })}`),
  });

  // The tiles come from the server, counted over the whole period rather than the page of rows it sent, so
  // they agree with each other whichever one is pressed. Searching only narrows what is already loaded.
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return data?.rows ?? [];
    return (data?.rows ?? []).filter((r) =>
      [r.name, r.companyName, r.phone, r.email, r.city, r.campaign, r.assignedName]
        .some((v) => v?.toLowerCase().includes(needle))
    );
  }, [data, q]);

  return (
    <div className="page space-y-5">
      <PageHeader
        title="Client Leisure"
        subtitle="Every lead end to end — when it came in, every call made to it, and every order it placed. Open a row for the full timeline."
      />

      <FilterBar>
        <DateRangeFilter value={range} onChange={setRange} />
        <BdmSelect value={bdm} onChange={setBdm} />
        <select className={selectCls} value={stage} onChange={(e) => setStage(e.target.value)}>
          {STAGE_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select className={selectCls} value={orders} onChange={(e) => setOrders(e.target.value)}>
          {ORDER_SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, mobile, city, campaign…" className="h-9 w-72 pl-8" />
        </div>
      </FilterBar>

      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <>
          {/* Each tile narrows the table to the clients it counts; the one in force is ringed, and Clients clears it */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Clients" value={data.totals.leads} sub={`${data.totals.calls} calls made`} tone="blue" icon={PhoneCall}
              active={!view && !stage} onClick={() => { setView(""); setStage(""); }}
            />
            <StatCard
              label="Ordered" value={data.totals.ordered} sub={`${inr(data.totals.value)} ordered · ${inr(data.totals.paid)} paid`} tone="green" icon={ShoppingBag}
              active={view === "ordered"} onClick={() => setView(view === "ordered" ? "" : "ordered")}
            />
            <StatCard
              label="Repeat orders" value={data.totals.repeat} sub="More than one order" tone="sky" icon={Repeat}
              active={view === "repeat"} onClick={() => setView(view === "repeat" ? "" : "repeat")}
            />
            <StatCard
              label="Lost" value={data.totals.lost} sub="Reason on every row" tone="red" icon={UserX}
              active={stage === "lost"} onClick={() => { setView(""); setStage(stage === "lost" ? "" : "lost"); }}
            />
          </div>

          <DataTable
            title={data.capped ? "Client history — newest 3000, and every won client" : "Client history"}
            csvName="client-leisure"
            rows={rows}
            onRowClick={(r) => setOpen({ id: r.id, name: r.name })}
            rowClassName={(r) => stageRowWonLost(r.stage)}
            legend="wonLost"
            empty="No lead came in over this period"
            // Only what a scan of the list needs — the dates, calls and orders in full are a click away in the
            // dialog, and csvOnly keeps them in the export even though they have left the screen.
            columns={[
              { key: "cameAt", label: "Lead came in", render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.cameAt)}</span>, csv: (r) => r.cameAt },
              // Capped and clipped: one client whose name runs on would otherwise hold the whole table open
              { key: "name", label: "Client", className: "font-semibold", render: (r) => (
                <span className="block max-w-[12rem]">
                  <span className="block truncate" title={r.name}>{r.name}</span>
                  {r.companyName !== r.name && (
                    <span className="block truncate text-xs font-normal text-muted-foreground" title={r.companyName}>{r.companyName}</span>
                  )}
                </span>
              ), csv: (r) => r.name },
              { key: "phone", label: "Mobile", className: "whitespace-nowrap" },
              { key: "stage", label: "Stage", render: (r) => <span className={`badge ${stageBadgeWonLost(r.stage)}`}>{stageMeta(r.stage).label}</span>, csv: (r) => stageMeta(r.stage).label },
              { key: "calls", label: "Calls", align: "right", className: "whitespace-nowrap", render: (r) => (
                <span>
                  {r.calls}
                  <span className="block text-xs text-muted-foreground">{r.callsConnected} connected</span>
                </span>
              ), csv: (r) => r.calls },
              // A lost lead still shows its order count, so a 0 here is a fact about the client, not a blank
              { key: "orders", label: "Orders", align: "right", className: "whitespace-nowrap", render: (r) => (
                <span>
                  <span className="badge badge-gray">
                    {r.orders} {r.orders === 1 ? "order" : "orders"}
                  </span>
                  {r.orders > 0 && <span className="block text-xs text-muted-foreground">{inr(r.orderValue)}</span>}
                </span>
              ), csv: (r) => r.orders },
              { key: "lostReason", label: "Lost reason", render: (r) => (
                r.stage === "LOST" ? <span className="badge badge-red">{r.lostReason ?? "Not specified"}</span> : "—"
              ), csv: (r) => (r.stage === "LOST" ? (r.lostReason ?? "Not specified") : "") },
              { key: "assignedName", label: "BDM" },
              { key: "firstCallAt", label: "First call", csvOnly: true, csv: (r) => r.firstCallAt },
              { key: "lastCallAt", label: "Last call", csvOnly: true, csv: (r) => r.lastCallAt },
              { key: "callsConnected", label: "Calls connected", csvOnly: true },
              { key: "talkSec", label: "Talk time", csvOnly: true, csv: (r) => fmtCallDuration(r.talkSec) },
              { key: "firstOrderAt", label: "1st order", csvOnly: true, csv: (r) => r.firstOrderAt },
              { key: "lastOrderAt", label: "Latest order", csvOnly: true, csv: (r) => r.lastOrderAt },
              { key: "orderValue", label: "Order value", csvOnly: true },
              { key: "orderPaid", label: "Paid", csvOnly: true },
              { key: "source", label: "Source", csvOnly: true },
              { key: "campaign", label: "Campaign", csvOnly: true },
              { key: "service", label: "Service", csvOnly: true },
              { key: "city", label: "City", csvOnly: true },
              { key: "email", label: "Email", csvOnly: true },
            ]}
          />
        </>
      )}

      <ClientHistory target={open} orders={orders} onClose={() => setOpen(null)} />
    </div>
  );
}
