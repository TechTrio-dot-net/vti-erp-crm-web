"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Calendar, Plus, ChevronLeft, ChevronRight } from "lucide-react";

const STATUS_OPTIONS = [
  { value: "PLANNED",   label: "Planned",   badge: "badge-gray"   },
  { value: "DESIGNING", label: "Designing", badge: "badge-blue"   },
  { value: "APPROVAL",  label: "Approval",  badge: "badge-amber"  },
  { value: "SCHEDULED", label: "Scheduled", badge: "badge-sky"    },
  { value: "POSTED",    label: "Posted",    badge: "badge-green"  },
  { value: "CANCELLED", label: "Cancelled", badge: "badge-red"    },
] as const;

const PLATFORM_OPTIONS = [
  { value: "INSTAGRAM", label: "Instagram", color: "bg-pink-500" },
  { value: "FACEBOOK",  label: "Facebook",  color: "bg-blue-600" },
  { value: "LINKEDIN",  label: "LinkedIn",  color: "bg-sky-700"  },
  { value: "YOUTUBE",   label: "YouTube",   color: "bg-red-600"  },
];

const POST_TYPE_OPTIONS = [
  { value: "REEL",     label: "Reel"     },
  { value: "CAROUSEL", label: "Carousel" },
  { value: "STATIC",   label: "Static"   },
  { value: "STORY",    label: "Story"    },
  { value: "VIDEO",    label: "Video"    },
];

type CalendarPost = {
  id: string; date: string; platform: string; postType: string;
  caption?: string; status: string; projectId?: { projectName: string };
};

function statusBadge(s: string) {
  return STATUS_OPTIONS.find((o) => o.value === s)?.badge ?? "badge-gray";
}

function platformColor(p: string) {
  return PLATFORM_OPTIONS.find((o) => o.value === p)?.color ?? "bg-muted";
}

