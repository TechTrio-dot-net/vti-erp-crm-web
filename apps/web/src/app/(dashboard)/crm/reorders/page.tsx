"use client";

import { CalendarClock } from "lucide-react";
import { fmtDate } from "@/lib/crm";
import { useCrmUi } from "@/store/crm";
import { ErrorState, LoadingBlock, PageHeader } from "@/components/crm/ui";
import { ReorderGroups, shortMonth, useReorderAnswer, useReorderBoard } from "@/components/crm/ReorderReminders";

/**
 * The same two lists the monthly pop-up shows, kept open all month — for anyone who closed the pop-up
 * with "Not now", and for the days before the first Saturday, when it has not opened yet.
 */
export default function ReorderCallsPage() {
  const openLead = useCrmUi((s) => s.openLead);
  const { data, isLoading, isError } = useReorderBoard();
  const answer = useReorderAnswer();

  if (isError) return <div className="page"><ErrorState message="Could not load the re-order calls" /></div>;

  return (
    <div className="page space-y-5">
      <PageHeader
        title="Re-order Calls"
        subtitle="Customers who order every month, and customers who stopped — the list the pop-up opens with on the first Saturday"
      />

      {isLoading || !data ? <LoadingBlock /> : (
        <div className="card p-5 space-y-4">
          <p className="text-sm flex items-center gap-2">
            <CalendarClock className="size-4 text-primary-text" />
            <span className="font-semibold">{shortMonth(data.month)} {data.month.slice(0, 4)}</span>
            <span className="text-muted-foreground">
              · {data.due ? `the pop-up opened on ${fmtDate(data.opensOn)}` : `the pop-up opens on ${fmtDate(data.opensOn)}`}
            </span>
          </p>

          {data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing to chase this month — every repeat customer has either ordered again or been answered.
            </p>
          ) : (
            <ReorderGroups
              rows={data.rows}
              onOpen={(r) => r.leadId && openLead(r.leadId)}
              onAnswer={(row, action) => answer.mutate({ row, action })}
              pending={answer.isPending}
            />
          )}
        </div>
      )}
    </div>
  );
}
