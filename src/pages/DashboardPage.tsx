import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../components/ui/States'
import { ActionLink, EmptyState, NewSaleLink } from '../components/ui/ShopUI'
import { SaleCard } from '../components/SaleCard'
import { purchaseMoney } from '../lib/purchases'
import { reportErrorMessage, reportsApi } from '../lib/reports'
import { shopApi } from '../lib/shop'
import { invoiceKeys, invoicesApi } from '../lib/invoices'
import { List, ListRow, Section } from '../components/ui/AppleUI'

export function DashboardPage() {
  const dashboard=useQuery({ queryKey: ['reports','dashboard'],queryFn: reportsApi.dashboard,staleTime: 0,retry: false })
  const recent=useQuery({ queryKey: ['shop','recent-sales'],queryFn: ({ signal })=>shopApi.sales({ pageSize: 5 },signal),staleTime: 0,retry: false })
  const due=useQuery({ queryKey: ['reports','home-outstanding'],queryFn: ({ signal })=>reportsApi.report('outstanding',{ range: null,page: 1,pageSize: 3 },signal),staleTime: 0,retry: false })
  const identity=useQuery({ queryKey: invoiceKeys.identity,queryFn: ({ signal })=>invoicesApi.identity(signal),staleTime: 0,retry: false })
  const data=dashboard.data
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  return <div className="space-y-8 sm:space-y-10">
     <PageHeader eyebrow={greeting} title="Home" actions={<Button variant="ghost" size="sm" loading={dashboard.isFetching} onClick={()=>{ void dashboard.refetch(); void recent.refetch(); void due.refetch() }}>Refresh</Button>} />
    {dashboard.isPending ? <LoadingState label="Loading today…" /> : dashboard.isError ? <ErrorState title="Today could not be loaded" description={reportErrorMessage(dashboard.error)} onRetry={()=>void dashboard.refetch()} /> : data ? <section aria-label="Today" className="space-y-5">
       <div className="border-y border-line py-5"><Link to="/sales" className="block w-fit"><p className="text-sm text-muted">Today’s sales</p><p data-testid="dashboard-sales" className="mt-1 text-[38px] font-semibold tracking-[-0.04em] tabular-nums sm:text-[44px]">{purchaseMoney(data.sales.total_paise)}</p><p className="mt-1 text-xs text-muted"><span data-testid="dashboard-purchases">{data.sales.purchase_count}</span> sales · {new Date(`${data.businessDate}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · IST</p></Link></div>
       <div className="grid grid-cols-2 divide-x divide-line border-b border-line pb-5">
         <Link to="/payments/history" className="min-w-0 pr-4"><p className="text-sm text-muted">Collected</p><p data-testid="dashboard-payments" className="mt-1 text-xl font-semibold tabular-nums">{purchaseMoney(data.payments.total_paise)}</p></Link>
         <Link to="/outstanding" className="min-w-0 pl-4"><p className="text-sm text-muted">Outstanding</p><p data-testid="dashboard-outstanding" className="mt-1 text-xl font-semibold tabular-nums">{purchaseMoney(data.outstanding.outstanding_paise)}</p></Link>
       </div>
      <span className="sr-only"><span data-testid="dashboard-customers">{data.customers.customer_count}</span> customers · <span data-testid="dashboard-debtors">{data.outstanding.customer_count}</span> with a balance</span>
    </section> : null}
     <section aria-label="Quick actions" className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line pb-5"><NewSaleLink className="sm:min-h-11" /><ActionLink aria-label="Receive Payment" quiet to="/receive-payment">Receive payment</ActionLink><ActionLink quiet to="/customers/new">Add customer</ActionLink></section>
    {identity.data && (!identity.data.shop_name.trim() || !identity.data.address.trim() || !identity.data.contact_number.trim()) ? <section className="border-y border-line py-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">Finish setting up invoices</h2><p className="mt-1 text-sm text-muted">Add your shop name, address and contact once.</p></div><ActionLink secondary to="/settings">Open settings</ActionLink></div></section> : null}
     <Section title="Recent sales" action={<Link className="text-sm font-medium text-accent" to="/sales">See all</Link>}>{recent.isPending ? <LoadingState label="Loading recent sales…" /> : recent.isError ? <ErrorState description={recent.error.message} onRetry={()=>void recent.refetch()} /> : recent.data.sales.length ? <List aria-label="Recent sales">{recent.data.sales.map(sale=><ListRow key={sale.uuid}><SaleCard sale={sale} /></ListRow>)}</List> : <EmptyState title="No sales yet" description="No sales yet" action={<NewSaleLink />} />}</Section>
     <Section title="Outstanding" action={<Link className="text-sm font-medium text-accent" to="/outstanding">See all</Link>}>{due.isPending ? <LoadingState label="Loading balances…" /> : due.isError ? <ErrorState description={due.error.message} onRetry={()=>void due.refetch()} /> : due.data.rows.length ? <List aria-label="Payments to collect">{due.data.rows.map(row=><ListRow key={row.customer_uuid} className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0"><p className="break-words font-semibold">{row.customer_name}</p><p className="mt-1 text-sm text-muted">{purchaseMoney(row.outstanding_paise as number)} due</p></div><ActionLink quiet to={row.customer_status==='Archived' ? `/customers/${row.customer_uuid}` : `/receive-payment?customer=${row.customer_uuid}`}>{row.customer_status==='Archived' ? 'Open customer' : 'Collect'}</ActionLink></ListRow>)}</List> : <EmptyState title="All caught up" description="No outstanding balances" />}</Section>
  </div>
}
