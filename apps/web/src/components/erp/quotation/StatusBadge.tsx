import type { QuotationStatus } from "@/lib/erp/types";
import { Badge, type BadgeTone } from "../ui/Badge";

const TONES: Record<QuotationStatus, BadgeTone> = {
  draft: "muted",
  sent: "soft",
  accepted: "brand",
  rejected: "dark",
  cancelled: "outline",
};

const LABELS: Record<QuotationStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export function StatusBadge({ status }: { status: QuotationStatus }) {
  return <Badge tone={TONES[status]}>{LABELS[status]}</Badge>;
}

export const STATUS_OPTIONS = (Object.keys(LABELS) as QuotationStatus[]).map((value) => ({ value, label: LABELS[value] }));
