import type { PaymentStatus, PaymentSummary as Summary } from '../../shared/payments'
import { paymentStatusLabels } from '../../shared/payments'
import { purchaseMoney } from '../lib/purchases'

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <span className={`inline-flex rounded-full border border-line px-2.5 py-1 text-xs font-medium ${status === 'paid' ? 'bg-ink text-white' : status === 'partially_paid' ? 'bg-paper text-ink' : 'bg-white text-muted'}`}>{paymentStatusLabels[status]}</span>
}
export function PurchasePaymentSummary({ summary }: { summary: Summary }) {
  return <dl className="grid gap-5 text-sm sm:grid-cols-3">
    <div><dt className="text-muted">Purchase grand total</dt><dd className="mt-1 font-medium tabular-nums" data-testid="payment-purchase-total">{purchaseMoney(summary.total_paise)}</dd></div>
    <div><dt className="text-muted">Amount paid</dt><dd className="mt-1 font-medium tabular-nums" data-testid="purchase-amount-paid">{purchaseMoney(summary.amount_paid_paise)}</dd></div>
    <div><dt className="text-muted">Outstanding amount</dt><dd className="mt-1 font-semibold tabular-nums" data-testid="purchase-outstanding">{purchaseMoney(summary.outstanding_paise)}</dd></div>
  </dl>
}
