"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckSquare, Circle, Copy } from "lucide-react";

type WorkloadData = {
  userId: string;
  totalTasks: number;
  byStatus: Record<string, number>;
  tasks: Array<{
    id: string;
    title: string;
    status?: string;
    projectId?: { projectName?: string };
  }>;
};

export default function TeamMemberWorkloadPage() {
  const params = useParams()!;
  const router = useRouter();
  const id = params.id as string;

  const { data: userData } = useQuery({
    queryKey: ["user", id],
    queryFn: () => api<{ id: string; name: string; initials?: string }>(`/users/${id}`),
    enabled: !!id,
  });

  const { data: workloadData, isLoading } = useQuery({
    queryKey: ["workload", id],
    queryFn: () => api<WorkloadData>(`/users/${id}/workload`),
    enabled: !!id,
  });

  if (!userData) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{userData.name}</h1>
          <p className="text-muted-foreground mt-1">Task workload and assignments</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{workloadData?.totalTasks ?? 0}</div>
            <p className="text-sm text-muted-foreground">Total tasks</p>
          </CardContent>
        </Card>
        {workloadData?.byStatus && Object.entries(workloadData.byStatus).map(([status, count]) => (
          <Card key={status}>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{count}</div>
              <p className="text-sm text-muted-foreground capitalize">{status.replace("_", " ")}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckSquare className="size-4" />
            Assigned tasks
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8">
              <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Loading...
            </div>
          ) : (
            <div className="space-y-2">
              {workloadData?.tasks?.map((t) => (
                <Link
                  key={t.id}
                  href={`/tasks?task=${t.id}`}
                  className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <Circle className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <span>{(t.projectId as { projectName?: string })?.projectName || "—"}</span>
                      <span className="font-mono">#{t.id?.slice(-6) ?? "—"}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      if (t.id) navigator.clipboard.writeText(t.id);
                    }}
                    className="shrink-0 p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                    title="Copy Task ID"
                  >
                    <Copy className="size-3.5" />
                  </button>
                  <span className="text-xs px-2 py-1 rounded-full bg-muted capitalize shrink-0">
                    {t.status?.replace("_", " ") || "—"}
                  </span>
                </Link>
              ))}
              {(!workloadData?.tasks || workloadData.tasks.length === 0) && (
                <p className="text-muted-foreground py-8 text-center">No tasks assigned</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
