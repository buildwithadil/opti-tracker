import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { paymentMethodLabels, type PaymentMethod } from '../../shared/payments'
import { shopApi } from '../lib/shop'
import { customerDate } from '../lib/customers'
import { purchaseMoney } from '../lib/purchases'
import { Card, CardContent } from './ui/Card'
import { ActionLink, EmptyState, Pagination } from './ui/ShopUI'
import { ErrorState, LoadingState } from './ui/States'

export function ShopPaymentHistory({ customer }: { customer?: string }) {
  const [page,setPage]=useState(1), query={ customer_uuid: customer,page,pageSize: 20 }
  const receipts=useQuery({ queryKey: ['shop','receipts',query],queryFn: ({ signal })=>shopApi.payments(query,signal),staleTime: 0,retry: false })
  return <div className="space-y-4">{receipts.isPending ? <LoadingState label="Loading payment history…" /> : receipts.isError ? <ErrorState description={receipts.error.message} onRetry={()=>void receipts.refetch()} /> : <>{receipts.data.payments.length ? <ul aria-label="Customer payment receipts" className="grid gap-3 md:grid-cols-2">{receipts.data.payments.map(payment=><li key={payment.uuid}><Card><CardContent className="space-y-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-semibold">{payment.customer_name}</p><p className="text-sm text-muted">{paymentMethodLabels[payment.payment_method as PaymentMethod] ?? payment.payment_method} · {payment.invoice_number || 'Sale receipt'}</p></div><p className="font-semibold tabular-nums">{purchaseMoney(payment.amount_paise)}</p></div><time className="text-xs text-muted" dateTime={payment.received_at}>{customerDate(payment.received_at,true)}</time>{payment.status!=='settled' ? <p className="text-sm">Legacy status: {payment.status}</p> : null}{payment.reference || payment.notes ? <details><summary className="cursor-pointer text-sm text-muted">Receipt details</summary>{payment.reference ? <p className="mt-2 break-words text-sm">Reference: {payment.reference}</p> : null}{payment.notes ? <p className="mt-2 whitespace-pre-wrap break-words text-sm">{payment.notes}</p> : null}</details> : null}<ActionLink secondary to={`/customers/${payment.customer_uuid}/purchases/${payment.purchase_uuid}`}>View sale</ActionLink></CardContent></Card></li>)}</ul> : <EmptyState title="No payments yet" description="Received payments will appear here." />}<Pagination label="Customer payment receipts pagination" page={page} pagination={receipts.data.pagination} onPage={setPage} /></>}</div>
}
