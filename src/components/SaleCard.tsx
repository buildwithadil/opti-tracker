import { Link } from 'react-router-dom'
import type { Sale } from '../../shared/shop'
import { customerDate } from '../lib/customers'
import { purchaseMoney } from '../lib/purchases'
import { Card, CardContent } from './ui/Card'
import { ActionLink } from './ui/ShopUI'
import { PaymentStatusBadge } from './PaymentSummary'

export function SaleCard({ sale }: { sale: Sale }) {
  return <Card><CardContent className="space-y-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><Link to={`/customers/${sale.customer_uuid}/purchases/${sale.uuid}`} className="block break-words font-semibold">{sale.customer_name}</Link><p className="mt-1 text-sm text-muted">{sale.invoice_number || 'Invoice not issued'}</p></div><PaymentStatusBadge status={sale.payment_status} /></div><div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-xl font-semibold tabular-nums">{purchaseMoney(sale.total_paise)}</p><p className="text-sm tabular-nums text-muted">Paid {purchaseMoney(sale.amount_paid_paise)} · Due {purchaseMoney(sale.outstanding_paise)}</p></div><p className="text-xs text-muted"><time dateTime={sale.created_at}>{customerDate(sale.created_at,true)}</time> · Sale date {sale.purchase_date}</p><div className="flex flex-wrap gap-2"><ActionLink secondary to={`/customers/${sale.customer_uuid}/purchases/${sale.uuid}`}>View sale</ActionLink>{sale.outstanding_paise>0 && !sale.archived_at ? <ActionLink secondary to={`/receive-payment?customer=${sale.customer_uuid}&sale=${sale.uuid}`}>Receive Payment</ActionLink> : null}</div></CardContent></Card>
}
