"use client";

import { useQuery } from "@tanstack/react-query";
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, ShoppingBag } from "lucide-react";
import { api } from "@/lib/api";
import { fmtCallDuration, fmtDate, fmtDateTime, inr, outcomeMeta, qs, stageMeta, statusBadge } from "@/lib/crm";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RecordingButton } from "@/components/crm/CallRecording";
import { ErrorState, LoadingBlock } from "./ui";

export type ClientHistoryTarget = { id: string; name: string };

type Lead = {
  id: string; name: string; companyName: string; contactName: string | null; phone: string | null; email: string | null;
  city: string | null; source: string | null; campaign: string | null; adName: string | null; formName: string | null;
  platform: string | null; service: string | null; businessType: string | null; stage: string;
  statusLabel: string | null; lostReason: string | null; notes: string | null;
  cameAt: string; assignedAt: string | null; firstContactAt: string | null; lastContactAt: string | null;
  nextFollowupAt: string | null; closedAt: string | null; sampleSharedAt: string | null;
  estimatedValue: number | null; assignedName: string | null;
};
type Call = {
  kind: "call" | "followup"; id: string; at: string; direction: string | null; durationSec: number | null;
  status: string | null; source: string; userName: string | null; outcome: string | null; note: string | null;
  statusLabel: string | null; callActivity: string | null; reason: string | null;
  recordingUrl: string | null; recordingStatus: string | null;
};
type Order = {
  id: string; quotationNumber: string | null; status: string; subject: string | null; at: string;
  validUntil: string | null; total: number; paid: number; paidAt: string | null; createdByName: string | null;
};
type History = { lead: Lead; calls: Call[]; orders: Order[]; ordersScope: "confirmed" | "all" };

/** 1 → "1st", 2 → "2nd" — orders read as "1st order on 2 Aug", the way the team talks about them */
const ordinal = (n: number) => {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
};

const DIRECTION_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  outgoing: PhoneOutgoing, incoming: PhoneIncoming, missed: PhoneMissed, rejected: PhoneMissed,
};

/** A call written up on the website has no phone record, so there is no direction to show for it */
function CallIcon({ call }: { call: Call }) {
  const Icon = (call.direction && DIRECTION_ICON[call.direction]) || Phone;
  const tone = call.direction === "missed" || call.direction === "rejected" ? "icon-chip-red"
    : call.durationSec ? "icon-chip-green" : "bg-muted text-muted-foreground";
  return <div className={`icon-chip size-8 shrink-0 ${tone}`}><Icon className="size-3.5" /></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="text-sm font-medium break-words">{children ?? "—"}</p>
    </div>
  );
}

