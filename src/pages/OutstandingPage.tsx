import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportsApi } from '../lib/reports'
import { purchaseMoney } from '../lib/purchases'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardContent } from '../components/ui/Card'
import { ActionLink, EmptyState, Pagination } from '../components/ui/ShopUI'
import { ErrorState, LoadingState } from '../components/ui/States'

export function OutstandingPage() {
  const [page,setPage]=useState(1), query={ range: null,page,pageSize: 20 }
  const debts=useQuery({ queryKey: ['reports','outstanding',query],queryFn: ({ signal })=>reportsApi.report('outstanding',query,signal),staleTime: 0,retry: false })
  return <div className="space-y-5"><PageHeader title="Outstanding" description="Money still due, across all dates." actions={<ActionLink secondary to="/receive-payment">Find customer to collect</ActionLink>} />{debts.isPending ? <LoadingState label="Loading outstanding balances…" /> : debts.isError ? <ErrorState description={debts.error.message} onRetry={()=>void debts.refetch()} /> : <><Card><CardContent><p className="text-sm text-muted">Total outstanding</p><p className="mt-2 break-words text-3xl font-semibold tabular-nums" data-testid="outstanding-total">{purchaseMoney(debts.data.summary.outstanding_paise)}</p><p className="mt-2 text-sm text-muted">{debts.data.summary.customer_count} customers</p></CardContent></Card>{debts.data.rows.length ? <ul aria-label="Outstanding customers" className="grid gap-3 md:grid-cols-2">{debts.data.rows.map(row=><li key={row.customer_uuid}><Card><CardContent className="space-y-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-semibold">{row.customer_name}</p><p className="text-sm text-muted">{row.customer_phone}</p></div><p className="text-lg font-semibold tabular-nums">{purchaseMoney(row.outstanding_paise as number)}</p></div><p className="text-sm text-muted">{row.purchase_count} sales with a balance</p>{row.customer_status==='Archived' ? <><p className="text-sm text-muted">Archived · restore before collecting</p><ActionLink secondary to={`/customers/${row.customer_uuid}`}>Open customer</ActionLink></> : <ActionLink secondary to={`/receive-payment?customer=${row.customer_uuid}`}>Receive Payment</ActionLink>}</CardContent></Card></li>)}</ul> : <EmptyState title="No outstanding balances" description="All recorded customer balances are settled." />}<Pagination label="Outstanding pagination" page={page} pagination={debts.data.pagination} onPage={setPage} busy={debts.isFetching} /></>}
  </div>
}
