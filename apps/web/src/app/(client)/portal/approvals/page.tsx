"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface Task {
  id: string;
  title: string;
  status: string;
  projectId?: { projectName?: string };
}

export default function PortalApprovalsPage() {
  const queryClient = useQueryClient();
  const { data: tasks = [], refetch } = useQuery({
    queryKey: ["portal-tasks"],
    queryFn: () => api<Task[]>("/tasks"),
    select: (r) => r.filter((t) => t.status === "REVIEW"),
  });

  const approveMutation = useMutation({
    mutationFn: (taskId: string) =>
      api(`/tasks/${taskId}/approve`, { method: "POST" }),
    onSuccess: () => refetch(),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ taskId, reason }: { taskId: string; reason?: string }) =>
      api(`/tasks/${taskId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => refetch(),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Pending Approvals</h1>
      <p className="text-muted-foreground">Tasks in review awaiting your approval.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {tasks.map((t) => (
          <Card key={t.id}>
            <CardHeader>
              <CardTitle className="text-base">{t.title}</CardTitle>
              <span className="text-xs text-muted-foreground">
                {(t.projectId as { projectName?: string })?.projectName || "—"}
              </span>
            </CardHeader>
            <CardContent>
              <p className="text-sm">Approve or reject this deliverable.</p>
              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="bg-green-50 text-green-800 border-green-200"
                  onClick={() => approveMutation.mutate(t.id)}
                  disabled={approveMutation.isPending}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="bg-red-50 text-red-800 border-red-200"
                  onClick={() => rejectMutation.mutate({ taskId: t.id })}
                  disabled={rejectMutation.isPending}
                >
                  Reject
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {!tasks.length && (
        <p className="text-muted-foreground">No pending approvals.</p>
      )}
    </div>
  );
}