/** Every call and every order this client has, newest facts at the top and the two timelines side by side */
export function ClientHistory({ target, orders, onClose }: { target: ClientHistoryTarget | null; orders: string; onClose: () => void }) {
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      {/* Two timelines next to each other need the room; the column cap keeps them scrolling inside, not the dialog */}
      <DialogContent className="max-w-[min(80rem,calc(100vw-2rem))] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{target?.name ?? "Client history"}</DialogTitle>
        </DialogHeader>
        {target && <Body key={target.id} id={target.id} orders={orders} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({ id, orders }: { id: string; orders: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "client-leisure", id, orders],
    queryFn: () => api<History>(`/crm/reports/client-leisure/${id}${qs({ orders })}`),
  });

  if (isError) return <ErrorState message="Could not load this client's history" />;
  if (isLoading || !data) return <LoadingBlock rows={8} />;
  const { lead, calls } = data;
  const stage = stageMeta(lead.stage);
  const paid = data.orders.reduce((sum, o) => sum + o.paid, 0);
  const value = data.orders.reduce((sum, o) => sum + o.total, 0);

  return (
    <div className="space-y-5">
      {/* Who they are and where they came from */}
      <div className="rounded-xl border border-border/60 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`badge ${stage.badge}`}>{stage.label}</span>
          {lead.statusLabel && <span className={`badge ${statusBadge(lead.statusLabel)}`}>{lead.statusLabel}</span>}
          {lead.stage === "LOST" && <span className="badge badge-red">Lost: {lead.lostReason ?? "Not specified"}</span>}
          <span className="ml-auto text-xs text-muted-foreground">BDM: {lead.assignedName ?? "Unassigned"}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Company">{lead.companyName}</Field>
          <Field label="Contact">{lead.contactName}</Field>
          <Field label="Mobile">{lead.phone}</Field>
          <Field label="Email">{lead.email}</Field>
          <Field label="City">{lead.city}</Field>
          <Field label="Service">{lead.service}</Field>
          <Field label="Business type">{lead.businessType}</Field>
          <Field label="Source">{[lead.source, lead.platform].filter(Boolean).join(" · ") || null}</Field>
          <Field label="Campaign">{lead.campaign}</Field>
          <Field label="Ad / form">{[lead.adName, lead.formName].filter(Boolean).join(" · ") || null}</Field>
          <Field label="Estimated value">{inr(lead.estimatedValue)}</Field>
          <Field label="Sample shared">{lead.sampleSharedAt ? fmtDateTime(lead.sampleSharedAt) : "No"}</Field>
        </div>
      </div>

      {/* The dates that matter, in the order they happened */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Lead came in">{fmtDateTime(lead.cameAt)}</Field>
        <Field label="Given to the BDM">{fmtDateTime(lead.assignedAt)}</Field>
        <Field label="First call">{fmtDateTime(lead.firstContactAt)}</Field>
        <Field label="Last call">{fmtDateTime(lead.lastContactAt)}</Field>
        <Field label={lead.closedAt ? (lead.stage === "WON" ? "Won on" : "Lost on") : "Next follow-up"}>
          {fmtDateTime(lead.closedAt ?? lead.nextFollowupAt)}
        </Field>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Every call, oldest first, so the conversation reads top to bottom */}
        <section className="card">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50">
            <p className="text-[15px] font-semibold">Calls</p>
            <span className="badge badge-gray">{calls.length}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {calls.filter((c) => (c.durationSec ?? 0) > 0).length} connected
            </span>
          </div>
          {calls.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No call has been made yet</p>
          ) : (
            <ol className="divide-y divide-border/50 max-h-[32rem] overflow-y-auto">
              {calls.map((c, i) => {
                const outcome = c.outcome ? outcomeMeta(c.outcome) : null;
                return (
                  <li key={`${c.kind}-${c.id}`} className="flex gap-3 px-4 py-3">
                    <CallIcon call={c} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-xs font-semibold tabular-nums text-muted-foreground">#{i + 1}</span>
                        <span className="text-sm font-medium">{fmtDateTime(c.at)}</span>
                        <span className="text-xs text-muted-foreground">
                          {c.kind === "call" ? `${c.direction ?? "call"} · ${fmtCallDuration(c.durationSec)}` : "written up on the website"}
                        </span>
                        {outcome && <span className={`badge ${outcome.badge}`}>{outcome.label}</span>}
                      </div>
                      {(c.callActivity || c.statusLabel) && (
                        <p className="text-xs text-muted-foreground">
                          {[c.callActivity, c.statusLabel].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {c.note && <p className="text-sm text-muted-foreground">{c.note}</p>}
                      {c.reason && <p className="text-xs"><span className="badge badge-red">{c.reason}</span></p>}
                      <p className="text-[11px] text-muted-foreground">{c.userName ?? "—"}</p>
                    </div>
                    {c.kind === "call" && (
                      <RecordingButton callId={c.id} status={c.recordingStatus} recordingUrl={c.recordingUrl} />
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* Every order, numbered the way the team counts them: 1st, 2nd, 3rd */}
        <section className="card">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50">
            <p className="text-[15px] font-semibold">Orders</p>
            <span className="badge badge-gray">{data.orders.length}</span>
            <span className="ml-auto text-xs text-muted-foreground">{inr(paid)} paid of {inr(value)}</span>
          </div>
          {data.orders.length === 0 ? (
            <div className="py-10 text-center space-y-1">
              <p className="text-3xl font-bold tabular-nums">0 orders</p>
              <p className="text-sm text-muted-foreground">
                {lead.stage === "LOST"
                  ? `Lead lost — ${lead.lostReason ?? "no reason recorded"}`
                  : "Nothing ordered yet"}
              </p>
            </div>
          ) : (
            <ol className="divide-y divide-border/50 max-h-[32rem] overflow-y-auto">
              {data.orders.map((o, i) => (
                <li key={o.id} className="flex gap-3 px-4 py-3">
                  <div className="icon-chip size-8 shrink-0 icon-chip-green"><ShoppingBag className="size-3.5" /></div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-semibold">{ordinal(i + 1)} order</span>
                      <span className="text-sm">{fmtDateTime(o.at)}</span>
                      <span className={`badge ${o.paidAt ? "badge-green" : o.paid > 0 ? "badge-yellow" : "badge-gray"}`}>
                        {o.paidAt ? "Payment complete" : o.paid > 0 ? "Part paid" : o.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {[o.quotationNumber, o.subject].filter(Boolean).join(" · ") || "No subject"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {o.createdByName ?? "—"}
                      {o.validUntil ? ` · valid until ${fmtDate(o.validUntil)}` : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold tabular-nums">{inr(o.total)}</p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">{inr(o.paid)} paid</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {lead.notes && (
        <div className="rounded-xl border border-border/60 p-4">
          <p className="text-[11px] font-medium text-muted-foreground">Notes on the lead</p>
          <p className="text-sm whitespace-pre-wrap">{lead.notes}</p>
        </div>
      )}
    </div>
  );
}
