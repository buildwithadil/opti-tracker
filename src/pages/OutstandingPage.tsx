import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportsApi } from '../lib/reports'
import { purchaseMoney } from '../lib/purchases'
import { PageHeader } from '../components/ui/PageHeader'
import { ActionLink, EmptyState, Pagination } from '../components/ui/ShopUI'
import { ErrorState, LoadingState } from '../components/ui/States'

export function OutstandingPage() {
  const [page, setPage] = useState(1)
  const query = { range: null, page, pageSize: 20 }
  const debts = useQuery({ queryKey: ['reports', 'outstanding', query], queryFn: ({ signal }) => reportsApi.report('outstanding', query, signal), staleTime: 0, retry: false })
  return <div className="space-y-8"><PageHeader title="Outstanding" description="Who needs a follow-up." actions={<ActionLink secondary to="/receive-payment">Find customer</ActionLink>} />{debts.isPending ? <LoadingState label="Loading outstanding balances…" /> : debts.isError ? <ErrorState description={debts.error.message} onRetry={() => void debts.refetch()} /> : <><section className="border-y border-line py-5"><p className="text-sm text-muted">Total outstanding</p><p className="mt-1 text-[32px] font-semibold tracking-tight tabular-nums" data-testid="outstanding-total">{purchaseMoney(debts.data.summary.outstanding_paise)}</p><p className="mt-1 text-sm text-muted">Across {debts.data.summary.customer_count} customers</p></section>{debts.data.rows.length ? <ul aria-label="Outstanding customers" className="hairline-list border-y border-line bg-white">{debts.data.rows.map(row => <li key={row.customer_uuid} className="flex items-center justify-between gap-4 px-4 py-4 sm:px-5"><div className="min-w-0"><p className="break-words font-semibold">{row.customer_name}</p><p className="mt-1 text-sm font-medium tabular-nums text-muted">{purchaseMoney(row.outstanding_paise as number)} due</p></div>{row.customer_status === 'Archived' ? <ActionLink quiet to={`/customers/${row.customer_uuid}`}>Open customer</ActionLink> : <ActionLink quiet to={`/receive-payment?customer=${row.customer_uuid}`}>Collect</ActionLink>}</li>)}</ul> : <EmptyState title="No outstanding balances" description="All customer balances are settled." />}<Pagination label="Outstanding pagination" page={page} pagination={debts.data.pagination} onPage={setPage} busy={debts.isFetching} /></>}</div>
}
