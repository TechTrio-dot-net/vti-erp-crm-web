"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, History, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, isBdm, timeAgo, type CrmLead } from "@/lib/crm";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingBlock, PageHeader, selectCls } from "@/components/crm/ui";
import { LeadTable } from "../leads/LeadTable";

type BdmRow = {
  userId: string;
  name: string;
  username: string;
  isActive: boolean;
  pool: number;
  lostInPool: number;
  allottedToday: number;
  doneToday: number;
  totalRetargeted: number;
  lastBatchDate: string | null;
  oldestInPool: string | null;
};
type Board = { rows: BdmRow[]; dailyLimit: number; minAgeDays: number; today: string };
type RetargetLead = CrmLead & { retargetedAt: string; batchDate: string; done: boolean };
type Batch = { rows: RetargetLead[]; days: Array<{ date: string; count: number; done: number }>; date: string };

export default function RetargetingPage() {
  const me = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState("");
  const [date, setDate] = useState("");
  // Allotting a batch is the Super Admin's alone (POST /crm/retargeting/allot refuses anyone else)
  const canAllot = me?.role === "SUPER_ADMIN";

  const { data: board, isLoading, isError } = useQuery({ queryKey: ["crm", "retargeting"], queryFn: () => api<Board>("/crm/retargeting") });
  // A BDM only ever gets their own row back, so the board picks itself for them; an admin lands on
  // whoever has a batch today, which is the list they came to look at
  const bdm = board?.rows.find((r) => r.userId === selected)
    ?? (isBdm(me?.role) ? board?.rows[0] : board?.rows.find((r) => r.allottedToday > 0));
  const day = date || board?.today || "";

  const { data: batch } = useQuery({
    queryKey: ["crm", "retargeting", "leads", bdm?.userId, day],
    queryFn: () => api<Batch>(`/crm/retargeting/leads?user=${bdm!.userId}&date=${day}`),
    enabled: !!bdm?.userId && !!day,
  });

  const allot = useMutation({
    mutationFn: (userId: string) => api<{ allotted: number; allottedToday: number }>("/crm/retargeting/allot", { method: "POST", body: JSON.stringify({ userId }) }),
    onSuccess: (r, userId) => {
      setSelected(userId);
      setDate("");
      if (r.allotted) toast.success(`${r.allotted} old lead${r.allotted === 1 ? "" : "s"} allotted`, { description: "Oldest first, and none of them has been retargeted before" });
      else if (r.allottedToday) toast.info("Today's list is already full", { description: `${r.allottedToday} leads were allotted earlier today` });
      else toast.info("Nothing left to retarget", { description: "Every old lead of theirs has been through a batch" });
      queryClient.invalidateQueries({ queryKey: ["crm"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not allot the leads"),
  });

  if (isError) return <div className="page"><ErrorState message="Could not load retargeting" /></div>;

  return (
    <div className="page space-y-5">
      <PageHeader
        title="Lead Retargeting"
        subtitle={`Call the old leads again — ${board?.dailyLimit ?? 100} a day each, oldest first, and always back to the BDM they already belong to`}
      />

      {isLoading || !board ? <LoadingBlock /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {board.rows.map((r) => {
              const left = Math.max(0, board.dailyLimit - r.allottedToday);
              const take = Math.min(left, r.pool);
              const pending = allot.isPending && allot.variables === r.userId;
              return (
                <div
                  key={r.userId}
                  className={`card p-4 space-y-3 cursor-pointer transition-shadow ${bdm?.userId === r.userId ? "ring-2 ring-primary-text/30" : "hover:shadow-md"}`}
                  onClick={() => { setSelected(r.userId); setDate(""); }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{r.name}{!r.isActive && <span className="badge badge-gray ml-2">Inactive</span>}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.lastBatchDate ? `Last batch ${fmtDate(r.lastBatchDate)}` : "No batch yet"} · {r.totalRetargeted} retargeted so far
                      </p>
                    </div>
                    {r.allottedToday > 0 && (
                      <span className="badge badge-blue whitespace-nowrap">
                        {r.doneToday}/{r.allottedToday} done
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-md bg-muted/50 p-2">
                      <p className="text-xs text-muted-foreground">Old leads waiting</p>
                      <p className="font-semibold tabular-nums">{r.pool.toLocaleString("en-IN")}<span className="text-xs font-normal text-muted-foreground"> · {r.lostInPool.toLocaleString("en-IN")} lost</span></p>
                    </div>
                    <div className="rounded-md bg-muted/50 p-2">
                      <p className="text-xs text-muted-foreground">Oldest waiting</p>
                      <p className="font-semibold">{r.oldestInPool ? timeAgo(r.oldestInPool) : "—"}</p>
                    </div>
                  </div>

                  {canAllot ? (
                    <Button
                      className="w-full"
                      disabled={pending || take === 0}
                      onClick={(e) => { e.stopPropagation(); allot.mutate(r.userId); }}
                    >
                      {pending ? "Allotting…" : take === 0
                        ? (r.pool === 0 ? "Nothing left to retarget" : `Today's ${board.dailyLimit} already allotted`)
                        : <><RefreshCw className="size-4" />Allot {take} old leads</>}
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {r.allottedToday > 0 ? "Today's list is ready — call them from the list below." : "Waiting for the Super Admin to allot today's list."}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground">
            A lead joins the pool once it has been quiet for {board.minAgeDays} days, and leaves it for good the day it is allotted — so
            tomorrow&apos;s list is never today&apos;s. Won deals are left out; nobody&apos;s lead changes hands.
          </p>

          {bdm && (
            <>
              <div className="card p-4 flex flex-wrap items-center gap-3">
                <p className="font-semibold flex items-center gap-2"><History className="size-4 text-primary-text" />{bdm.name}&apos;s retargeting list</p>
                <select value={day} onChange={(e) => setDate(e.target.value)} className={selectCls} aria-label="Batch day">
                  {!batch?.days.some((d) => d.date === board.today) && <option value={board.today}>{fmtDate(board.today)} (today)</option>}
                  {batch?.days.map((d) => (
                    <option key={d.date} value={d.date}>
                      {fmtDate(d.date)}{d.date === board.today ? " (today)" : ""} — {d.count} leads, {d.done} done
                    </option>
                  ))}
                </select>
              </div>
              <LeadTable
                rows={batch?.rows ?? []}
                title={`${batch?.rows.length ?? 0} leads · ${fmtDate(day)}`}
                csvName={`retargeting-${bdm.username}-${day}`}
                extraColumns={[{
                  key: "done",
                  label: "Called again",
                  render: (l) => (l.done
                    ? <span className="inline-flex items-center gap-1 text-emerald-600 font-medium"><CheckCircle2 className="size-4" />Yes</span>
                    : <span className="text-muted-foreground">Pending</span>),
                  csv: (l) => (l.done ? "Yes" : "Pending"),
                }]}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
