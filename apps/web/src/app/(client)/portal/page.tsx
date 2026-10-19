"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

interface DashboardData {
  kpis?: { activeProjects?: number; activeClients?: number };
  activities?: { date: string; description: string; userName: string }[];
}

export default function ClientPortalPage() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    api<{ kpis?: unknown; activities?: unknown }>("/dashboard")
      .then((r) => setData(r as DashboardData))
      .catch(() => setData({ kpis: {}, activities: [] }));
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Project Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{data?.kpis?.activeProjects ?? 0}</p>
            <p className="text-sm text-muted-foreground">Active projects</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending Approvals</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">View tasks awaiting your approval</p>
            <Link href="/portal/approvals" className="text-foreground text-sm mt-2 inline-block hover:underline font-medium">
              Go to approvals →
            </Link>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.activities?.length ? (
            <ul className="space-y-2">
              {data.activities.map((a, i) => (
                <li key={i} className="text-sm">
                  <span className="text-muted-foreground">{a.userName}</span> — {a.description}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No recent activity</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
