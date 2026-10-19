"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { CRM_ROLES, isBdm, stageMeta, timeAgo, type CrmLead } from "@/lib/crm";
import { useAuthStore } from "@/store/auth";
import { useCrmUi } from "@/store/crm";
import { Button } from "@/components/ui/button";
import { useBdms } from "./ui";

/** Mobile/name search, "+ Add Inquiry" and (for BDMs) the Start/Stop switch */
export function CrmTopBar() {
  const user = useAuthStore((s) => s.user);
  const { openLead, openInquiry } = useCrmUi();
  const [term, setTerm] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const { data: results, isFetching } = useQuery({
    queryKey: ["crm", "search", submitted],
    queryFn: () => api<CrmLead[]>(`/crm/search?q=${encodeURIComponent(submitted)}`),
    enabled: submitted.length >= 2,
  });

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!user || !CRM_ROLES.includes(user.role)) return null;

  return (
    <div className="flex items-center gap-2 flex-1 justify-end">
      {isBdm(user.role) && <RotationSwitch userId={user.id} />}
      <div ref={boxRef} className="relative w-full max-w-xs">
        <form
          className="flex"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(term.trim());
            setOpen(true);
          }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onFocus={() => submitted && setOpen(true)}
              placeholder="Enter Mobile / Name"
              className="h-9 w-full rounded-l-lg border border-input bg-background pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <Button type="submit" size="sm" className="h-9 rounded-l-none">Go</Button>
        </form>
        {open && submitted.length >= 2 && (
          <div className="absolute right-0 top-11 z-40 w-[360px] max-w-[90vw] card shadow-xl p-1 max-h-96 overflow-y-auto">
            {isFetching && !results ? (
              <p className="p-3 text-sm text-muted-foreground">Searching…</p>
            ) : !results?.length ? (
              <p className="p-3 text-sm text-muted-foreground">No lead found for “{submitted}”</p>
            ) : (
              results.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => { openLead(l.id); setOpen(false); }}
                  className="w-full text-left px-3 py-2 rounded-md hover:bg-muted/60 flex items-center gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold truncate">{l.contactName || l.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{l.contactName && l.contactName !== l.name && `${l.name} · `}{l.phone ?? l.email} · {l.assignedName ?? "Unassigned"} · {timeAgo(l.createdAt)}</p>
                  </div>
                  <span className={`badge ${stageMeta(l.stage).badge}`}>{stageMeta(l.stage).label}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <Button size="sm" className="h-9 bg-primary hover:bg-primary/90 text-primary-foreground shrink-0" onClick={openInquiry}>
        <Plus className="size-4" /><span className="hidden sm:inline">Add Inquiry</span>
      </Button>
    </div>
  );
}

function RotationSwitch({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const { data: bdms } = useBdms();
  const me = bdms?.find((b) => b.id === userId);
  const mutation = useMutation({
    mutationFn: (start: boolean) => api(`/crm/bdms/${userId}/${start ? "start" : "stop"}`, { method: "POST" }),
    onSuccess: (_d, start) => {
      toast.success(start ? "You're online — new leads will be assigned to you" : "You're offline — no new leads will be assigned");
      queryClient.invalidateQueries({ queryKey: ["crm", "bdms"] });
    },
  });
  if (!me) return null;
  return me.inRotation ? (
    <Button size="sm" variant="outline" className="h-9 shrink-0 border-emerald-300 text-emerald-700" disabled={mutation.isPending} onClick={() => mutation.mutate(false)}>
      <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />Online<Square className="size-3 ml-1" />
    </Button>
  ) : (
    <Button size="sm" variant="outline" className="h-9 shrink-0 text-muted-foreground" disabled={mutation.isPending || me.onLeave} onClick={() => mutation.mutate(true)} title={me.onLeave ? "You are on leave today" : "Start receiving leads"}>
      <Play className="size-3" />{me.onLeave ? "On leave" : "Start"}
    </Button>
  );
}
