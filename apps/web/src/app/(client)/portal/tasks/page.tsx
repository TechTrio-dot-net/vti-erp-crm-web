"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  projectId?: { projectName?: string };
}

export default function PortalTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    api<Task[]>("/tasks")
      .then(setTasks)
      .catch(() => setTasks([]));
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Tasks</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tasks.map((t) => (
          <Card key={t.id}>
            <CardHeader>
              <CardTitle className="text-base">{t.title}</CardTitle>
              <div className="flex gap-2 text-xs">
                <span className="text-muted-foreground capitalize">{t.status?.replace("_", " ")}</span>
                <span className="text-muted-foreground">•</span>
                <span className="capitalize">{t.priority}</span>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {(t.projectId as { projectName?: string })?.projectName || "—"}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      {!tasks.length && (
        <p className="text-muted-foreground">No tasks yet.</p>
      )}
    </div>
  );
}
