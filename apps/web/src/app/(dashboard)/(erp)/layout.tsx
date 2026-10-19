import type { ReactNode } from "react";
import { ToastProvider } from "@/components/erp/ui/Toast";
import { AuthProvider } from "@/lib/erp/auth-context";

/** Quotation, payment, catalog and administration pages: the user's permissions, and toasts */
export default function ErpLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>
        <div className="erp">{children}</div>
      </AuthProvider>
    </ToastProvider>
  );
}
