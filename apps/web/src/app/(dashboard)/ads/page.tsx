"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { TrendingUp, Plus, Eye, MousePointer, Target, BarChart3, Megaphone, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Campaign = {
  id: string;
  campaignName: string;
  platform: string;
  status: string;
  impressions: number;
  clicks: number;
  ctr: number;
  leads: number;
  dailyBudget: number;
  projectId?: { projectName: string };
};

type Dashboard = {
  totalImpressions: number;
  totalClicks: number;
  totalLeads: number;
  avgCtr: number;
  campaignCount: number;
};

const PLATFORM_BADGE: Record<string, string> = {
  META_ADS: "badge-blue", GOOGLE_ADS: "badge-amber",
};

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: "badge-green", PAUSED: "badge-amber", COMPLETED: "badge-gray",
};

function fmtNum(n: number) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000)    return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export default function AdsPage() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen]         = useState(false);
  const [name, setName]               = useState("");
  const [projectId, setProjectId]     = useState("");
  const [platform, setPlatform]       = useState("META_ADS");
  const [dailyBudget, setDailyBudget] = useState("0");

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ["ad-campaigns"],
    queryFn: () => api<Campaign[]>("/ad-campaigns"),
  });

  const { data: dashboard } = useQuery({
    queryKey: ["ad-dashboard"],
    queryFn: () => api<Dashboard>("/ad-campaigns/dashboard"),
  });

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ ACTIVE: { id: string; projectName: string }[]; ON_HOLD: unknown[]; COMPLETED: unknown[] }>("/projects"),
  });

  const createMutation = useMutation({
    mutationFn: (body: object) => api("/ad-campaigns", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ad-campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["ad-dashboard"] });
      setAddOpen(false); setName(""); setProjectId(""); setDailyBudget("0");
      toast.success("Campaign created");
    },
  });

  const [editing, setEditing] = useState<Campaign | null>(null);
  const [metrics, setMetrics] = useState({ impressions: "", clicks: "", leads: "", dailyBudget: "", status: "ACTIVE" });

  const refreshAds = () => {
    queryClient.invalidateQueries({ queryKey: ["ad-campaigns"] });
    queryClient.invalidateQueries({ queryKey: ["ad-dashboard"] });
  };

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      api(`/ad-campaigns/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { toast.success("Campaign updated"); setEditing(null); refreshAds(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/ad-campaigns/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("Campaign deleted"); setEditing(null); refreshAds(); },
  });

  const openEdit = (c: Campaign) => {
    setEditing(c);
    setMetrics({ impressions: String(c.impressions), clicks: String(c.clicks), leads: String(c.leads), dailyBudget: String(c.dailyBudget), status: c.status });
  };

  const allProjects = [...(projects?.ACTIVE || []), ...(projects?.ON_HOLD || []), ...(projects?.COMPLETED || [])] as { id: string; projectName: string }[];

  return (
    <div className="page space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Ads Tracking</h1>
          <p className="page-subtitle">Meta Ads & Google Ads performance across all campaigns</p>
        </div>
        <Button onClick={() => setAddOpen(true)}><Plus className="size-4" />Add Campaign</Button>
      </div>

      {/* Stats */}
      {dashboard && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 stagger">
          {[
            { label: "Impressions", value: fmtNum(dashboard.totalImpressions), icon: Eye,           chip: "icon-chip-blue",   kpi: "kpi-blue"  },
            { label: "Clicks",      value: fmtNum(dashboard.totalClicks),       icon: MousePointer,  chip: "icon-chip-green",  kpi: "kpi-green" },
            { label: "Avg CTR",     value: `${dashboard.avgCtr.toFixed(2)}%`,   icon: BarChart3,     chip: "icon-chip-amber",  kpi: "kpi-amber" },
            { label: "Leads",       value: dashboard.totalLeads,                icon: Target,        chip: "icon-chip-sky",    kpi: "kpi-sky"   },
            { label: "Campaigns",   value: dashboard.campaignCount,             icon: Megaphone,     chip: "icon-chip-purple", kpi: "kpi-purple"},
          ].map(({ label, value, icon: Icon, chip, kpi }) => (
            <div key={label} className={`card animate-fade-up ${kpi} p-5`}>
              <div className="flex items-start justify-between mb-3">
                <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
                <div className={`icon-chip size-9 ${chip}`}><Icon className="size-4" /></div>
              </div>
              <div className="text-3xl font-bold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Campaigns list */}
      <div className="card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <p className="text-[15px] font-semibold">All Campaigns</p>
          {campaigns && campaigns.length > 0 && (
            <span className="badge badge-gray">{campaigns.length} total</span>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-3 text-muted-foreground py-12">
            <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Loading campaigns…</span>
          </div>
        ) : !campaigns?.length ? (
          <div className="empty-state">
            <div className="empty-state-icon"><TrendingUp className="size-6 text-muted-foreground" /></div>
            <p className="font-semibold">No campaigns yet</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">Add your first ad campaign to track performance</p>
            <Button onClick={() => setAddOpen(true)}><Plus className="size-4" />Add Campaign</Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>Campaign</th><th>Platform</th><th>Impressions</th><th>Clicks</th><th>CTR</th><th>Leads</th><th>Budget/day</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div>
                        <div className="font-semibold">{c.campaignName}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {(c.projectId as { projectName?: string })?.projectName || "No project"}
                        </div>
                      </div>
                    </td>
                    <td><span className={`badge ${PLATFORM_BADGE[c.platform] || "badge-gray"}`}>{c.platform.replace("_", " ")}</span></td>
                    <td className="tabular-nums text-muted-foreground">{fmtNum(c.impressions)}</td>
                    <td className="tabular-nums text-muted-foreground">{fmtNum(c.clicks)}</td>
                    <td className="tabular-nums font-semibold">{c.ctr.toFixed(2)}%</td>
                    <td className="tabular-nums text-muted-foreground">{c.leads}</td>
                    <td className="tabular-nums text-muted-foreground">₹{c.dailyBudget}/d</td>
                    <td><span className={`badge ${STATUS_BADGE[c.status] || "badge-gray"}`}>{c.status}</span></td>
                    <td>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-foreground" onClick={() => openEdit(c)}>
                        <Pencil className="size-3.5" />Update
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Campaign</DialogTitle></DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name || !projectId) return;
              createMutation.mutate({ campaignName: name, projectId, platform, dailyBudget: Number(dailyBudget) || 0, status: "ACTIVE" });
            }}
            className="space-y-4 pt-1"
          >
            <div className="space-y-1.5"><Label>Campaign name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Summer Sale 2025" required /></div>
            <div className="space-y-1.5">
              <Label>Project *</Label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} required className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                <option value="">Select project…</option>
                {allProjects.map((p) => <option key={p.id} value={p.id}>{p.projectName}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Platform</Label>
                <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                  <option value="META_ADS">Meta Ads</option>
                  <option value="GOOGLE_ADS">Google Ads</option>
                </select>
              </div>
              <div className="space-y-1.5"><Label>Daily budget (₹)</Label><Input type="number" value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value)} min={0} /></div>
            </div>
            {createMutation.isError && <p className="text-sm text-destructive">{createMutation.error instanceof Error ? createMutation.error.message : "Failed"}</p>}
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? "Creating…" : "Create Campaign"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Update — {editing?.campaignName}</DialogTitle></DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!editing) return;
              updateMutation.mutate({
                id: editing.id,
                body: {
                  impressions: Number(metrics.impressions) || 0,
                  clicks: Number(metrics.clicks) || 0,
                  leads: Number(metrics.leads) || 0,
                  dailyBudget: Number(metrics.dailyBudget) || 0,
                  status: metrics.status,
                },
              });
            }}
            className="space-y-4 pt-1"
          >
            <p className="text-sm text-muted-foreground">Enter the latest numbers from the ads manager. CTR is calculated automatically.</p>
            <div className="grid grid-cols-2 gap-3">
              {(["impressions", "clicks", "leads", "dailyBudget"] as const).map((field) => (
                <div key={field} className="space-y-1.5">
                  <Label>{field === "dailyBudget" ? "Daily budget (₹)" : field.charAt(0).toUpperCase() + field.slice(1)}</Label>
                  <Input type="number" min={0} value={metrics[field]} onChange={(e) => setMetrics((m) => ({ ...m, [field]: e.target.value }))} />
                </div>
              ))}
              <div className="space-y-1.5 col-span-2">
                <Label>Status</Label>
                <select value={metrics.status} onChange={(e) => setMetrics((m) => ({ ...m, status: e.target.value }))} className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                  <option value="ACTIVE">Active</option>
                  <option value="PAUSED">Paused</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </div>
            </div>
            {Number(metrics.impressions) > 0 && (
              <p className="text-xs text-muted-foreground">CTR: <span className="font-semibold text-foreground">{((Number(metrics.clicks) / Number(metrics.impressions)) * 100).toFixed(2)}%</span></p>
            )}
            <DialogFooter className="pt-2 sm:justify-between">
              <Button
                type="button" variant="ghost" className="text-muted-foreground hover:text-destructive"
                disabled={deleteMutation.isPending}
                onClick={() => editing && window.confirm(`Delete campaign "${editing.campaignName}"?`) && deleteMutation.mutate(editing.id)}
              >
                <Trash2 className="size-4" />Delete
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <Button type="submit" disabled={updateMutation.isPending}>{updateMutation.isPending ? "Saving…" : "Save"}</Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
