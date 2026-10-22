"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PhoneOff, PhoneCall, Utensils } from "lucide-react";
import { api } from "@/lib/api";
import { callingStatus } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type MyStatus = {
  lastCallAt: string | null;
  options: string[];
  reason: { reason: string; note: string | null; createdAt: string } | null;
};

const time = (d: string) => new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/**
 * A salesperson's own line on the Call Log: whether they count as calling right now, and — when the
 * line has gone quiet — one click to say why, so the red mark on the manager's screen has an answer.
 */
export function MyCallingStatus() {
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [custom, setCustom] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["crm", "my-calling"],
    queryFn: () => api<MyStatus>("/calls/idle-reason"),
    refetchInterval: 60_000,
  });

  const save = useMutation({
    mutationFn: (reason: string) => api<MyStatus["reason"]>("/calls/idle-reason", { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      toast.success("Saved — your manager can see it now");
      setPicking(false);
      setCustom(null);
      queryClient.invalidateQueries({ queryKey: ["crm"] });
    },
  });

  if (!data) return null;
  const live = callingStatus(data.lastCallAt);
  if (live.key === "off") return null;

  // Lunch is time off, so there is nothing to explain and nothing to ask for
  if ((live.key === "working" || live.key === "lunch") && !picking) {
    const lunch = live.key === "lunch";
    return (
      <div className="card px-5 py-3 flex items-center gap-2 text-sm">
        {lunch ? <Utensils className="size-4 text-muted-foreground" /> : <PhoneCall className="size-4 text-emerald-600" />}
        <span className={`font-semibold ${lunch ? "" : "text-emerald-700"}`}>{lunch ? "Lunch break" : "You are calling"}</span>
        <span className="text-muted-foreground">{live.sub}</span>
      </div>
    );
  }

  const answered = data.reason && !picking;

  return (
    <div className={`card p-5 ${answered ? "" : "border-red-300 bg-red-50/60"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <PhoneOff className={`size-4 ${answered ? "text-muted-foreground" : "text-red-600"}`} />
        <span className={`font-semibold ${answered ? "" : "text-red-700"}`}>{live.label}</span>
        <span className="text-sm text-muted-foreground">{live.sub}</span>
      </div>

      {answered ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">You said:</span>
          <span className="badge badge-amber">{data.reason!.reason}</span>
          <span className="text-muted-foreground">at {time(data.reason!.createdAt)}</span>
          <Button size="sm" variant="outline" className="h-7 ml-1" onClick={() => setPicking(true)}>Change</Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground mt-1 mb-3">Tell your manager why — one click is enough.</p>
          <div className="flex flex-wrap gap-2">
            {data.options.map((option) => (
              <Button key={option} size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate(option)}>{option}</Button>
            ))}
            <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => setCustom("")}>Something else…</Button>
          </div>
          {custom !== null && (
            <form
              className="flex flex-wrap gap-2 mt-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (custom.trim()) save.mutate(custom.trim());
              }}
            >
              <Input autoFocus value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Type the reason in your own words" maxLength={80} className="max-w-xs" />
              <Button size="sm" type="submit" disabled={!custom.trim() || save.isPending}>Save</Button>
              <Button size="sm" type="button" variant="outline" onClick={() => setCustom(null)}>Cancel</Button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
