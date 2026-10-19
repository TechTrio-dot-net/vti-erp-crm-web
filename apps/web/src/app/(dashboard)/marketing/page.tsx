"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import Link from "next/link";
import { ArrowRight, TrendingUp, Calendar, Target, Megaphone, BarChart3, IndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";

type PlatformStats = {
  platform: string; impressions: number; clicks: number; leads: number; ctr: number;
  dailyBudget: number; campaigns: number; activeCampaigns: number;
};
type AdSummary = {
  totalImpressions: number; totalClicks: number; totalLeads: number; avgCtr: number;
  campaignCount: number; activeCampaignCount: number; activeDailyBudget: number; byPlatform: PlatformStats[];
};
type ContentSummary = { total: number; byStatus: Record<string, number> };

const PLATFORMS = [
  { key: "META_ADS", label: "Meta Ads", chip: "icon-chip-blue", icon: Megaphone },
  { key: "GOOGLE_ADS", label: "Google Ads", chip: "icon-chip-amber", icon: IndianRupee },
];

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n)));
const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function monthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return { start: start.toISOString(), end: end.toISOString(), key: `${now.getFullYear()}-${now.getMonth() + 1}` };
}

export default function MarketingPage() {
  const range = monthRange();

  const { data: adDash } = useQuery({
    queryKey: ["ad-dashboard"],
    queryFn: () => api<AdSummary>("/ad-campaigns/dashboard"),
  });

  const { data: content } = useQuery({
    queryKey: ["content-calendar", "summary", range.key],
    queryFn: () => api<ContentSummary>(`/content-calendar/summary?startDate=${range.start}&endDate=${range.end}`),
  });

  const totalPosts = content?.total ?? 0;
  const postedCount = content?.byStatus?.POSTED ?? 0;
  const awaitingApproval = content?.byStatus?.APPROVAL ?? 0;

  return (
    <div className="page space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Marketing Hub</h1>
          <p className="page-subtitle">Campaigns, ads, and content — all in one place</p>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger">
        <div className="card animate-fade-up kpi-blue p-5">
          <div className="flex items-start justify-between mb-3">
            <p className="text-[13px] font-medium text-muted-foreground">Impressions</p>
            <div className="icon-chip size-9 icon-chip-blue"><BarChart3 className="size-4" /></div>
          </div>
          <div className="text-3xl font-bold tabular-nums">{adDash ? compact(adDash.totalImpressions) : "—"}</div>
          <p className="text-xs text-muted-foreground mt-1">all campaigns</p>
        </div>
        <div className="card animate-fade-up kpi-green p-5">
          <div className="flex items-start justify-between mb-3">
            <p className="text-[13px] font-medium text-muted-foreground">Ad Leads</p>
            <div className="icon-chip size-9 icon-chip-green"><Target className="size-4" /></div>
          </div>
          <div className="text-3xl font-bold tabular-nums">{adDash ? compact(adDash.totalLeads) : "—"}</div>
          <p className="text-xs text-muted-foreground mt-1">from paid campaigns</p>
        </div>
        <div className="card animate-fade-up kpi-amber p-5">
          <div className="flex items-start justify-between mb-3">
            <p className="text-[13px] font-medium text-muted-foreground">Avg CTR</p>
            <div className="icon-chip size-9 icon-chip-amber"><TrendingUp className="size-4" /></div>
          </div>
          <div className="text-3xl font-bold tabular-nums">{adDash ? `${adDash.avgCtr.toFixed(1)}%` : "—"}</div>
          <p className="text-xs text-muted-foreground mt-1">across {adDash?.campaignCount ?? 0} campaigns</p>
        </div>
        <div className="card animate-fade-up kpi-sky p-5">
          <div className="flex items-start justify-between mb-3">
            <p className="text-[13px] font-medium text-muted-foreground">Posts This Month</p>
            <div className="icon-chip size-9 icon-chip-sky"><Calendar className="size-4" /></div>
          </div>
          <div className="text-3xl font-bold tabular-nums">{postedCount}<span className="text-base text-muted-foreground font-normal"> / {totalPosts}</span></div>
          <p className="text-xs text-muted-foreground mt-1">posted vs planned</p>
        </div>
      </div>

      {/* Quick nav cards */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card card-lift p-6 flex flex-col gap-4">
          <div className="flex items-start gap-4">
            <div className="icon-chip size-11 icon-chip-blue rounded-xl">
              <TrendingUp className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground">Ad Campaigns</p>
              <p className="text-sm text-muted-foreground mt-0.5">Track Meta Ads & Google Ads performance, CTR, impressions, and leads.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-muted/40 rounded-lg p-3">
              <p className="text-muted-foreground text-xs mb-1">Active campaigns</p>
              <p className="font-bold text-foreground text-lg tabular-nums">{adDash?.activeCampaignCount ?? "—"}</p>
            </div>
            <div className="bg-muted/40 rounded-lg p-3">
              <p className="text-muted-foreground text-xs mb-1">Active daily budget</p>
              <p className="font-bold text-foreground text-lg tabular-nums">{adDash ? rupees(adDash.activeDailyBudget) : "—"}</p>
            </div>
          </div>
          <Link href="/ads">
            <Button variant="outline" className="w-full">View Ads Tracker <ArrowRight className="size-4" /></Button>
          </Link>
        </div>

        <div className="card card-lift p-6 flex flex-col gap-4">
          <div className="flex items-start gap-4">
            <div className="icon-chip size-11 icon-chip-green rounded-xl">
              <Calendar className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground">Content Calendar</p>
              <p className="text-sm text-muted-foreground mt-0.5">Plan and track posts across Instagram, Facebook, LinkedIn & YouTube.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-muted/40 rounded-lg p-3">
              <p className="text-muted-foreground text-xs mb-1">Posted this month</p>
              <p className="font-bold text-foreground text-lg tabular-nums">{postedCount}</p>
            </div>
            <div className="bg-muted/40 rounded-lg p-3">
              <p className="text-muted-foreground text-xs mb-1">Awaiting client approval</p>
              <p className="font-bold text-foreground text-lg tabular-nums">{awaitingApproval}</p>
            </div>
          </div>
          <Link href="/content-calendar">
            <Button variant="outline" className="w-full">View Content Calendar <ArrowRight className="size-4" /></Button>
          </Link>
        </div>
      </div>

      {/* Per-platform performance from real campaign data */}
      {PLATFORMS.map(({ key, label, chip, icon: Icon }) => {
        const p = adDash?.byPlatform.find((b) => b.platform === key);
        return (
          <div key={key} className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className={`icon-chip size-8 ${chip} rounded-lg`}>
                <Icon className="size-4" />
              </div>
              <p className="font-semibold text-[15px]">{label}</p>
              <span className="badge badge-gray ml-auto">{p ? `${p.activeCampaigns} active / ${p.campaigns} total` : "No campaigns"}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Daily budget (active)", value: p ? rupees(p.dailyBudget) : "—" },
                { label: "Impressions", value: p ? compact(p.impressions) : "—" },
                { label: "CTR", value: p ? `${p.ctr.toFixed(1)}%` : "—" },
                { label: "Leads", value: p ? compact(p.leads) : "—" },
              ].map(({ label: l, value }) => (
                <div key={l} className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">{l}</p>
                  <p className="text-lg font-bold tabular-nums text-foreground">{value}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
