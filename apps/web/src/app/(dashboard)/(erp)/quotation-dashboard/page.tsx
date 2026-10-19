"use client";

import Link from "next/link";
import type { DashboardData } from "@/lib/erp/types";
import { useAuth } from "@/lib/erp/auth-context";
import { useApi } from "@/lib/erp/use-api";
import { formatMoney, timeAgo } from "@/lib/erp/format";
import { DashboardCard } from "@/components/erp/DashboardCard";
import { RequirePermission } from "@/components/erp/RequirePermission";
import { EditorAssignments } from "@/components/erp/quotation/EditorAssignments";
import { StatusBadge } from "@/components/erp/quotation/StatusBadge";
import { Alert, Card, CardHeader, PageHeader } from "@/components/erp/ui/Card";
import { buttonClass } from "@/components/erp/ui/Button";
import { Icon } from "@/components/erp/ui/Icon";

export default function DashboardPage() {
  return (
    <RequirePermission permission="dashboard.view">
      <Dashboard />
    </RequirePermission>
  );
}

function Dashboard() {
  const { user, can } = useAuth();
  const { data, error } = useApi<{ data: DashboardData }>("/dashboard");
  const d = data?.data;
  const m = d?.metrics;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const weekCount = d?.daily_summary.reduce((sum, day) => sum + day.count, 0) ?? 0;
  const weekValue = d?.daily_summary.reduce((sum, day) => sum + Number(day.total), 0) ?? 0;
  const today = d?.daily_summary.at(-1);

  // Where each card leads. Every link reproduces the card's own figure: the
  // quotation list is scoped to the viewer just as the dashboard is, and "today"
  // is the server's calendar day (the last chart day), not the browser's.
  const canQuotations = can(["quotations.view", "quotations.view_all"]);
  const links = {
    employees: can("employees.view") ? "/hr/employees" : undefined,
    today: canQuotations && today ? `/quotations?from=${today.date}&to=${today.date}` : undefined,
    pending: canQuotations ? "/quotations?status=draft,sent" : undefined,
    accepted: canQuotations ? "/quotations?status=accepted" : undefined,
    // Everything except rejected and cancelled, as the card's hint says.
    open: canQuotations ? "/quotations?status=draft,sent,accepted" : undefined,
  };

  return (
    <>
      <PageHeader
        title={`${greeting}, ${user.name.split(" ")[0]}`}
        description={d?.scope === "personal" ? "Your personal overview — figures cover the quotations you created." : "Company-wide overview."}
        actions={
          can("quotations.create") && (
            <Link href="/quotations/new" className={buttonClass()}>
              <Icon name="plus" className="h-4 w-4" />
              New quotation
            </Link>
          )
        }
      />

      {error && (
        <div className="mb-6">
          <Alert>{error.message}</Alert>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <DashboardCard label="Total employees" value={m?.total_employees} icon="users" href={links.employees} />
        <DashboardCard label="Today's quotations" value={m?.todays_quotations} icon="filePlus" href={links.today} />
        <DashboardCard label="Pending quotations" value={m?.pending_quotations} icon="clock" hint="Draft or sent" href={links.pending} />
        <DashboardCard label="Accepted quotations" value={m?.accepted_quotations} icon="checkCircle" href={links.accepted} />
        <DashboardCard
          label="Total quotation value"
          value={m && formatMoney(m.total_quotation_value)}
          icon="rupee"
          hint="Excludes rejected and cancelled"
          href={links.open}
        />
        <DashboardCard label="Accepted value" value={m && formatMoney(m.accepted_quotation_value)} icon="trendingUp" href={links.accepted} />
      </div>

      {/* Employees write video editing quotations without an editor; these roles assign one here. */}
      {can("artists.assign") && can(["quotations.view", "quotations.view_all"]) && (
        <div className="mt-6">
          <EditorAssignments />
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Daily summary"
            description="Quotations created over the last 7 days"
            actions={
              d && (
                <span className="text-xs text-neutral-500">
                  Today: <strong className="text-neutral-900">{today?.count ?? 0}</strong> · {formatMoney(today?.total ?? 0)} &nbsp;|&nbsp; 7 days:{" "}
                  <strong className="text-neutral-900">{weekCount}</strong> · {formatMoney(weekValue)}
                </span>
              )
            }
          />
          <div className="p-5">{d ? <DailyChart days={d.daily_summary} /> : <div className="h-48 animate-pulse rounded bg-neutral-50" />}</div>
        </Card>

        <Card>
          <CardHeader title="Quotations by status" />
          <ul className="divide-y divide-neutral-100">
            {d?.quotations_by_status.map((row) => (
              <li key={row.status} className="flex items-center justify-between px-5 py-3 text-sm">
                <StatusBadge status={row.status} />
                <span className="font-semibold text-neutral-900">{row.count}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recent activity" />
          {d && d.recent_activity.length === 0 && <p className="px-5 py-8 text-center text-sm text-neutral-500">No activity yet.</p>}
          <ul className="divide-y divide-neutral-100">
            {d?.recent_activity.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-5 py-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-neutral-800">{item.description}</p>
                  <p className="text-xs text-neutral-500">
                    {item.user ?? "System"} · {timeAgo(item.created_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Value by service" description="All quotation lines" />
          {d && d.quotations_by_service.length === 0 && <p className="px-5 py-8 text-center text-sm text-neutral-500">No quotations yet.</p>}
          <ul className="space-y-4 p-5">
            {d?.quotations_by_service.map((row) => {
              const max = Math.max(...d.quotations_by_service.map((r) => Number(r.total)), 1);
              return (
                <li key={row.service}>
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-700">{row.service}</span>
                    <span className="font-medium text-neutral-900">{formatMoney(row.total)}</span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-neutral-100">
                    <div className="h-2 rounded-full bg-brand" style={{ width: `${(Number(row.total) / max) * 100}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">{row.items} line(s)</p>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </>
  );
}

function DailyChart({ days }: { days: DashboardData["daily_summary"] }) {
  const max = Math.max(1, ...days.map((day) => day.count));

  return (
    <div className="flex h-48 items-stretch gap-3">
      {days.map((day) => (
        <div key={day.date} className="flex flex-1 flex-col items-center gap-2">
          <span className="text-xs font-medium text-neutral-700">{day.count}</span>
          <div className="flex w-full flex-1 items-end">
            <div
              className="w-full rounded-t-md bg-brand transition-all"
              style={{ height: `${(day.count / max) * 100}%`, minHeight: day.count ? 6 : 2 }}
              title={`${day.count} quotation(s) · ${formatMoney(day.total)}`}
            />
          </div>
          <span className="text-[11px] text-neutral-500">{new Date(day.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric" })}</span>
        </div>
      ))}
    </div>
  );
}
