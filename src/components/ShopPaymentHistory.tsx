import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { paymentMethodLabels, type PaymentMethod } from '../../shared/payments'
import { shopApi } from '../lib/shop'
import { customerDate } from '../lib/customers'
import { purchaseMoney } from '../lib/purchases'
import { ActionLink, EmptyState, Pagination } from './ui/ShopUI'
import { ErrorState, LoadingState } from './ui/States'

export function ShopPaymentHistory({ customer }: { customer?: string }) {
  const [page, setPage] = useState(1)
  const query = { customer_uuid: customer, page, pageSize: 20 }
  const receipts = useQuery({ queryKey: ['shop', 'receipts', query], queryFn: ({ signal }) => shopApi.payments(query, signal), staleTime: 0, retry: false })
  return <div className="space-y-4">{receipts.isPending ? <LoadingState label="Loading payment history…" /> : receipts.isError ? <ErrorState description={receipts.error.message} onRetry={() => void receipts.refetch()} /> : <>{receipts.data.payments.length ? <ul aria-label="Customer payment receipts" className="hairline-list border-y border-line bg-white">{receipts.data.payments.map(payment => <li key={payment.uuid} className="px-5 py-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-semibold">{payment.customer_name}</p><p className="mt-1 text-sm text-muted">{paymentMethodLabels[payment.payment_method as PaymentMethod] ?? payment.payment_method} · {payment.invoice_number || 'Sale receipt'}</p></div><p className="font-semibold tabular-nums">{purchaseMoney(payment.amount_paise)}</p></div><time className="mt-1 block text-xs text-muted" dateTime={payment.received_at}>{customerDate(payment.received_at, true)}</time>{payment.status !== 'settled' ? <p className="mt-2 text-sm">Legacy status: {payment.status}</p> : null}{payment.reference || payment.notes ? <details className="mt-2"><summary className="cursor-pointer text-sm text-muted">Receipt details</summary>{payment.reference ? <p className="mt-2 break-words text-sm">Reference: {payment.reference}</p> : null}{payment.notes ? <p className="mt-2 whitespace-pre-wrap break-words text-sm">{payment.notes}</p> : null}</details> : null}<ActionLink secondary className="mt-2" to={`/customers/${payment.customer_uuid}/purchases/${payment.purchase_uuid}`}>View sale</ActionLink></li>)}</ul> : <EmptyState title="No payments yet" description="Received payments will appear here." />}<Pagination label="Customer payment receipts pagination" page={page} pagination={receipts.data.pagination} onPage={setPage} /></>}</div>
}
