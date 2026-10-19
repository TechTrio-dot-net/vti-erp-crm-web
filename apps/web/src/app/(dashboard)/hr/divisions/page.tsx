"use client";

import { MasterPage, activeColumn } from "@/components/crm/MasterPage";

export default function DivisionsPage() {
  return (
    <MasterPage
      title="Division"
      subtitle="Business divisions (used to group BDMs and employees)"
      endpoint="/masters/divisions"
      queryKey={["masters", "divisions"]}
      fields={[
        { name: "name", label: "Division name", required: true },
        { name: "description", label: "Description", type: "textarea" },
        { name: "active", label: "Active", type: "checkbox" },
      ]}
      columns={[
        { key: "name", label: "Division", className: "font-semibold" },
        { key: "description", label: "Description", className: "text-muted-foreground" },
        activeColumn,
      ]}
    />
  );
}
