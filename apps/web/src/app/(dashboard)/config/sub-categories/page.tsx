"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AdminOnly } from "@/components/crm/ui";
import { MasterPage, activeColumn } from "@/components/crm/MasterPage";

export default function SubCategoryPage() {
  const { data: mains } = useQuery({
    queryKey: ["masters", "categories", "main"],
    queryFn: () => api<Array<{ id: string; name: string }>>("/masters/categories?level=main"),
  });
  const parentName = (id: unknown) => mains?.find((m) => m.id === id)?.name ?? "—";
  return (
    <AdminOnly>
      <MasterPage
        title="Sub Category Master"
        subtitle="Sub categories under each main category"
        endpoint="/masters/categories?level=sub"
        queryKey={["masters", "categories", "sub"]}
        fields={[
          { name: "name", label: "Sub category name", required: true },
          { name: "parentId", label: "Main category", type: "select", required: true, options: { endpoint: "/masters/categories?level=main", queryKey: ["masters", "categories", "main"] } },
          { name: "active", label: "Active", type: "checkbox" },
        ]}
        columns={[
          { key: "name", label: "Sub category", className: "font-semibold" },
          { key: "parentId", label: "Main category", render: (r) => parentName(r.parentId), csv: (r) => parentName(r.parentId) },
          activeColumn,
        ]}
      />
    </AdminOnly>
  );
}
