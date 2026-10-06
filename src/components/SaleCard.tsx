import { Link } from 'react-router-dom'
import type { Sale } from '../../shared/shop'
import { purchaseMoney } from '../lib/purchases'

export function SaleCard({ sale }: { sale: Sale }) {
  return <div className="px-4 py-4 sm:px-5">
    <Link to={`/customers/${sale.customer_uuid}/purchases/${sale.uuid}`} className="group block" aria-label={`View sale for ${sale.customer_name}`}>
      <div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="break-words font-semibold group-hover:text-accent">{sale.customer_name}</p><time className="mt-1 block text-sm text-muted" dateTime={sale.created_at}>{new Date(sale.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })}</time></div><div className="shrink-0 text-right"><p className="font-semibold tabular-nums">{purchaseMoney(sale.total_paise)}</p><p className="mt-1 text-sm text-muted">{sale.payment_status === 'paid' ? 'Paid' : sale.payment_status === 'partially_paid' ? 'Partly paid' : 'Due'}</p></div></div>
    </Link>
  </div>
}
