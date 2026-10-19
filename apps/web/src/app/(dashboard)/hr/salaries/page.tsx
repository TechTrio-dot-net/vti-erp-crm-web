"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";
import { api } from "@/lib/api";
import { HR_ROLES, inr } from "@/lib/crm";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { DataTable, ErrorState, LoadingBlock, PageHeader, StatCard } from "@/components/crm/ui";

type Salary = {
  id: string; employeeId: string; month: string; baseSalary: number; workingDays: number; paidDays: number; bonus: number; deductions: number;
  netPay: number; status: "draft" | "paid"; paidAt: string | null; note: string | null; employeeName: string; employeeCode: string | null; designation: string | null; departmentName: string | null;
};

/** Edits commit on blur so typing stays smooth */
function NumberCell({ value, onSave, max }: { value: number; onSave: (v: number) => void; max?: number }) {
  const [draft, setDraft] = useState(String(value));
  return (
    <input
      type="number"
      min={0}
      max={max}
      step="0.5"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { const n = Number(draft); if (!Number.isNaN(n) && n !== value) onSave(n); else setDraft(String(value)); }}
      className="w-24 h-8 rounded-md border border-input bg-background px-2 text-sm text-right tabular-nums"
    />
  );
}

export default function MonthlySalaryPage() {
  const role = useAuthStore((s) => s.user?.role);
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const { data, isLoading, isError } = useQuery({
    queryKey: ["hr", "salaries", month],
    queryFn: () => api<{ rows: Salary[]; totals: { net: number; paid: number; count: number } }>(`/hr/salaries?month=${month}`),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["hr", "salaries"] });

  const generate = useMutation({
    mutationFn: () => api<{ created: number }>("/hr/salaries/generate", { method: "POST", body: JSON.stringify({ month }) }),
    onSuccess: (r) => { toast.success(r.created ? `${r.created} salary rows created` : "Every active employee already has a row"); refresh(); },
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => api(`/hr/salaries/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: refresh,
    onError: (err: Error) => { toast.error(err.message); refresh(); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/hr/salaries/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  if (role && !HR_ROLES.includes(role)) return <ErrorState message="HR pages are only available to HR and management" />;

  return (
    <div className="page space-y-5">
      <PageHeader title="Monthly Salary" subtitle="Net pay = base × paid days ÷ working days + bonus − deductions">
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm" />
        <Button onClick={() => generate.mutate()} disabled={generate.isPending}><Wand2 className="size-4" />Generate for month</Button>
      </PageHeader>
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard label="Employees" value={data.totals.count} tone="blue" />
            <StatCard label="Total net pay" value={inr(data.totals.net)} tone="purple" />
            <StatCard label="Paid" value={inr(data.totals.paid)} sub={`${inr(data.totals.net - data.totals.paid)} pending`} tone="green" />
          </div>
          <DataTable
            rows={data.rows}
            csvName={`salary-${month}`}
            empty='No salary rows for this month — press "Generate for month"'
            columns={[
              { key: "employeeName", label: "Employee", render: (r) => <div><p className="font-semibold">{r.employeeName}</p><p className="text-xs text-muted-foreground">{[r.employeeCode, r.designation, r.departmentName].filter(Boolean).join(" · ")}</p></div> },
              { key: "baseSalary", label: "Base", align: "right", render: (r) => <NumberCell key={`${r.id}-b-${r.baseSalary}`} value={r.baseSalary} onSave={(v) => update.mutate({ id: r.id, body: { baseSalary: v } })} /> },
              { key: "workingDays", label: "Working days", align: "right", render: (r) => <NumberCell key={`${r.id}-w-${r.workingDays}`} value={r.workingDays} onSave={(v) => update.mutate({ id: r.id, body: { workingDays: v } })} /> },
              { key: "paidDays", label: "Paid days", align: "right", render: (r) => <NumberCell key={`${r.id}-p-${r.paidDays}`} value={r.paidDays} max={r.workingDays} onSave={(v) => update.mutate({ id: r.id, body: { paidDays: v } })} /> },
              { key: "bonus", label: "Bonus", align: "right", render: (r) => <NumberCell key={`${r.id}-bo-${r.bonus}`} value={r.bonus} onSave={(v) => update.mutate({ id: r.id, body: { bonus: v } })} /> },
              { key: "deductions", label: "Deductions", align: "right", render: (r) => <NumberCell key={`${r.id}-d-${r.deductions}`} value={r.deductions} onSave={(v) => update.mutate({ id: r.id, body: { deductions: v } })} /> },
              { key: "netPay", label: "Net pay", align: "right", render: (r) => <span className="font-bold">{inr(r.netPay)}</span> },
              { key: "status", label: "Status", render: (r) => (
                <button
                  type="button"
                  onClick={() => update.mutate({ id: r.id, body: { status: r.status === "paid" ? "draft" : "paid" } })}
                  className={`badge ${r.status === "paid" ? "badge-green" : "badge-amber"} cursor-pointer`}
                  title="Click to toggle"
                >
                  {r.status === "paid" ? "Paid" : "Draft"}
                </button>
              ) },
              { key: "actions", label: "", csv: () => "", render: (r) => <Button size="sm" variant="ghost" className="h-7 px-2 text-xs hover:text-destructive" onClick={() => window.confirm(`Remove ${r.employeeName}'s salary row for ${month}?`) && remove.mutate(r.id)}>Remove</Button> },
            ]}
          />
        </>
      )}
    </div>
  );
}
