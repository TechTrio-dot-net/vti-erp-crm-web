"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, Check } from "lucide-react";

type Post = {
  id: string;
  date: string;
  platform: string;
  postType: string;
  caption?: string;
  status: string;
  projectId?: { projectName?: string };
};

export default function PortalCalendarPage() {
  const queryClient = useQueryClient();
  const { data: posts, isLoading } = useQuery({
    queryKey: ["content-calendar", "portal"],
    queryFn: () => api<Post[]>("/content-calendar"),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api(`/content-calendar/${id}/approve`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["content-calendar", "portal"] }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Content Calendar</h1>
        <p className="text-muted-foreground mt-1">Review and approve scheduled content</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="size-4 text-primary-text" />
            Scheduled posts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8">
              <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Loading...
            </div>
          ) : (
            <div className="space-y-3">
              {posts?.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between p-4 rounded-lg border bg-card"
                >
                  <div>
                    <div className="font-medium">{p.platform} · {p.postType}</div>
                    <div className="text-sm text-muted-foreground">
                      {(p.projectId as { projectName?: string })?.projectName} · {new Date(p.date).toLocaleDateString()}
                    </div>
                    {p.caption && (
                      <p className="text-sm mt-1 line-clamp-2">{p.caption}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-1 rounded-full bg-muted capitalize">
                      {p.status}
                    </span>
                    {p.status === "APPROVAL" && (
                      <Button
                        size="sm"
                        onClick={() => approveMutation.mutate(p.id)}
                        disabled={approveMutation.isPending}
                      >
                        <Check className="size-4 mr-1" />
                        Approve
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {(!posts || posts.length === 0) && (
                <p className="text-muted-foreground py-8 text-center">No content scheduled</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
