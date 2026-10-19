"use client";

import { fmtDateTime, inr, isBdm, stageMeta, timeAgo, type CrmLead } from "@/lib/crm";
import { useAuthStore } from "@/store/auth";
import { useCrmUi } from "@/store/crm";
import { DataTable, type Column } from "@/components/crm/ui";
import { CallLink } from "@/components/crm/ClickToCall";

/** Lead list used by My Leads and Lead Filter */
export function LeadTable({ rows, title, csvName, footer }: { rows: CrmLead[]; title?: string; csvName?: string; footer?: React.ReactNode }) {
  const role = useAuthStore((s) => s.user?.role);
  const openLead = useCrmUi((s) => s.openLead);
  const columns: Column<CrmLead & Record<string, unknown>>[] = [
    {
      key: "name", label: "Lead",
      csv: (l) => l.contactName || l.name,
      render: (l) => (
        <div className="min-w-0">
          <p className="font-bold text-foreground flex items-center gap-2">
            {l.contactName || l.name}
            {l.pending && <span className="size-2 rounded-full bg-red-500" title="Not contacted" />}
          </p>
          <p className="text-xs text-muted-foreground">{[l.contactName && l.contactName !== l.name && l.name, l.city, l.service].filter(Boolean).join(" · ") || "—"}</p>
        </div>
      ),
    },
    {
      key: "phone", label: "Mobile",
      render: (l) => <CallLink leadId={l.id} phone={l.phone} />,
    },
    { key: "source", label: "Source / campaign", render: (l) => <span className="text-muted-foreground text-sm">{[l.source, l.campaign].filter(Boolean).join(" · ") || "—"}</span>, csv: (l) => [l.source, l.campaign].filter(Boolean).join(" / ") },
    {
      key: "stage", label: "Stage / status",
      render: (l) => (
        <div className="flex flex-col items-start gap-1">
          <span className={`badge ${stageMeta(l.stage).badge}`}>{stageMeta(l.stage).label}</span>
          {l.statusLabel && l.statusLabel !== stageMeta(l.stage).label && <span className="text-xs text-muted-foreground">{l.statusLabel}</span>}
        </div>
      ),
      csv: (l) => [stageMeta(l.stage).label, l.statusLabel].filter(Boolean).join(" / "),
    },
    {
      key: "lastRemark", label: "Last remark", className: "max-w-xs",
      render: (l) => (l.lastRemark ? <span className="line-clamp-2 text-sm" title={l.lastRemark}>{l.lastRemark}</span> : <span className="text-muted-foreground">—</span>),
      csv: (l) => l.lastRemark ?? "",
    },
    ...(!isBdm(role) ? [{ key: "assignedName", label: "BDM", render: (l: CrmLead) => l.assignedName ?? <span className="text-amber-600">Unassigned</span> } as Column<CrmLead & Record<string, unknown>>] : []),
    {
      key: "nextFollowupAt", label: "Next follow-up",
      render: (l) => <span className={l.overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}>{l.nextFollowupAt ? fmtDateTime(l.nextFollowupAt) : "—"}</span>,
    },
    { key: "estimatedValue", label: "Value", align: "right", render: (l) => (l.estimatedValue ? inr(l.estimatedValue) : "—") },
    { key: "createdAt", label: "Received", render: (l) => <span className="text-muted-foreground whitespace-nowrap">{timeAgo(l.createdAt)}</span>, csv: (l) => l.createdAt },
  ];
  return (
    <DataTable
      title={title}
      rows={rows as Array<CrmLead & Record<string, unknown>>}
      columns={columns}
      csvName={csvName}
      empty="No leads match"
      onRowClick={(l) => openLead(l.id)}
      footer={footer}
    />
  );
}
