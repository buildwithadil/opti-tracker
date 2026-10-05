import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { paymentMethodLabels, type PaymentMethod } from '../../shared/payments'
import { customerDate } from '../lib/customers'
import { paymentErrorMessage, paymentKeys, paymentsApi } from '../lib/payments'
import { purchaseMoney } from '../lib/purchases'
import { Button } from './ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import { ErrorState, LoadingState } from './ui/States'

export function PaymentHistory({ customerUuid, purchaseUuid }: { customerUuid: string; purchaseUuid: string }) {
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20)
  const query = { page, pageSize }
  const history = useQuery({ queryKey: paymentKeys.list(customerUuid, purchaseUuid, query), queryFn: ({ signal }) => paymentsApi.list(customerUuid, purchaseUuid, query, signal), retry: false })
  const pagination = history.data?.pagination
  return <Card><CardHeader><CardTitle>Payment history</CardTitle></CardHeader><CardContent className="space-y-5">
    <p className="text-sm leading-6 text-muted">Individual payment records, oldest payment time first. Recorded payments cannot be edited or deleted.</p>
    {history.isPending ? <LoadingState label="Loading payment history…" /> : history.isError ? <ErrorState title="Payment history could not be loaded" description={paymentErrorMessage(history.error)} onRetry={() => void history.refetch()} /> : <>
      {history.data.payments.length ? <ul className="divide-y divide-line" aria-label="Payment history">{history.data.payments.map(payment => <li key={payment.uuid} className="space-y-3 py-5 first:pt-0">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-ink">{paymentMethodLabels[payment.payment_method as PaymentMethod] ?? payment.payment_method}</p><time className="mt-1 block text-xs text-muted" dateTime={payment.received_at}>{customerDate(payment.received_at, true)}</time></div><p className="text-sm font-semibold tabular-nums text-ink">{purchaseMoney(payment.amount_paise)}</p></div>
        {payment.status !== 'settled' ? <p className="text-xs text-muted">Legacy status: {payment.status}</p> : null}
        {payment.reference ? <p className="text-sm text-muted [overflow-wrap:anywhere]">Reference: {payment.reference}</p> : null}
        {payment.notes ? <p className="whitespace-pre-wrap text-sm leading-6 text-muted [overflow-wrap:anywhere]">{payment.notes}</p> : null}
        <p className="font-mono text-xs leading-5 text-muted [overflow-wrap:anywhere]">{payment.uuid}</p>
      </li>)}</ul> : <div className="rounded-md border border-line bg-paper px-4 py-8 text-center"><h3 className="text-base font-semibold text-ink">No payments yet</h3><p className="mt-2 text-sm leading-6 text-muted">Recorded payments for this purchase will appear here.</p></div>}
      <nav className="flex flex-col gap-4 border-t border-line pt-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between" aria-label="Payment history pagination"><p className="text-xs text-muted">{pagination?.total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, pagination.total)} of ${pagination.total} payments` : '0 payments'} · Page {page} of {pagination?.totalPages ?? 1}</p><div className="flex flex-wrap items-center gap-2"><label className="text-xs text-muted">Per page <select className="ml-1 h-9 rounded-md border border-line bg-white px-2 text-sm text-ink" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option></select></label><Button size="sm" variant="secondary" disabled={page <= 1 || history.isFetching} onClick={() => setPage(value => value - 1)}>Previous</Button><Button size="sm" variant="secondary" disabled={page >= Math.min(pagination?.totalPages ?? 1, 10000) || history.isFetching} onClick={() => setPage(value => value + 1)}>Next</Button></div></nav>
    </>}
  </CardContent></Card>
}
