"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

interface Project {
  id: string;
  projectName: string;
  projectStatus: string;
  clientName: string;
}

export default function PortalProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    api<Record<string, unknown>>("/projects")
      .then((r) => {
        const data = r as { ACTIVE?: Project[]; ON_HOLD?: Project[]; COMPLETED?: Project[] };
        const all = [...(data.ACTIVE || []), ...(data.ON_HOLD || []), ...(data.COMPLETED || [])];
        setProjects(all);
      })
      .catch(() => setProjects([]));
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My Projects</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => (
          <Card key={p.id}>
            <CardHeader>
              <CardTitle className="text-base">{p.projectName}</CardTitle>
              <span className="text-xs text-muted-foreground capitalize">{p.projectStatus?.replace("_", " ")}</span>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{p.clientName}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {!projects.length && (
        <p className="text-muted-foreground">No projects yet.</p>
      )}
    </div>
  );
}
