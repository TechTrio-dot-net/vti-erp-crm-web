"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MasterPage, activeColumn } from "@/components/crm/MasterPage";

export default function DepartmentsPage() {
  const { data: divisions } = useQuery({
    queryKey: ["masters", "divisions"],
    queryFn: () => api<Array<{ id: string; name: string }>>("/masters/divisions"),
  });
  const divisionName = (id: unknown) => divisions?.find((d) => d.id === id)?.name ?? "—";
  return (
    <MasterPage
      title="Department"
      subtitle="Departments within each division"
      endpoint="/masters/departments"
      queryKey={["masters", "departments"]}
      fields={[
        { name: "name", label: "Department name", required: true },
        { name: "code", label: "Code" },
        { name: "divisionId", label: "Division", type: "select", options: { endpoint: "/masters/divisions", queryKey: ["masters", "divisions"] } },
        { name: "description", label: "Description", type: "textarea" },
        { name: "active", label: "Active", type: "checkbox" },
      ]}
      columns={[
        { key: "name", label: "Department", className: "font-semibold" },
        { key: "code", label: "Code" },
        { key: "divisionId", label: "Division", render: (r) => divisionName(r.divisionId), csv: (r) => divisionName(r.divisionId) },
        { key: "description", label: "Description", className: "text-muted-foreground" },
        activeColumn,
      ]}
    />
  );
}
