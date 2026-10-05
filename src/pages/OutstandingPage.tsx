import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportsApi } from '../lib/reports'
import { purchaseMoney } from '../lib/purchases'
import { PageHeader } from '../components/ui/PageHeader'
import { ActionLink, EmptyState, Pagination } from '../components/ui/ShopUI'
import { ErrorState, LoadingState } from '../components/ui/States'

export function OutstandingPage() {
  const [page,setPage]=useState(1), query={ range: null,page,pageSize: 20 }
  const debts=useQuery({ queryKey: ['reports','outstanding',query],queryFn: ({ signal })=>reportsApi.report('outstanding',query,signal),staleTime: 0,retry: false })
  return <div className="space-y-8"><PageHeader title="Outstanding" description="Balances that still need collecting." actions={<ActionLink secondary to="/receive-payment">Find customer</ActionLink>} />{debts.isPending ? <LoadingState label="Loading outstanding balances…" /> : debts.isError ? <ErrorState description={debts.error.message} onRetry={()=>void debts.refetch()} /> : <><section className="border-y border-line bg-white px-5 py-6 sm:px-7"><p className="text-sm text-muted">Total outstanding</p><p className="mt-2 break-words text-3xl font-semibold tracking-tight tabular-nums" data-testid="outstanding-total">{purchaseMoney(debts.data.summary.outstanding_paise)}</p><p className="mt-2 text-sm text-muted">Across {debts.data.summary.customer_count} customers</p></section>{debts.data.rows.length ? <ul aria-label="Outstanding customers" className="hairline-list border-y border-line bg-white">{debts.data.rows.map(row=><li key={row.customer_uuid} className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7"><div className="min-w-0"><p className="break-words font-semibold">{row.customer_name}</p><p className="mt-1 text-sm text-muted">{row.customer_phone} · {row.purchase_count} sales</p>{row.customer_status==='Archived' ? <p className="mt-1 text-xs text-muted">Archived · restore before collecting</p> : null}</div><div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end"><p className="text-lg font-semibold tabular-nums">{purchaseMoney(row.outstanding_paise as number)}</p>{row.customer_status==='Archived' ? <ActionLink secondary to={`/customers/${row.customer_uuid}`}>Open customer</ActionLink> : <ActionLink secondary to={`/receive-payment?customer=${row.customer_uuid}`}>Receive payment</ActionLink>}</div></li>)}</ul> : <EmptyState title="No outstanding balances" description="All recorded customer balances are settled." />}<Pagination label="Outstanding pagination" page={page} pagination={debts.data.pagination} onPage={setPage} busy={debts.isFetching} /></>}
  </div>
}
