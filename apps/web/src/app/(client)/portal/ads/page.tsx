"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, TrendingUp } from "lucide-react";

type Campaign = {
  id: string;
  name?: string;
  platform: string;
  status: string;
  impressions?: number;
  clicks?: number;
  leads?: number;
  ctr?: number;
  projectId?: { projectName?: string };
};

type DashboardData = {
  totalImpressions: number;
  totalClicks: number;
  totalLeads: number;
  avgCtr: number;
  campaignCount: number;
};

export default function PortalAdsPage() {
  const { data: campaigns } = useQuery({
    queryKey: ["ad-campaigns", "portal"],
    queryFn: () => api<Campaign[]>("/ad-campaigns"),
  });

  const { data: dashboard } = useQuery({
    queryKey: ["ad-campaigns", "dashboard"],
    queryFn: () => api<DashboardData>("/ad-campaigns/dashboard"),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Ad Campaigns</h1>
        <p className="text-muted-foreground mt-1">Campaign performance and metrics</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <BarChart3 className="size-5 text-primary-text" />
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {dashboard?.totalImpressions?.toLocaleString() ?? 0}
                </div>
                <p className="text-sm text-muted-foreground">Impressions</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <TrendingUp className="size-5 text-primary-text" />
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {dashboard?.totalClicks?.toLocaleString() ?? 0}
                </div>
                <p className="text-sm text-muted-foreground">Clicks</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{dashboard?.totalLeads ?? 0}</div>
            <p className="text-sm text-muted-foreground">Leads</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {dashboard?.avgCtr?.toFixed(2) ?? 0}%
            </div>
            <p className="text-sm text-muted-foreground">Avg CTR</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Campaigns</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {campaigns?.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between p-4 rounded-lg border bg-card"
              >
                <div>
                  <div className="font-medium">{(c as { name?: string }).name || c.platform}</div>
                  <div className="text-sm text-muted-foreground">
                    {(c.projectId as { projectName?: string })?.projectName} · {c.platform}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span>{c.impressions?.toLocaleString() ?? 0} imp</span>
                  <span>{c.clicks ?? 0} clicks</span>
                  <span className="font-medium">{c.ctr?.toFixed(2) ?? 0}% CTR</span>
                  <span className="px-2 py-1 rounded-full bg-muted capitalize">{c.status}</span>
                </div>
              </div>
            ))}
            {(!campaigns || campaigns.length === 0) && (
              <p className="text-muted-foreground py-8 text-center">No campaigns yet</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
