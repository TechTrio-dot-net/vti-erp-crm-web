"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, FileSpreadsheet, History, Plus, RefreshCw, Trash2, Users } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDateTime, timeAgo } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminOnly, ErrorState, LoadingBlock, PageHeader, selectCls, useBdms, useServices } from "@/components/crm/ui";

type Source = {
  id: string; name: string; type: "google_sheet" | "meta";
  config: { sheetUrl?: string; sheetName?: string; sheetTabs?: SheetTab[]; formIds?: string[]; pageId?: string; importExisting?: boolean };
  active: boolean; lastSyncedAt: string | null; lastError: string | null; defaultServiceName: string | null; defaultServiceId: string | null;
  imported: number; duplicates: number; errors: number; lastReceivedAt: string | null;
  team: Array<{ userId: string; name: string; inRotation: boolean }>;
  oldRows: number;
  oldImport: {
    status: "running" | "done" | "failed"; mode: string; total: number; processed: number; imported: number; duplicate: number; error: number;
    byUser: Record<string, number>; finishedAt?: string; message?: string;
  } | null;
};
type SourcesResponse = { sources: Source[]; meta: { accessToken: boolean; appSecret: boolean; verifyToken: boolean; webhookPath: string }; googleServiceAccount: string | null };
type SheetTab = { gid: string; title: string };
type TestResult = { totalRows: number; headers: string[]; preview: Array<{ mapped: Record<string, string> }> };

const EMPTY = { name: "", type: "google_sheet" as "google_sheet" | "meta", sheetUrl: "", sheetTabGids: [] as string[], importExisting: false, formIds: "", pageId: "", defaultServiceId: "" };

export default function IntegrationsPage() {
  return <AdminOnly><Integrations /></AdminOnly>;
}

