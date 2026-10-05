import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../components/ui/States'
import { purchaseMoney } from '../lib/purchases'
import { reportErrorMessage, reportsApi } from '../lib/reports'

export function DashboardPage() {
  const dashboard = useQuery({ queryKey: ['reports', 'dashboard'], queryFn: reportsApi.dashboard, staleTime: 0, retry: false })
  const data = dashboard.data
  return <div className="space-y-7">
    <PageHeader eyebrow="Shop overview" title="Dashboard" description="Today’s business activity and current customer credit, calculated from saved records." actions={<Button variant="secondary" loading={dashboard.isFetching} onClick={() => void dashboard.refetch()}>Refresh overview</Button>} />
    {dashboard.isPending ? <LoadingState label="Loading shop overview…" /> : dashboard.isError ? <ErrorState title="Overview could not be loaded" description={reportErrorMessage(dashboard.error)} onRetry={() => void dashboard.refetch()} /> : data ? <>
      <p className="text-sm text-muted">Business day <time>{data.businessDate}</time> · {data.timeZone} (IST). Credit and customer counts include all dates.</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          ['Today’s sales', purchaseMoney(data.sales.total_paise), '/reports?report=sales', 'dashboard-sales'],
          ['Today’s collections', purchaseMoney(data.payments.total_paise), '/reports?report=payments', 'dashboard-payments'],
          ['Today’s purchases', String(data.sales.purchase_count), '/reports?report=sales', 'dashboard-purchases'],
          ['Current outstanding', purchaseMoney(data.outstanding.outstanding_paise), '/reports?report=outstanding', 'dashboard-outstanding'],
          ['Customers', String(data.customers.customer_count), '/reports?report=customers', 'dashboard-customers'],
          ['Customers with debt', String(data.outstanding.customer_count), '/reports?report=outstanding', 'dashboard-debtors'],
        ].map(([label, value, to, id]) => <Card key={id}><CardContent><p className="text-sm text-muted">{label}</p><p className="mt-3 break-words text-2xl font-semibold tracking-tight tabular-nums" data-testid={id}>{value}</p><Link className="mt-4 inline-flex text-sm underline underline-offset-4" to={to}>View report</Link></CardContent></Card>)}
      </div>
      <Card><CardHeader><CardTitle>Collections and customer status</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted">
        <p>Cash {purchaseMoney(data.payments.cash_paise)} · UPI {purchaseMoney(data.payments.upi_paise)} · Card {purchaseMoney(data.payments.card_paise)}</p>
        {data.payments.legacy_other_paise > 0 ? <p>Other retained legacy methods: {purchaseMoney(data.payments.legacy_other_paise)}</p> : null}
        <p>{data.customers.active_count} active · {data.customers.archived_count} archived customers</p>
        <p>Sales include saved purchases even before invoice generation. Collections use payment received time; sales and collections can differ.</p>
      </CardContent></Card>
    </> : null}
  </div>
}
