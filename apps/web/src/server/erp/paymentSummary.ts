import { Decimal, dec, money } from './decimal';

/** unpaid: nothing received. partial: some received. paid: all received, not yet closed. completed: closed. */
export const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid', 'completed'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

interface Payable {
  grandTotal: string;
  amountPaid: string | null;
  paymentCompletedAt: Date | null;
}

/** What has been received on a quotation and what is still due */
export function paymentSummary(quotation: Payable) {
  const total = dec(quotation.grandTotal);
  const paid = dec(quotation.amountPaid ?? 0);
  const pending = Decimal.max(total.minus(paid), 0);
  const status: PaymentStatus = quotation.paymentCompletedAt ? 'completed' : paid.lte(0) ? 'unpaid' : paid.gte(total) ? 'paid' : 'partial';

  return {
    total: money(total),
    paid: money(paid),
    pending: money(pending),
    status,
    completed_at: quotation.paymentCompletedAt?.toISOString() ?? null,
  };
}
