import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import type { Customer } from '../../shared/customers'
import { purchaseCategories, purchaseCategoryLabels, type PurchaseCategory } from '../../shared/purchases'
import { purchaseListSchema } from '../../shared/purchaseValidation'
import { prescriptionDate } from '../lib/prescriptions'
import { purchaseErrorMessage, purchaseKeys, purchaseMoney, purchasesApi } from '../lib/purchases'
import { Button } from './ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import { Field, TextInput } from './ui/Field'
import { ErrorState, LoadingState } from './ui/States'

export function PurchaseHistory({ customer }: { customer: Customer }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [category, setCategory] = useState<PurchaseCategory | ''>('')
  const query = { page, pageSize, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, category: category || undefined }
  const valid = purchaseListSchema.safeParse({ ...query, page: String(page), pageSize: String(pageSize) })
  const history = useQuery({ queryKey: purchaseKeys.list(customer.uuid, query), queryFn: ({ signal }) => purchasesApi.list(customer.uuid, query, signal), enabled: valid.success, retry: false })
  const pagination = history.data?.pagination
  const lastPage = Math.min(pagination?.totalPages ?? 1, 10000)
  const filtered = !!(dateFrom || dateTo || category)
  return <Card>
    <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>Purchase history</CardTitle>
      {!customer.archived_at ? <Link to={`/customers/${customer.uuid}/purchases/new`} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-white hover:bg-ink/90"><Plus className="size-4" aria-hidden="true" />Add purchase</Link> : null}
    </div></CardHeader>
    <CardContent className="space-y-5">
      <p className="text-sm leading-6 text-muted">Recorded purchases, newest purchase date first. Each purchase retains its original item descriptions and prices.</p>
      {customer.archived_at ? <p className="rounded-md border border-line bg-paper p-3 text-sm leading-6 text-muted">This customer is archived. Purchase history remains readable; restore the customer before adding a purchase.</p> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="purchase-date-from" label="Purchases from"><TextInput id="purchase-date-from" type="date" value={dateFrom} onChange={event => { setDateFrom(event.target.value); setPage(1) }} /></Field>
        <Field id="purchase-date-to" label="Purchases to"><TextInput id="purchase-date-to" type="date" value={dateTo} onChange={event => { setDateTo(event.target.value); setPage(1) }} /></Field>
        <Field id="purchase-category-filter" label="Purchase category"><select id="purchase-category-filter" className="h-11 w-full rounded-md border border-line bg-white px-3 text-sm text-ink" value={category} onChange={event => { setCategory(event.target.value as PurchaseCategory | ''); setPage(1) }}><option value="">All categories</option>{purchaseCategories.map(value => <option key={value} value={value}>{purchaseCategoryLabels[value]}</option>)}</select></Field>
      </div>
      {filtered ? <Button variant="secondary" size="sm" onClick={() => { setDateFrom(''); setDateTo(''); setCategory(''); setPage(1) }}>Clear purchase filters</Button> : null}
      {!valid.success ? <p className="text-sm text-red-700" role="alert">{valid.error.issues[0].message}</p> : history.isPending ? <LoadingState label="Loading purchases…" /> : history.isError ? <ErrorState title="Purchase history could not be loaded" description={purchaseErrorMessage(history.error)} onRetry={() => void history.refetch()} /> : history.isSuccess ? <>
        {history.data.purchases.length ? <ul className="divide-y divide-line" aria-label="Purchase history">{history.data.purchases.map(record => <li key={record.uuid} className="flex flex-wrap items-center justify-between gap-4 py-5 first:pt-0">
          <div className="min-w-0 space-y-2"><p className="text-sm font-semibold text-ink">Purchase date: <time dateTime={record.purchase_date}>{prescriptionDate(record.purchase_date)}</time></p><p className="text-sm text-muted">Grand total: <span className="font-medium tabular-nums text-ink">{purchaseMoney(record.total_paise)}</span></p></div>
          <Link to={`/customers/${customer.uuid}/purchases/${record.uuid}`} className="text-sm font-medium text-ink underline underline-offset-4" aria-label={`View purchase details, ${prescriptionDate(record.purchase_date)}, ${record.uuid}`}>View purchase details</Link>
        </li>)}</ul> : <div className="rounded-md border border-line bg-paper px-4 py-8 text-center"><h3 className="text-base font-semibold text-ink">{filtered ? 'No matching purchases' : 'No purchases yet'}</h3><p className="mt-2 text-sm leading-6 text-muted">{filtered ? 'Adjust the dates or category to view more history.' : customer.archived_at ? 'There are no recorded purchases for this archived customer.' : 'Add the first purchase for this customer.'}</p></div>}
        <nav className="flex flex-col gap-4 border-t border-line pt-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between" aria-label="Purchase history pagination">
          <p className="text-xs leading-5 text-muted" role="status">{pagination?.total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, pagination.total)} of ${pagination.total} purchases` : '0 purchases'} · Page {page} of {pagination?.totalPages ?? 1}</p>
          <div className="flex flex-wrap items-center gap-2"><label className="text-xs text-muted">Per page <select className="ml-1 h-9 rounded-md border border-line bg-white px-2 text-sm text-ink" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option></select></label>
            <Button size="sm" variant="secondary" disabled={page <= 1 || history.isFetching} onClick={() => setPage(value => value - 1)} icon={<ChevronLeft className="size-4" aria-hidden="true" />}>Previous</Button>
            <Button size="sm" variant="secondary" disabled={page >= lastPage || history.isFetching} onClick={() => setPage(value => value + 1)}>Next<ChevronRight className="size-4" aria-hidden="true" /></Button></div>
        </nav>
        {(pagination?.totalPages ?? 1) > 10000 ? <p className="text-xs text-muted">Up to 10,000 pages are available. Use date filters or 50 purchases per page to access more history.</p> : null}
      </> : null}
    </CardContent>
  </Card>
}
