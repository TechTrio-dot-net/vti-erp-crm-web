"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { fmtDate } from "@/lib/crm";
import { useCrmUi } from "@/store/crm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReorderGroups, shortMonth, useReorderAnswer, useReorderBoard } from "./ReorderReminders";

/** One pop-up per sign-in: "Not now" remembers the month until they come back */
const SNOOZE_KEY = "reorder-reminder-snoozed";

const snoozedMonth = (): string | null => {
  try {
    return sessionStorage.getItem(SNOOZE_KEY);
  } catch {
    return null; // private browsing has nothing to remember it with — just show it
  }
};

/**
 * The monthly re-order pop-up, mounted once for the whole dashboard. From the first Saturday of the
 * month it opens by itself with the customers who order every month but have not ordered yet, and the
 * ones who skipped last month, so the calls are made while the month is young. The same two lists sit
 * on /crm/reorders for the rest of the month.
 */
export function ReorderReminderDialog() {
  const openLead = useCrmUi((s) => s.openLead);
  const { data } = useReorderBoard();
  const answer = useReorderAnswer();
  // Derived, not an effect: it is open while the month is due, has names on it and has not been put off
  const [snoozed, setSnoozed] = useState(snoozedMonth);
  const [opened, setOpened] = useState(false);

  if (!data) return null;
  const open = data.due && data.rows.length > 0 && snoozed !== data.month && !opened;

  const notNow = () => {
    try { sessionStorage.setItem(SNOOZE_KEY, data.month); } catch { /* as above */ }
    setSnoozed(data.month);
  };

  /** The lead drawer needs the screen to itself, so opening a customer closes the pop-up for now */
  const openCustomer = (leadId: string) => {
    openLead(leadId);
    setOpened(true);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && notNow()}>
      <DialogContent className="max-w-[min(44rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="size-5 text-primary-text" />Monthly re-order calls</DialogTitle>
          <DialogDescription>
            {shortMonth(data.month)} has started — {data.rows.length} customer{data.rows.length === 1 ? "" : "s"} to ring. Open one to call and log the follow-up.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto space-y-4 -mx-1 px-1">
          <ReorderGroups
            rows={data.rows}
            onOpen={(r) => r.leadId && openCustomer(r.leadId)}
            onAnswer={(row, action) => answer.mutate({ row, action })}
            pending={answer.isPending}
          />
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">Opens on the first Saturday of the month ({fmtDate(data.opensOn)})</p>
          <Button variant="outline" onClick={notNow}>Not now</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
