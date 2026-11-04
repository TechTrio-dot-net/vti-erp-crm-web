"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PhoneCall, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { isBdm, isCrmAdmin } from "@/lib/crm";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { CallLink } from "./ClickToCall";

export type Reminder = {
  customerKey: string;
  leadId: string | null;
  name: string;
  phone: string | null;
  userId: string | null;
  bdmName: string | null;
  kind: "reorder" | "winback";
  lastOrderMonth: string;
  lastOrderAt: string;
  /** The months this customer ordered in over the last year, newest first */
  recentMonths: string[];
};
export type ReorderBoard = { due: boolean; month: string; opensOn: string; today: string; rows: Reminder[] };
export type Answer = "called" | "skipped";

/** "2026-09" → "Sep" */
export const shortMonth = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });

/** The month's re-order list for whoever is signed in; nobody else may ask for it */
export function useReorderBoard() {
  const role = useAuthStore((s) => s.user?.role);
  return useQuery({
    queryKey: ["crm", "reminders"],
    queryFn: () => api<ReorderBoard>("/crm/reminders"),
    enabled: isBdm(role) || isCrmAdmin(role),
    staleTime: 5 * 60_000,
  });
}

/** Called them, or skipped them — either way the customer clears off the list for this month */
export function useReorderAnswer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { row: Reminder; action: Answer }) =>
      api("/crm/reminders/action", {
        method: "POST",
        body: JSON.stringify({ customerKey: vars.row.customerKey, leadId: vars.row.leadId, kind: vars.row.kind, action: vars.action }),
      }),
    onSuccess: (_result, vars) => {
      queryClient.invalidateQueries({ queryKey: ["crm", "reminders"] });
      toast.success(vars.action === "called" ? `${vars.row.name} marked as called` : `${vars.row.name} skipped this month`);
    },
    onError: (e: Error) => toast.error(e.message || "Could not save that"),
  });
}

/** The two lists the month opens with, shown both in the pop-up and on the Re-order Calls page */
export function ReorderGroups({ rows, onOpen, onAnswer, pending }: {
  rows: Reminder[];
  onOpen: (row: Reminder) => void;
  onAnswer: (row: Reminder, action: Answer) => void;
  pending: boolean;
}) {
  const role = useAuthStore((s) => s.user?.role);
  return (
    <>
      <Group
        title="Due for this month's order"
        hint="They order every month and this month's order has not come in yet"
        icon={<RefreshCw className="size-4 text-emerald-600" />}
        rows={rows.filter((r) => r.kind === "reorder")}
        showBdm={!isBdm(role)}
        onOpen={onOpen}
        onAnswer={onAnswer}
        pending={pending}
      />
      <Group
        title="Skipped last month"
        hint="They took the service and did not re-order the next month — find out why"
        icon={<PhoneCall className="size-4 text-amber-600" />}
        rows={rows.filter((r) => r.kind === "winback")}
        showBdm={!isBdm(role)}
        onOpen={onOpen}
        onAnswer={onAnswer}
        pending={pending}
      />
    </>
  );
}

function Group({ title, hint, icon, rows, showBdm, onOpen, onAnswer, pending }: {
  title: string;
  hint: string;
  icon: React.ReactNode;
  rows: Reminder[];
  showBdm: boolean;
  onOpen: (row: Reminder) => void;
  onAnswer: (row: Reminder, action: Answer) => void;
  pending: boolean;
}) {
  if (!rows.length) return null;
  return (
    <div className="space-y-2">
      <div>
        <p className="font-semibold flex items-center gap-2">{icon}{title}<span className="badge badge-gray">{rows.length}</span></p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <ul className="divide-y rounded-md border">
        {rows.map((r) => (
          <li key={r.customerKey} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
            <button type="button" className="min-w-0 flex-1 text-left disabled:cursor-default" onClick={() => onOpen(r)} disabled={!r.leadId}>
              <p className="font-semibold truncate">{r.name}</p>
              <p className="text-xs text-muted-foreground">
                Last order {shortMonth(r.lastOrderMonth)}
                {r.recentMonths.length > 1 && ` · ordered in ${r.recentMonths.slice(0, 4).map(shortMonth).join(", ")}`}
                {showBdm && r.bdmName && ` · ${r.bdmName}`}
              </p>
            </button>
            {r.leadId ? <CallLink leadId={r.leadId} phone={r.phone} /> : <span className="text-sm text-muted-foreground">{r.phone ?? "—"}</span>}
            <div className="flex gap-2">
              <Button size="sm" disabled={pending} onClick={() => onAnswer(r, "called")}>Called</Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => onAnswer(r, "skipped")}>Skip</Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
