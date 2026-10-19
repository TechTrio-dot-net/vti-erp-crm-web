"use client";

import { AdminOnly } from "@/components/crm/ui";
import { MasterPage, activeColumn } from "@/components/crm/MasterPage";

export default function MainCategoryPage() {
  return (
    <AdminOnly>
      <MasterPage
        title="Main Category Master"
        subtitle="Top-level categories for services"
        endpoint="/masters/categories?level=main"
        queryKey={["masters", "categories", "main"]}
        fields={[
          { name: "name", label: "Category name", required: true },
          { name: "active", label: "Active", type: "checkbox" },
        ]}
        columns={[{ key: "name", label: "Main category", className: "font-semibold" }, activeColumn]}
      />
    </AdminOnly>
  );
}
