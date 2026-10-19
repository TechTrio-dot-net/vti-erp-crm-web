"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Shuffle, Users } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminOnly, DateRangeFilter, ErrorState, FilterBar, LoadingBlock, PageHeader, lastDays, selectCls, useBdms } from "@/components/crm/ui";

type Campaign = {
  campaign: string; total: number; open: number; pending: number; won: number; lastLeadAt: string | null;
  byBdm: Array<{ userId: string | null; name: string; count: number }>;
  bdms: Array<{ userId: string; name: string }>;
};

export default function CampaignAdjustmentPage() {
  return <AdminOnly><CampaignAdjustment /></AdminOnly>;
}

function CampaignAdjustment() {
  const queryClient = useQueryClient();
  const { data: bdms } = useBdms();
  const [range, setRange] = useState(lastDays(90));
  const [rulesFor, setRulesFor] = useState<{ campaign: string; userIds: string[] } | null>(null);
  const [reassign, setReassign] = useState<{ campaign: string; fromUserId: string; toUserId: string; onlyPending: boolean } | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "campaigns", range],
    queryFn: () => api<Campaign[]>(`/crm/campaigns?from=${range.from}&to=${range.to}`),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["crm"] });

  const saveRules = useMutation({
    mutationFn: () => api("/crm/campaigns/rules", { method: "PUT", body: JSON.stringify(rulesFor) }),
    onSuccess: () => { toast.success("Campaign BDMs saved — new leads will follow this rule"); setRulesFor(null); refresh(); },
  });
  const runReassign = useMutation({
    mutationFn: () => api<{ moved: number }>("/crm/campaigns/reassign", { method: "POST", body: JSON.stringify({ ...reassign, fromUserId: reassign?.fromUserId || undefined }) }),
    onSuccess: (r) => { toast.success(`${r.moved} lead(s) moved`); setReassign(null); refresh(); },
  });

  return (
    <div className="page space-y-5">
      <PageHeader title="Campaign Lead - BDM Adjustment" subtitle="Route each campaign's leads to chosen BDMs, and re-balance existing leads">
        <Button variant="outline" onClick={() => setRulesFor({ campaign: "", userIds: [] })}><Plus className="size-4" />Rule for new campaign</Button>
      </PageHeader>
      <FilterBar><DateRangeFilter value={range} onChange={setRange} /></FilterBar>
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : data.length === 0 ? (
        <div className="card p-10 text-center text-sm text-muted-foreground">No campaign leads in this period. Campaign names come from Meta / Google Sheet leads.</div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {data.map((c) => (
            <div key={c.campaign} className="card p-5 space-y-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate">{c.campaign}</p>
                  <p className="text-xs text-muted-foreground">{c.total} leads · {c.open} open · {c.pending} not contacted · {c.won} won · last {fmtDateTime(c.lastLeadAt)}</p>
                </div>
              </div>
              <div className="text-sm">
                <p className="text-xs font-semibold text-muted-foreground mb-1">Receives new leads</p>
                {c.bdms.length ? (
                  <div className="flex flex-wrap gap-1">{c.bdms.map((b) => <span key={b.userId} className="badge badge-blue">{b.name}</span>)}</div>
                ) : <span className="text-muted-foreground text-xs">Everyone online (normal rotation)</span>}
              </div>
              <div className="text-sm">
                <p className="text-xs font-semibold text-muted-foreground mb-1">Current split</p>
                <div className="flex flex-wrap gap-1">{c.byBdm.map((b) => <span key={b.userId ?? "none"} className="badge badge-gray">{b.name}: {b.count}</span>)}</div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setRulesFor({ campaign: c.campaign, userIds: c.bdms.map((b) => b.userId) })}><Users className="size-3.5" />Set BDMs</Button>
                <Button size="sm" variant="outline" disabled={!c.open} onClick={() => setReassign({ campaign: c.campaign, fromUserId: "", toUserId: "rotation", onlyPending: true })}><Shuffle className="size-3.5" />Re-assign leads</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!rulesFor} onOpenChange={(o) => !o && setRulesFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>BDMs for this campaign</DialogTitle></DialogHeader>
          {rulesFor && (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!rulesFor.campaign.trim()) return toast.error("Enter the campaign name exactly as in Meta"); saveRules.mutate(); }}>
              <div className="space-y-1.5"><Label>Campaign name</Label><Input value={rulesFor.campaign} onChange={(e) => setRulesFor({ ...rulesFor, campaign: e.target.value })} placeholder="Exactly as it appears in Meta" /></div>
              <p className="text-xs text-muted-foreground">New leads from this campaign rotate only among the ticked BDMs who are online. Untick everyone to use the normal rotation.</p>
              <div className="grid grid-cols-2 gap-2">
                {bdms?.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm border rounded-lg px-3 py-2">
                    <input
                      type="checkbox"
                      checked={rulesFor.userIds.includes(b.id)}
                      onChange={(e) => setRulesFor({ ...rulesFor, userIds: e.target.checked ? [...rulesFor.userIds, b.id] : rulesFor.userIds.filter((id) => id !== b.id) })}
                    />
                    {b.name}
                  </label>
                ))}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setRulesFor(null)}>Cancel</Button>
                <Button type="submit" disabled={saveRules.isPending}>Save</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!reassign} onOpenChange={(o) => !o && setReassign(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Re-assign “{reassign?.campaign}” leads</DialogTitle></DialogHeader>
          {reassign && (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); runReassign.mutate(); }}>
              <div className="space-y-1.5">
                <Label>Take leads from</Label>
                <select value={reassign.fromUserId} onChange={(e) => setReassign({ ...reassign, fromUserId: e.target.value })} className={`${selectCls} w-full`}>
                  <option value="">Everyone who has them</option>
                  {bdms?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Give them to</Label>
                <select value={reassign.toUserId} onChange={(e) => setReassign({ ...reassign, toUserId: e.target.value })} className={`${selectCls} w-full`}>
                  <option value="rotation">Rotation (respects campaign BDMs)</option>
                  {bdms?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reassign.onlyPending} onChange={(e) => setReassign({ ...reassign, onlyPending: e.target.checked })} />Only leads not contacted yet</label>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setReassign(null)}>Cancel</Button>
                <Button type="submit" disabled={runReassign.isPending}>{runReassign.isPending ? "Moving…" : "Re-assign"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
