"use client";

import { MasterPage, activeColumn } from "@/components/crm/MasterPage";

export default function DesignationsPage() {
  return (
    <MasterPage
      title="Designation"
      subtitle="Job titles employees can hold"
      endpoint="/masters/designations"
      queryKey={["masters", "designations"]}
      fields={[
        { name: "name", label: "Designation name", required: true },
        { name: "description", label: "Description", type: "textarea" },
        { name: "active", label: "Active", type: "checkbox" },
      ]}
      columns={[
        { key: "name", label: "Designation", className: "font-semibold" },
        { key: "description", label: "Description", className: "text-muted-foreground" },
        activeColumn,
      ]}
    />
  );
}
