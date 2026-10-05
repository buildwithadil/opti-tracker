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

export function DashboardPage() {
  const dashboard=useQuery({ queryKey: ['reports','dashboard'],queryFn: reportsApi.dashboard,staleTime: 0,retry: false })
  const recent=useQuery({ queryKey: ['shop','recent-sales'],queryFn: ({ signal })=>shopApi.sales({ pageSize: 5 },signal),staleTime: 0,retry: false })
  const due=useQuery({ queryKey: ['reports','home-outstanding'],queryFn: ({ signal })=>reportsApi.report('outstanding',{ range: null,page: 1,pageSize: 3 },signal),staleTime: 0,retry: false })
  const identity=useQuery({ queryKey: invoiceKeys.identity,queryFn: ({ signal })=>invoicesApi.identity(signal),staleTime: 0,retry: false })
  const data=dashboard.data
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  return <div className="space-y-7 sm:space-y-9">
    <PageHeader eyebrow={greeting} title="Home" actions={<Button variant="ghost" size="sm" loading={dashboard.isFetching} onClick={()=>{ void dashboard.refetch(); void recent.refetch(); void due.refetch() }}>Refresh overview</Button>} />
    {dashboard.isPending ? <LoadingState label="Loading today…" /> : dashboard.isError ? <ErrorState title="Today could not be loaded" description={reportErrorMessage(dashboard.error)} onRetry={()=>void dashboard.refetch()} /> : data ? <section aria-label="Today" className="space-y-5">
      <Link to="/sales" className="block w-fit"><p className="text-sm text-muted">Today’s sales</p><p data-testid="dashboard-sales" className="mt-1 text-4xl font-semibold tracking-tight tabular-nums sm:text-[42px]">{purchaseMoney(data.sales.total_paise)}</p><p className="mt-1 text-xs text-muted"><span data-testid="dashboard-purchases">{data.sales.purchase_count}</span> sales · {new Date(`${data.businessDate}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · IST</p></Link>
      <div className="grid grid-cols-2 border-y border-line py-4">
        <Link to="/payments/history" className="min-w-0 pr-3"><p className="text-sm text-muted">Collected today</p><p data-testid="dashboard-payments" className="mt-1 text-xl font-semibold tabular-nums">{purchaseMoney(data.payments.total_paise)}</p></Link>
        <Link to="/outstanding" className="min-w-0 border-l border-line pl-4"><p className="text-sm text-muted">Outstanding</p><p data-testid="dashboard-outstanding" className="mt-1 text-xl font-semibold tabular-nums">{purchaseMoney(data.outstanding.outstanding_paise)}</p></Link>
      </div>
      <span className="sr-only"><span data-testid="dashboard-customers">{data.customers.customer_count}</span> customers · <span data-testid="dashboard-debtors">{data.outstanding.customer_count}</span> with a balance</span>
    </section> : null}
    <section aria-label="Quick actions" className="space-y-3"><h2 className="text-base font-semibold">Quick actions</h2><NewSaleLink className="w-full sm:min-h-12" /><div className="grid grid-cols-2 gap-2"><ActionLink aria-label="Receive Payment" secondary to="/receive-payment">Receive payment</ActionLink><ActionLink secondary to="/customers/new">Add customer</ActionLink></div></section>
    {identity.data && (!identity.data.shop_name.trim() || !identity.data.address.trim() || !identity.data.contact_number.trim()) ? <section className="border-y border-line py-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">Finish setting up invoices</h2><p className="mt-1 text-sm text-muted">Add your shop name, address and contact once.</p></div><ActionLink secondary to="/settings">Open settings</ActionLink></div></section> : null}
    <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Recent sales</h2><Link className="text-sm font-medium text-accent" to="/sales">See all</Link></div>{recent.isPending ? <LoadingState label="Loading recent sales…" /> : recent.isError ? <ErrorState description={recent.error.message} onRetry={()=>void recent.refetch()} /> : recent.data.sales.length ? <ul aria-label="Recent sales" className="hairline-list border-y border-line bg-white">{recent.data.sales.map(sale=><li key={sale.uuid}><SaleCard sale={sale} /></li>)}</ul> : <EmptyState title="No sales yet" description="Your latest sales will appear here." action={<NewSaleLink />} />}</section>
    <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Outstanding</h2><Link className="text-sm font-medium text-accent" to="/outstanding">See all</Link></div>{due.isPending ? <LoadingState label="Loading balances…" /> : due.isError ? <ErrorState description={due.error.message} onRetry={()=>void due.refetch()} /> : due.data.rows.length ? <ul aria-label="Payments to collect" className="hairline-list border-y border-line bg-white">{due.data.rows.map(row=><li key={row.customer_uuid} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div className="min-w-0"><p className="break-words font-semibold">{row.customer_name}</p><p className="mt-1 text-sm text-muted">{purchaseMoney(row.outstanding_paise as number)} due</p></div><ActionLink secondary to={row.customer_status==='Archived' ? `/customers/${row.customer_uuid}` : `/receive-payment?customer=${row.customer_uuid}`}>{row.customer_status==='Archived' ? 'Open customer' : 'Receive payment'}</ActionLink></li>)}</ul> : <EmptyState title="All caught up" description="No customer balances are outstanding." />}</section>
  </div>
}