export default function ContentCalendarPage() {
  const queryClient = useQueryClient();
  const now = new Date();
  const [year, setYear]     = useState(now.getFullYear());
  const [monthIdx, setMonthIdx] = useState(now.getMonth()); // 0-based
  const [addOpen, setAddOpen]   = useState(false);
  const [editPost, setEditPost] = useState<CalendarPost | null>(null);
  const [projectId, setProjectId] = useState("");
  const [date, setDate]           = useState("");
  const [platform, setPlatform]   = useState("INSTAGRAM");
  const [postType, setPostType]   = useState("REEL");
  const [caption, setCaption]     = useState("");

  const monthStr = `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
  const lastDay  = new Date(year, monthIdx + 1, 0).getDate();

  const { data: posts, isLoading } = useQuery({
    queryKey: ["content-calendar", monthStr],
    queryFn: () => {
      const start = `${monthStr}-01`;
      const end   = `${monthStr}-${String(lastDay).padStart(2, "0")}`;
      return api<CalendarPost[]>(`/content-calendar?startDate=${start}&endDate=${end}`);
    },
  });

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ ACTIVE: { id: string; projectName: string }[]; ON_HOLD: unknown[]; COMPLETED: unknown[] }>("/projects"),
  });

  const createMutation = useMutation({
    mutationFn: (body: object) => api("/content-calendar", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["content-calendar"] }); setAddOpen(false); setProjectId(""); setDate(""); setCaption(""); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => api(`/content-calendar/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["content-calendar"] }); setEditPost(null); },
  });

  const allProjects = [...(projects?.ACTIVE || []), ...(projects?.ON_HOLD || []), ...(projects?.COMPLETED || [])] as { id: string; projectName: string }[];

  const byDate = (posts || []).reduce((acc, p) => {
    const d = p.date.slice(0, 10);
    if (!acc[d]) acc[d] = [];
    acc[d].push(p);
    return acc;
  }, {} as Record<string, CalendarPost[]>);

  const prevMonth = () => { if (monthIdx === 0) { setMonthIdx(11); setYear((y) => y - 1); } else setMonthIdx((m) => m - 1); };
  const nextMonth = () => { if (monthIdx === 11) { setMonthIdx(0); setYear((y) => y + 1); } else setMonthIdx((m) => m + 1); };

  const monthLabel = new Date(year, monthIdx, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const statusCounts = STATUS_OPTIONS.map(({ value, label, badge }) => ({
    label, badge, count: (posts || []).filter((p) => p.status === value).length,
  })).filter((s) => s.count > 0);

  return (
    <div className="page space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Content Calendar</h1>
          <p className="page-subtitle">Social media posts across all projects</p>
        </div>
        <Button onClick={() => setAddOpen(true)}><Plus className="size-4" />Add Post</Button>
      </div>

      {/* Month nav + stats */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="size-8 rounded-lg border border-border/60 flex items-center justify-center hover:bg-muted/60 transition-colors">
            <ChevronLeft className="size-4 text-muted-foreground" />
          </button>
          <span className="text-[15px] font-semibold w-44 text-center">{monthLabel}</span>
          <button onClick={nextMonth} className="size-8 rounded-lg border border-border/60 flex items-center justify-center hover:bg-muted/60 transition-colors">
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>
        </div>

        {statusCounts.length > 0 && (
          <div className="flex flex-wrap gap-2 sm:ml-4">
            {statusCounts.map(({ label, badge, count }) => (
              <span key={label} className={`badge ${badge}`}>{count} {label}</span>
            ))}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-3 text-muted-foreground py-16">
          <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Loading calendar…</span>
        </div>
      ) : !posts?.length ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon"><Calendar className="size-6 text-muted-foreground" /></div>
            <p className="font-semibold">No posts scheduled</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">Nothing planned for {monthLabel}</p>
            <Button onClick={() => setAddOpen(true)}><Plus className="size-4" />Add Post</Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 stagger">
          {Object.entries(byDate)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([d, items]) => (
              <div key={d} className="card animate-fade-up">
                <div className="px-4 py-3 border-b border-border/50">
                  <p className="text-[13px] font-semibold text-foreground">
                    {new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{items.length} post{items.length !== 1 ? "s" : ""}</p>
                </div>
                <div className="p-3 space-y-2">
                  {items.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => setEditPost(p)}
                      className="p-3 rounded-lg border border-border/50 bg-muted/20 cursor-pointer hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <span className={`size-2 rounded-full ${platformColor(p.platform)}`} />
                          <span className="text-xs font-semibold text-foreground">{p.platform}</span>
                          <span className="text-xs text-muted-foreground">· {p.postType}</span>
                        </div>
                        <span className={`badge ${statusBadge(p.status)} text-[10px] py-0`}>{p.status}</span>
                      </div>
                      {p.caption && <p className="text-sm text-foreground line-clamp-2 mb-1">{p.caption}</p>}
                      <p className="text-xs text-muted-foreground">
                        {(p.projectId as { projectName?: string })?.projectName || "No project"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Post</DialogTitle></DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!projectId || !date) return;
              createMutation.mutate({ projectId, date: new Date(date).toISOString(), platform, postType, caption: caption || undefined, status: "PLANNED" });
            }}
            className="space-y-4 pt-1"
          >
            <div className="space-y-1.5">
              <Label>Project *</Label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} required className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                <option value="">Select project…</option>
                {allProjects.map((p) => <option key={p.id} value={p.id}>{p.projectName}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Date *</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
              <div className="space-y-1.5">
                <Label>Platform</Label>
                <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                  {PLATFORM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Post type</Label>
                <select value={postType} onChange={(e) => setPostType(e.target.value)} className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                  {POST_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1.5"><Label>Caption</Label><Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Optional" /></div>
            {createMutation.isError && <p className="text-sm text-destructive">{createMutation.error instanceof Error ? createMutation.error.message : "Failed"}</p>}
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? "Creating…" : "Add Post"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editPost} onOpenChange={(open) => !open && setEditPost(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Post</DialogTitle></DialogHeader>
          {editPost && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.target as HTMLFormElement);
                updateMutation.mutate({
                  id: editPost.id,
                  body: {
                    date: new Date((fd.get("date") as string) || editPost.date).toISOString(),
                    platform: fd.get("platform") || editPost.platform,
                    postType: fd.get("postType") || editPost.postType,
                    caption: (fd.get("caption") as string) || undefined,
                    status: fd.get("status") || editPost.status,
                  },
                });
              }}
              className="space-y-4 pt-1"
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 col-span-2">
                  <Label>Status</Label>
                  <select name="status" defaultValue={editPost.status} className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                    {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5"><Label>Date</Label><Input name="date" type="date" defaultValue={editPost.date.slice(0, 10)} /></div>
                <div className="space-y-1.5">
                  <Label>Platform</Label>
                  <select name="platform" defaultValue={editPost.platform} className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                    {PLATFORM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>Post type</Label>
                  <select name="postType" defaultValue={editPost.postType} className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                    {POST_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5"><Label>Caption</Label><Input name="caption" defaultValue={editPost.caption || ""} placeholder="Optional" /></div>
              <p className="text-xs text-muted-foreground">Project: {(editPost.projectId as { projectName?: string })?.projectName || "—"}</p>
              {updateMutation.isError && <p className="text-sm text-destructive">{updateMutation.error instanceof Error ? updateMutation.error.message : "Failed"}</p>}
              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => setEditPost(null)}>Cancel</Button>
                <Button type="submit" disabled={updateMutation.isPending}>{updateMutation.isPending ? "Saving…" : "Save Changes"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
