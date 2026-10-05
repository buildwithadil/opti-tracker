import { Link } from 'react-router-dom'
import type { Sale } from '../../shared/shop'
import { purchaseMoney } from '../lib/purchases'

export function SaleCard({ sale }: { sale: Sale }) {
  return <div className="px-4 py-4 sm:px-5">
    <Link to={`/customers/${sale.customer_uuid}/purchases/${sale.uuid}`} className="group block" aria-label={`View sale for ${sale.customer_name}`}>
      <div className="flex items-start justify-between gap-4"><p className="min-w-0 break-words font-semibold group-hover:text-accent">{sale.customer_name}</p><p className="shrink-0 font-semibold tabular-nums">{purchaseMoney(sale.total_paise)}</p></div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted"><p>{sale.payment_status === 'paid' ? 'Paid' : <>Paid {purchaseMoney(sale.amount_paid_paise)} · Due {purchaseMoney(sale.outstanding_paise)}</>}</p><time dateTime={sale.created_at}>{new Date(sale.created_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}</time></div>
      {sale.invoice_number ? <p className="mt-1 text-xs text-muted">{sale.invoice_number}</p> : null}
    </Link>
    {sale.outstanding_paise>0 && !sale.archived_at ? <Link className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-accent" to={`/receive-payment?customer=${sale.customer_uuid}&sale=${sale.uuid}`}>Receive payment →</Link> : null}
  </div>
}
