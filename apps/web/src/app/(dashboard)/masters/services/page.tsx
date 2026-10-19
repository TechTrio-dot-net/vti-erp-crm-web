import { redirect } from "next/navigation";

/** The sales CRM and quotations share one list of services, managed on the catalog page */
export default function ServiceMasterPage() {
  redirect("/catalog/services");
}
