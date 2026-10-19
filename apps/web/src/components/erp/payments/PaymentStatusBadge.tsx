import type { PaymentStatus } from "@/lib/erp/types";
import { Badge, type BadgeTone } from "../ui/Badge";

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  partial: "Partly paid",
  paid: "Fully paid",
  completed: "Completed",
};

const TONES: Record<PaymentStatus, BadgeTone> = {
  unpaid: "muted",
  partial: "soft",
  paid: "outline",
  completed: "brand",
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge tone={TONES[status]}>{PAYMENT_STATUS_LABELS[status]}</Badge>;
}