function Integrations() {
  const queryClient = useQueryClient();
  const { data: services } = useServices();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm", "sources"],
    queryFn: () => api<SourcesResponse>("/integrations/sources"),
    // Poll quickly while an old-leads import is running
    refetchInterval: (q) => (q.state.data?.sources.some((s) => s.oldImport?.status === "running") ? 1500 : 30_000),
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [test, setTest] = useState<TestResult | null>(null);
  const [teamFor, setTeamFor] = useState<{ source: Source; userIds: string[] } | null>(null);
  const [oldFor, setOldFor] = useState<{ source: Source; mode: "team" | "rotation" | "unassigned"; from: string; to: string } | null>(null);
  const { data: bdms } = useBdms();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["crm"] });
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const [tabs, setTabs] = useState<{ url: string; list: SheetTab[] } | null>(null);
  const [tabsFor, setTabsFor] = useState<{ source: Source; list: SheetTab[] | null; gids: string[] } | null>(null);
  const fetchTabs = (sheetUrl: string) => api<{ tabs: SheetTab[] }>("/integrations/sources/tabs", { method: "POST", body: JSON.stringify({ sheetUrl }) });

  // The tabs are fetched as soon as a sheet link is pasted; the first one starts ticked
  const loadTabs = useMutation({
    mutationFn: (url: string) => fetchTabs(url).then((r) => ({ url, list: r.tabs })),
    onSuccess: (r) => { setTabs(r); setForm((f) => (f.sheetUrl.trim() === r.url ? { ...f, sheetTabGids: r.list.slice(0, 1).map((t) => t.gid) } : f)); },
    onError: (err: Error) => { setTabs(null); toast.error(err.message); },
  });
  const wantTabs = (url: string) => {
    const link = url.trim();
    if (/\/spreadsheets\/d\//.test(link) && tabs?.url !== link && !loadTabs.isPending) loadTabs.mutate(link);
  };
  const openTabs = (source: Source) => {
    setTabsFor({ source, list: null, gids: source.config.sheetTabs?.map((t) => t.gid) ?? [] });
    fetchTabs(source.config.sheetUrl ?? "")
      .then((r) => setTabsFor((t) => (t?.source.id === source.id ? { ...t, list: r.tabs } : t)))
      .catch((err: Error) => { toast.error(err.message); setTabsFor(null); });
  };
  const saveTabs = useMutation({
    mutationFn: () => api(`/integrations/sources/${tabsFor!.source.id}`, { method: "PATCH", body: JSON.stringify({ sheetTabGids: tabsFor!.gids, importExisting: false }) }),
    onSuccess: () => { toast.success("Tabs saved — rows already in a newly ticked tab are not imported, only new ones"); setTabsFor(null); refresh(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const testMutation = useMutation({
    mutationFn: () => api<TestResult>("/integrations/sources/test", { method: "POST", body: JSON.stringify({ sheetUrl: form.sheetUrl, gid: form.sheetTabGids[0] }) }),
    onSuccess: setTest,
    onError: (err: Error) => { setTest(null); toast.error(err.message); },
  });
  const create = useMutation({
    mutationFn: () => api("/integrations/sources", { method: "POST", body: JSON.stringify({ ...form, defaultServiceId: form.defaultServiceId || undefined }) }),
    onSuccess: () => { toast.success("Source connected — it syncs automatically"); setOpen(false); setForm(EMPTY); setTest(null); setTabs(null); refresh(); },
  });
  const sync = useMutation({
    mutationFn: (id: string) => api<{ received: number; imported: number; duplicate: number; error: number; baseline?: number }>(`/integrations/sources/${id}/sync`, { method: "POST" }),
    onSuccess: (r) => {
      toast.success(r.baseline != null ? `Connected: ${r.baseline} existing rows remembered, only new rows will become leads` : `Synced: ${r.imported} new, ${r.duplicate} repeat, ${r.error} failed`);
      refresh();
    },
    onError: (err: Error) => { toast.error(err.message); refresh(); },
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => api(`/integrations/sources/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: refresh,
  });
  const saveTeam = useMutation({
    mutationFn: () => api<{ assignedWaiting: number }>(`/integrations/sources/${teamFor!.source.id}/team`, { method: "PUT", body: JSON.stringify({ userIds: teamFor!.userIds }) }),
    onSuccess: (r) => {
      toast.success(teamFor?.userIds.length ? `Leads from "${teamFor.source.name}" now go only to ${teamFor.userIds.length} BDM${teamFor.userIds.length === 1 ? "" : "s"}` : "This source now uses every online BDM", {
        description: r.assignedWaiting ? `${r.assignedWaiting} waiting lead(s) were assigned` : undefined,
      });
      setTeamFor(null);
      refresh();
    },
  });

  const importOld = useMutation({
    mutationFn: () => api(`/integrations/sources/${oldFor!.source.id}/import-old`, {
      method: "POST",
      body: JSON.stringify({ mode: oldFor!.mode, from: oldFor!.from || undefined, to: oldFor!.to || undefined }),
    }),
    onSuccess: () => { toast.success("Importing old leads…"); setOldFor(null); refresh(); },
  });

  // BDMs who are in some other source's team — shown so it's easy to keep teams separate
  const teamsOf = (userId: string, exceptSourceId: string) =>
    (data?.sources ?? []).filter((s) => s.id !== exceptSourceId && s.team.some((t) => t.userId === userId)).map((s) => s.name);

  const remove = useMutation({
    mutationFn: (id: string) => api(`/integrations/sources/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("Source removed"); refresh(); },
  });

  // The API is served from this same site, so the webhook address starts with the site's own origin
  const apiBase = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="page space-y-5">
      <PageHeader title="Google Sheet & Meta" subtitle="Where leads come from. Give each sheet its own sales team, or share leads among every online BDM.">
        <Button onClick={() => { setForm(EMPTY); setTest(null); setTabs(null); setOpen(true); }}><Plus className="size-4" />Connect source</Button>
      </PageHeader>

      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <>
          {data.sources.length === 0 && (
            <div className="card p-8 text-center text-sm text-muted-foreground">No lead sources yet. Connect your Meta Ads Google Sheet to start.</div>
          )}
          <div className="grid lg:grid-cols-2 gap-4">
            {data.sources.map((s) => (
              <div key={s.id} className="card p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <div className={`icon-chip size-10 rounded-xl ${s.type === "meta" ? "icon-chip-blue" : "icon-chip-green"}`}><FileSpreadsheet className="size-5" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{s.name} <span className="badge badge-gray ml-1">{s.type === "meta" ? "Meta Lead Ads" : "Google Sheet"}</span></p>
                    <p className="text-xs text-muted-foreground truncate">{s.type === "google_sheet" ? s.config.sheetUrl : s.config.formIds?.length ? `Forms: ${s.config.formIds.join(", ")}` : "Webhook only"}</p>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={s.active} onChange={(e) => update.mutate({ id: s.id, body: { active: e.target.checked } })} />Active
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-muted/40 rounded-lg py-2"><p className="font-bold tabular-nums">{s.imported}</p><p className="text-[11px] text-muted-foreground">leads created</p></div>
                  <div className="bg-muted/40 rounded-lg py-2"><p className="font-bold tabular-nums">{s.duplicates}</p><p className="text-[11px] text-muted-foreground">repeat enquiries</p></div>
                  <div className="bg-muted/40 rounded-lg py-2"><p className={`font-bold tabular-nums ${s.errors ? "text-red-600" : ""}`}>{s.errors}</p><p className="text-[11px] text-muted-foreground">failed rows</p></div>
                </div>
                <div className="rounded-lg border border-border/60 px-3 py-2 flex items-start gap-2 text-sm">
                  <Users className="size-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-muted-foreground">Leads go to</p>
                    {s.team.length ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {s.team.map((t) => (
                          <span key={t.userId} className={`badge ${t.inRotation ? "badge-green" : "badge-gray"}`} title={t.inRotation ? "Online" : "Offline"}>{t.name}</span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm">Every online BDM (round-robin)</p>
                    )}
                    {s.team.length > 0 && !s.team.some((t) => t.inRotation) && (
                      <p className="text-xs text-amber-600 mt-1">Nobody in this team is online — new leads wait until one of them presses Start.</p>
                    )}
                  </div>
                  <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={() => setTeamFor({ source: s, userIds: s.team.map((t) => t.userId) })}>Choose team</Button>
                </div>
                {s.type === "google_sheet" && (
                  <div className="rounded-lg border border-border/60 px-3 py-2 flex items-start gap-2 text-sm">
                    <FileSpreadsheet className="size-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-muted-foreground">Tabs read</p>
                      {s.config.sheetTabs?.length ? (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {s.config.sheetTabs.map((t) => <span key={t.gid} className="badge badge-green">{t.title}</span>)}
                        </div>
                      ) : (
                        <p className="text-sm">{s.config.sheetName || "First tab only"}</p>
                      )}
                    </div>
                    <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={() => openTabs(s)}>Choose tabs</Button>
                  </div>
                )}
                {(s.oldRows > 0 || s.type === "meta" || s.oldImport) && (
                  <div className="rounded-lg bg-primary/10 border border-primary/40 px-3 py-2 text-sm flex items-start gap-2 ">
                    <History className="size-4 mt-0.5 text-primary-text shrink-0" />
                    <div className="flex-1 min-w-0">
                      {s.oldImport?.status === "running" ? (
                        <>
                          <p className="font-medium">Importing old leads… {s.oldImport.processed} / {s.oldImport.total}</p>
                          <div className="h-1.5 bg-primary/20 rounded-full overflow-hidden mt-1.5">
                            <div className="h-full bg-primary transition-all" style={{ width: `${s.oldImport.total ? (s.oldImport.processed / s.oldImport.total) * 100 : 0}%` }} />
                          </div>
                        </>
                      ) : s.oldImport?.status === "failed" ? (
                        <p className="text-red-700">Old leads import failed: {s.oldImport.message}</p>
                      ) : s.oldImport?.status === "done" && s.oldRows === 0 ? (
                        <p>
                          Old leads imported: <b>{s.oldImport.imported}</b> new
                          {s.oldImport.duplicate > 0 && `, ${s.oldImport.duplicate} repeat`}
                          {s.oldImport.error > 0 && <span className="text-red-600">, {s.oldImport.error} failed (see Verify Data)</span>}
                          {Object.keys(s.oldImport.byUser).length > 0 && (
                            <span className="block text-xs text-muted-foreground mt-0.5">
                              {Object.entries(s.oldImport.byUser).map(([id, n]) => `${bdms?.find((b) => b.id === id)?.name ?? "BDM"}: ${n}`).join(" · ")}
                            </span>
                          )}
                        </p>
                      ) : s.type === "meta" ? (
                        <p>Fetch older leads from Meta for a date range.</p>
                      ) : (
                        <p><b>{s.oldRows}</b> old lead{s.oldRows === 1 ? " was" : "s were"} already in the sheet when you connected it and {s.oldRows === 1 ? "hasn't" : "haven't"} been imported.</p>
                      )}
                    </div>
                    {s.oldImport?.status !== "running" && (s.oldRows > 0 || s.type === "meta") && (
                      <Button size="sm" className="h-7 shrink-0" onClick={() => setOldFor({ source: s, mode: "team", from: "", to: "" })}>Import old leads</Button>
                    )}
                  </div>
                )}
                {s.lastError ? (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex gap-2"><CircleAlert className="size-4 shrink-0" />{s.lastError}</p>
                ) : s.lastSyncedAt ? (
                  <p className="text-xs text-emerald-700 flex items-center gap-1.5"><CheckCircle2 className="size-3.5" />Last checked {timeAgo(s.lastSyncedAt)}{s.lastReceivedAt && ` · last lead ${fmtDateTime(s.lastReceivedAt)}`}</p>
                ) : <p className="text-xs text-muted-foreground">Not synced yet</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" disabled={sync.isPending || (s.type === "meta" && !s.config.formIds?.length)} onClick={() => sync.mutate(s.id)}>
                    <RefreshCw className={`size-3.5 ${sync.isPending && sync.variables === s.id ? "animate-spin" : ""}`} />Sync now
                  </Button>
                  <select
                    value={s.defaultServiceId ?? ""}
                    onChange={(e) => update.mutate({ id: s.id, body: { defaultServiceId: e.target.value || null } })}
                    className={`${selectCls} h-8 text-xs`}
                    aria-label="Default service"
                  >
                    <option value="">No default service</option>
                    {services?.map((sv) => <option key={sv.id} value={sv.id}>{sv.name}</option>)}
                  </select>
                  <Button size="sm" variant="ghost" className="ml-auto hover:text-destructive" onClick={() => window.confirm(`Remove "${s.name}"? Leads already created stay.`) && remove.mutate(s.id)}><Trash2 className="size-3.5" /></Button>
                </div>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="card p-5 space-y-2 text-sm">
              <p className="font-semibold">Google Sheet (Meta → Sheet)</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>In your sheet: <b>Share → Anyone with the link → Viewer</b>{data.googleServiceAccount && <> (or share it with <code>{data.googleServiceAccount}</code>)</>}.</li>
                <li>Paste the sheet link in <b>Connect source</b> and press <b>Test</b> to check the columns.</li>
                <li>The sheet is checked every 2 minutes for new rows. Rows that were already there can be brought in any time with <b>Import old leads</b>.</li>
              </ol>
            </div>
            <div className="card p-5 space-y-2 text-sm">
              <p className="font-semibold">Meta Lead Ads (direct)</p>
              <div className="flex flex-wrap gap-2">
                {[["Access token", data.meta.accessToken], ["App secret", data.meta.appSecret], ["Verify token", data.meta.verifyToken]].map(([label, ok]) => (
                  <span key={label as string} className={`badge ${ok ? "badge-green" : "badge-gray"}`}>{label}: {ok ? "set" : "missing"}</span>
                ))}
              </div>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Set <code>META_ACCESS_TOKEN</code>, <code>META_APP_SECRET</code> and <code>META_VERIFY_TOKEN</code> in <code>apps/api/.env</code> and restart the API.</li>
                <li><b>Webhook (instant):</b> in your Meta app subscribe the Page to <code>leadgen</code> with callback <code>{apiBase}{data.meta.webhookPath}</code>. This needs a public URL, so on a local machine use a tunnel (e.g. ngrok).</li>
                <li><b>Polling (works locally):</b> add a Meta source with your lead form IDs — checked every 5 minutes.</li>
              </ol>
            </div>
          </div>
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Connect a lead source</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Name *</Label><Input value={form.name} onChange={set("name")} placeholder="e.g. Meta Ads – Guitar course" required /></div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <select value={form.type} onChange={set("type")} className={`${selectCls} w-full`}>
                  <option value="google_sheet">Google Sheet</option>
                  <option value="meta">Meta Lead Ads (API)</option>
                </select>
              </div>
              {form.type === "google_sheet" ? (
                <>
                  <div className="col-span-2 space-y-1.5">
                    <Label>Sheet link *</Label>
                    <div className="flex gap-2">
                      <Input
                        value={form.sheetUrl}
                        onChange={(e) => { set("sheetUrl")(e); wantTabs(e.target.value); }}
                        onBlur={(e) => wantTabs(e.target.value)}
                        placeholder="https://docs.google.com/spreadsheets/d/…"
                        required
                      />
                      <Button type="button" variant="outline" disabled={!form.sheetUrl || testMutation.isPending} onClick={() => testMutation.mutate()}>{testMutation.isPending ? "Reading…" : "Test"}</Button>
                    </div>
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label>Tabs to read</Label>
                    {loadTabs.isPending ? (
                      <p className="text-sm text-muted-foreground">Fetching the sheet&apos;s tabs…</p>
                    ) : tabs?.url === form.sheetUrl.trim() ? (
                      <TabPicker list={tabs.list} gids={form.sheetTabGids} onChange={(gids) => setForm((f) => ({ ...f, sheetTabGids: gids }))} />
                    ) : (
                      <p className="text-sm text-muted-foreground">Paste the sheet link and its tabs appear here to tick.</p>
                    )}
                  </div>
                  <label className="col-span-2 flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.importExisting} onChange={(e) => setForm((f) => ({ ...f, importExisting: e.target.checked }))} />
                    Also import rows already in the sheet <span className="text-muted-foreground">(leave off to get only new rows)</span>
                  </label>
                </>
              ) : (
                <>
                  <div className="col-span-2 space-y-1.5"><Label>Lead form IDs</Label><Input value={form.formIds} onChange={set("formIds")} placeholder="123456789, 987654321 (for polling; leave empty for webhook only)" /></div>
                  <div className="space-y-1.5"><Label>Page ID</Label><Input value={form.pageId} onChange={set("pageId")} placeholder="Optional" /></div>
                </>
              )}
              <div className="space-y-1.5">
                <Label>Default service</Label>
                <select value={form.defaultServiceId} onChange={set("defaultServiceId")} className={`${selectCls} w-full`}>
                  <option value="">—</option>
                  {services?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            {test && (
              <div className="rounded-lg border p-3 space-y-2 text-sm">
                <p className="font-semibold text-emerald-700">✓ Read {test.totalRows} rows. Columns: <span className="font-normal text-muted-foreground">{test.headers.join(", ")}</span></p>
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead><tr><th>Name</th><th>Mobile</th><th>Email</th><th>Campaign</th><th>Extra answers</th></tr></thead>
                    <tbody>
                      {test.preview.map((p, i) => (
                        <tr key={i}>
                          <td>{p.mapped.name || <span className="text-red-600">missing</span>}</td>
                          <td>{p.mapped.phone || <span className="text-red-600">missing</span>}</td>
                          <td>{p.mapped.email}</td>
                          <td>{p.mapped.campaign}</td>
                          <td className="text-xs text-muted-foreground whitespace-pre-line">{p.mapped.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>{create.isPending ? "Saving…" : "Connect"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!tabsFor} onOpenChange={(o) => !o && setTabsFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Tabs of “{tabsFor?.source.name}”</DialogTitle></DialogHeader>
          {tabsFor && (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveTabs.mutate(); }}>
              <p className="text-sm text-muted-foreground">
                New rows in every ticked tab become leads. Rows already in a tab when you tick it are remembered, not imported.
              </p>
              {tabsFor.list ? (
                <TabPicker list={tabsFor.list} gids={tabsFor.gids} onChange={(gids) => setTabsFor({ ...tabsFor, gids })} />
              ) : <p className="text-sm text-muted-foreground">Fetching the sheet&apos;s tabs…</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setTabsFor(null)}>Cancel</Button>
                <Button type="submit" disabled={!tabsFor.list || saveTabs.isPending}>{saveTabs.isPending ? "Saving…" : `Save (${tabsFor.gids.length || "first tab only"}${tabsFor.gids.length ? ` tab${tabsFor.gids.length === 1 ? "" : "s"}` : ""})`}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!teamFor} onOpenChange={(o) => !o && setTeamFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Sales team for “{teamFor?.source.name}”</DialogTitle></DialogHeader>
          {teamFor && (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveTeam.mutate(); }}>
              <p className="text-sm text-muted-foreground">
                Leads from this source rotate only among the ticked BDMs who are online. Leave everyone unticked to share them among all online BDMs.
              </p>
              <div className="flex gap-2 text-xs">
                <button type="button" className="text-primary-text hover:underline" onClick={() => setTeamFor({ ...teamFor, userIds: (bdms ?? []).map((b) => b.id) })}>Select all</button>
                <button type="button" className="text-primary-text hover:underline" onClick={() => setTeamFor({ ...teamFor, userIds: (bdms ?? []).filter((b) => teamsOf(b.id, teamFor.source.id).length === 0).map((b) => b.id) })}>Select everyone not in another sheet&apos;s team</button>
                <button type="button" className="text-muted-foreground hover:underline" onClick={() => setTeamFor({ ...teamFor, userIds: [] })}>Clear</button>
              </div>
              <div className="grid sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto">
                {bdms?.map((b) => {
                  const other = teamsOf(b.id, teamFor.source.id);
                  return (
                    <label key={b.id} className="flex items-start gap-2 text-sm border rounded-lg px-3 py-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={teamFor.userIds.includes(b.id)}
                        onChange={(e) => setTeamFor({ ...teamFor, userIds: e.target.checked ? [...teamFor.userIds, b.id] : teamFor.userIds.filter((id) => id !== b.id) })}
                      />
                      <span className="min-w-0">
                        <span className="font-medium">{b.name}</span>
                        {b.inRotation && <span className="ml-1.5 inline-block size-2 rounded-full bg-emerald-500" title="Online" />}
                        {other.length > 0 && <span className="block text-[11px] text-amber-600 truncate">Also in: {other.join(", ")}</span>}
                      </span>
                    </label>
                  );
                })}
                {!bdms?.length && <p className="text-sm text-muted-foreground col-span-2">No BDMs yet — add them in Masters → BDM Master.</p>}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setTeamFor(null)}>Cancel</Button>
                <Button type="submit" disabled={saveTeam.isPending}>{saveTeam.isPending ? "Saving…" : `Save${teamFor.userIds.length ? ` (${teamFor.userIds.length} BDMs)` : " (all online BDMs)"}`}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!oldFor} onOpenChange={(o) => !o && setOldFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Import old leads — {oldFor?.source.name}</DialogTitle></DialogHeader>
          {oldFor && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); importOld.mutate(); }}>
              <p className="text-sm text-muted-foreground">
                {oldFor.source.type === "meta"
                  ? "Leads are fetched from your Meta lead forms."
                  : `${oldFor.source.oldRows} rows from the sheet become leads, oldest first.`}{" "}
                A mobile number that already has an open lead is added to that lead as a note instead of creating a duplicate.
              </p>
              <div className="space-y-2">
                <Label>Who gets them?</Label>
                {([
                  ["team", "Share evenly across the team", oldFor.source.team.length
                    ? `${oldFor.source.team.map((t) => t.name).join(", ")} — online or not, fewest open leads first`
                    : "Every active BDM — online or not, fewest open leads first"],
                  ["rotation", "Round-robin among BDMs online right now", "Same as a new lead. If nobody is online they wait until someone presses Start."],
                  ["unassigned", "Keep unassigned", "Hand them out yourself later from Lead Filter or Lead Transfer."],
                ] as const).map(([value, title, hint]) => (
                  <label key={value} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer ${oldFor.mode === value ? "border-primary bg-primary/5" : ""}`}>
                    <input type="radio" name="mode" className="mt-1" checked={oldFor.mode === value} onChange={() => setOldFor({ ...oldFor, mode: value })} />
                    <span>
                      <span className="text-sm font-medium block">{title}</span>
                      <span className="text-xs text-muted-foreground">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Lead date from {oldFor.source.type !== "meta" && <span className="text-muted-foreground font-normal">(optional)</span>}</Label>
                  <Input type="date" value={oldFor.from} onChange={(e) => setOldFor({ ...oldFor, from: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>to <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input type="date" value={oldFor.to} min={oldFor.from || undefined} onChange={(e) => setOldFor({ ...oldFor, to: e.target.value })} />
                </div>
              </div>
              {oldFor.source.type === "meta" && !oldFor.from && <p className="text-xs text-muted-foreground">Without a start date the last 90 days are fetched.</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOldFor(null)}>Cancel</Button>
                <Button type="submit" disabled={importOld.isPending}>{importOld.isPending ? "Starting…" : "Import"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TabPicker({ list, gids, onChange }: { list: SheetTab[]; gids: string[]; onChange: (gids: string[]) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex gap-3 text-xs">
        <span className="text-muted-foreground">{list.length} tab{list.length === 1 ? "" : "s"} in this sheet · {gids.length} ticked</span>
        <button type="button" className="text-primary-text hover:underline" onClick={() => onChange(list.map((t) => t.gid))}>Select all</button>
        <button type="button" className="text-muted-foreground hover:underline" onClick={() => onChange([])}>Clear</button>
      </div>
      <div className="grid sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
        {list.map((t) => (
          <label key={t.gid} className="flex items-center gap-2 text-sm border rounded-lg px-3 py-2 cursor-pointer">
            <input type="checkbox" checked={gids.includes(t.gid)} onChange={(e) => onChange(e.target.checked ? [...gids, t.gid] : gids.filter((g) => g !== t.gid))} />
            <span className="truncate" title={t.title}>{t.title}</span>
          </label>
        ))}
      </div>
      {gids.length === 0 && <p className="text-xs text-amber-600">Nothing ticked: only the first tab is read.</p>}
    </div>
  );
}
