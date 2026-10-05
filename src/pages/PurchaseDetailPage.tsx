import { useQuery } from '@tanstack/react-query'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../components/ui/States'
import { ApiError } from '../lib/api'
import { customerDate, customerErrorMessage, customerKeys, customersApi } from '../lib/customers'
import { prescriptionDate } from '../lib/prescriptions'
import { categoryLabel, purchaseErrorMessage, purchaseKeys, purchaseMoney, purchasesApi } from '../lib/purchases'

export function PurchaseDetailPage() {
  const { uuid = '', purchaseUuid = '' } = useParams()
  const location = useLocation()
  const customer = useQuery({ queryKey: customerKeys.detail(uuid), queryFn: ({ signal }) => customersApi.detail(uuid, signal), retry: false })
  const purchase = useQuery({ queryKey: purchaseKeys.detail(uuid, purchaseUuid), queryFn: ({ signal }) => purchasesApi.detail(uuid, purchaseUuid, signal), enabled: customer.isSuccess, retry: false })
  const back = <Link to={`/customers/${uuid}`} className="text-sm font-medium text-ink underline underline-offset-4">Back to customer</Link>
  if (customer.isPending || (customer.isSuccess && purchase.isPending)) return <LoadingState label="Loading purchase details…" />
  if (customer.isError) return <div className="space-y-5"><Link to="/customers" className="text-sm text-ink underline">Back to customers</Link><ErrorState title="Customer could not be loaded" description={customerErrorMessage(customer.error)} onRetry={() => void customer.refetch()} /></div>
  if (purchase.isError) return <div className="space-y-5">{back}<ErrorState title={purchase.error instanceof ApiError && purchase.error.status === 404 ? 'Purchase not found' : 'Purchase could not be loaded'} description={purchaseErrorMessage(purchase.error)} onRetry={() => void purchase.refetch()} /></div>
  if (!purchase.data) return <LoadingState label="Loading purchase details…" />
  const record = purchase.data
  const notice = typeof location.state?.purchaseNotice === 'string' ? location.state.purchaseNotice : ''
  return <div className="space-y-7 [overflow-wrap:anywhere]">{back}
    <PageHeader eyebrow={`Purchase · ${customer.data.name}`} title="Purchase details" description="A permanent record of the items and prices at the time of purchase. Saved purchases cannot be edited or deleted." />
    {notice ? <p className="rounded-md border border-line bg-white px-4 py-3 text-sm text-ink" role="status">{notice}</p> : null}
    <Card><CardHeader><CardTitle>Recorded purchase</CardTitle></CardHeader><CardContent><dl className="space-y-4 text-sm sm:grid sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-x-6 sm:gap-y-4 sm:space-y-0">
      <dt className="text-muted">Purchase UUID</dt><dd className="font-mono text-xs leading-6 text-ink">{record.uuid}</dd>
      <dt className="text-muted">Customer</dt><dd className="text-ink">{customer.data.name}</dd>
      <dt className="text-muted">Purchase date</dt><dd className="text-ink"><time dateTime={record.purchase_date}>{prescriptionDate(record.purchase_date)}</time></dd>
      <dt className="text-muted">Linked prescription</dt><dd>{record.prescription_uuid ? <Link to={`/customers/${uuid}/prescriptions/${record.prescription_uuid}`} className="text-ink underline underline-offset-4">View linked prescription <span className="block font-mono text-xs leading-6">{record.prescription_uuid}</span></Link> : <span className="text-muted">No prescription linked</span>}</dd>
      <dt className="text-muted">Recorded at</dt><dd className="text-ink">{customerDate(record.created_at, true)}</dd>
      <dt className="text-muted">Last updated</dt><dd className="text-ink">{customerDate(record.updated_at, true)}</dd>
    </dl></CardContent></Card>
    <Card><CardHeader><CardTitle>Purchase items</CardTitle></CardHeader><CardContent>
      <ul className="divide-y divide-line" aria-label="Purchase items">{record.items.map((item, index) => <li key={item.uuid} className="space-y-4 py-5 first:pt-0">
        <h3 className="text-sm font-semibold text-ink">{index + 1}. {item.description}</h3><p className="text-xs text-muted">{categoryLabel(item.product_category)}</p>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">{[['Quantity', String(item.quantity)], ['Unit price', purchaseMoney(item.unit_price_paise)], ['Line discount', purchaseMoney(item.discount_paise)], ['Line total', purchaseMoney(item.line_total_paise)]].map(([label, value]) => <div key={label}><dt className="text-muted">{label}</dt><dd className="mt-1 font-medium tabular-nums text-ink">{value}</dd></div>)}</dl>
      </li>)}</ul>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Purchase totals</CardTitle></CardHeader><CardContent><dl className="space-y-4 text-sm tabular-nums">
      <div className="flex justify-between gap-4"><dt className="text-muted">Subtotal</dt><dd>{purchaseMoney(record.subtotal_paise)}</dd></div>
      <div className="flex justify-between gap-4"><dt className="text-muted">Discount (all items and purchase)</dt><dd>{purchaseMoney(record.discount_paise)}</dd></div>
      {record.tax_paise ? <div className="flex justify-between gap-4"><dt className="text-muted">Recorded legacy tax</dt><dd>{purchaseMoney(record.tax_paise)}</dd></div> : null}
      <div className="flex justify-between gap-4 border-t border-line pt-4 text-base font-semibold"><dt>Grand total</dt><dd data-testid="purchase-grand-total">{purchaseMoney(record.total_paise)}</dd></div>
    </dl><p className="mt-4 text-xs leading-5 text-muted">Totals are calculated by the server and shown in INR. Discounts are fixed rupee amounts.</p></CardContent></Card>
    <Card><CardHeader><CardTitle>Purchase notes</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm leading-6 text-muted">{record.notes ?? 'No purchase notes recorded.'}</p></CardContent></Card>
  </div>
}
