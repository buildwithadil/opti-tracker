import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Download } from 'lucide-react'
import { REPORT_EXPORT_ROWS, reportLabels, reportNames, type ReportName, type ReportResult, type ReportRow } from '../../shared/reports'
import { REPORT_TIME_ZONE, reportPresetRange, reportPresets, reportRangeSchema, type ReportPreset, type ReportRange } from '../../shared/reportDates'
import { Button } from '../components/ui/Button'
import { Field, TextInput } from '../components/ui/Field'
import { PageHeader } from '../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../components/ui/States'
import { purchaseMoney } from '../lib/purchases'
import { reportErrorMessage, reportsApi, type ReportQuery } from '../lib/reports'

const selectClass = 'h-11 w-full rounded-md border border-line bg-white px-3 text-sm'
const money = (key: string, value: string | number | null) => key.endsWith('_paise') ? purchaseMoney(value as number) : value === null ? '—' : key === 'has_purchase' ? value ? 'Yes' : 'No' : String(value)
const columns: Record<ReportName, [string, string][]> = {
  sales: [['purchase_date','Purchase date'],['customer_name','Customer'],['invoice_number','Invoice'],['total_paise','Grand total'],['amount_paid_paise','Paid to date'],['outstanding_paise','Outstanding to date']],
  payments: [['business_date','Business date'],['customer_name','Customer'],['received_at','Received at (UTC)'],['payment_method','Method'],['amount_paise','Amount']],
  outstanding: [['customer_name','Customer'],['customer_phone','Phone'],['customer_status','Status'],['purchase_count','Outstanding purchases'],['outstanding_paise','Current outstanding']],
  customers: [['customer_name','Customer'],['customer_phone','Phone'],['customer_status','Status'],['has_purchase','Has purchases'],['outstanding_paise','Current outstanding']],
  categories: [['category_label','Category snapshot'],['line_count','Line items'],['quantity','Quantity'],['sales_paise','Line sales']],
}
const summaryLabels: Record<string, string> = { purchase_count: 'Purchases', subtotal_paise: 'Gross sales', discount_paise: 'Discounts', tax_paise: 'Persisted tax', total_paise: 'Grand total', amount_paid_paise: 'Paid to date', outstanding_paise: 'Current outstanding', payment_count: 'Transactions', cash_paise: 'Cash', upi_paise: 'UPI', card_paise: 'Card', legacy_other_paise: 'Other legacy methods', customer_count: 'Customers', active_count: 'Active', archived_count: 'Archived', with_purchases_count: 'With purchases', with_outstanding_count: 'With outstanding', line_count: 'Line items', quantity: 'Quantity', sales_paise: 'Line sales' }
function DateFilters({ range, onApply }: { range: ReportRange; onApply: (range: ReportRange) => void }) {
  const [draft, setDraft] = useState(range), [preset, setPreset] = useState<ReportPreset>('Custom'), [error, setError] = useState('')
  return <form className="space-y-4" onSubmit={event => {
    event.preventDefault()
    const parsed = reportRangeSchema.safeParse(draft)
    if (!parsed.success) { setError(parsed.error.issues[0].message); return }
    setError(''); onApply(parsed.data)
  }}>
    <div className="grid gap-4 sm:grid-cols-3">
      <Field id="report-preset" label="Date preset"><select id="report-preset" className={selectClass} value={preset} onChange={event => {
        const value = event.target.value as ReportPreset; setPreset(value); setError('')
        if (value !== 'Custom') setDraft(reportPresetRange(value))
      }}>{reportPresets.map(value => <option key={value}>{value}</option>)}</select></Field>
      <Field id="report-from" label="Start date"><TextInput id="report-from" type="date" required value={draft.dateFrom} onChange={event => { setPreset('Custom'); setDraft({ ...draft, dateFrom: event.target.value }) }} /></Field>
      <Field id="report-to" label="End date"><TextInput id="report-to" type="date" required value={draft.dateTo} onChange={event => { setPreset('Custom'); setDraft({ ...draft, dateTo: event.target.value }) }} /></Field>
    </div>
    <div className="flex flex-wrap items-center gap-3"><Button type="submit" variant="secondary">Apply dates</Button><p className="text-xs text-muted">Inclusive dates · {REPORT_TIME_ZONE} (IST) · maximum 366 days</p></div>
    {error ? <p role="alert" className="text-sm text-accent">{error}</p> : null}
  </form>
}
function ResultCell({ row, name, column }: { row: ReportRow; name: ReportName; column: string }) {
  if (column === 'customer_name') return <Link className="underline underline-offset-4 [overflow-wrap:anywhere]" to={name === 'sales' || name === 'payments' ? `/customers/${row.customer_uuid}/purchases/${row.purchase_uuid}` : `/customers/${row.customer_uuid}`}>{row.customer_name}</Link>
  return <>{money(column, row[column])}</>
}
function Results({ result }: { result: ReportResult }) {
  const fields = columns[result.report]
  return <>
    <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><caption className="sr-only">{reportLabels[result.report]} report details</caption><thead className="border-b border-line bg-paper"><tr>{fields.map(([key, label]) => <th key={key} scope="col" className="px-5 py-3 text-xs font-medium text-muted">{label}</th>)}</tr></thead><tbody className="divide-y divide-line">{result.rows.map((row, i) => <tr key={i}>{fields.map(([key]) => <td key={key} className="max-w-64 px-5 py-4 tabular-nums [overflow-wrap:anywhere]"><ResultCell row={row} name={result.report} column={key} /></td>)}</tr>)}</tbody></table></div>
    <ul className="divide-y divide-line md:hidden" aria-label={`${reportLabels[result.report]} report details`}>{result.rows.map((row, i) => <li key={i} className="p-5"><dl className="space-y-3">{fields.map(([key, label]) => <div key={key} className="flex items-start justify-between gap-4 text-sm"><dt className="shrink-0 text-muted">{label}</dt><dd className="min-w-0 text-right tabular-nums [overflow-wrap:anywhere]"><ResultCell row={row} name={result.report} column={key} /></dd></div>)}</dl></li>)}</ul>
  </>
}
export function ReportsPage() {
  const [params, setParams] = useSearchParams()
  const name = reportNames.find(value => value === params.get('report')) ?? 'sales'
  const activity = name === 'sales' || name === 'payments' || name === 'categories'
  const fallback = reportPresetRange('Today')
  const range = { dateFrom: params.get('dateFrom') ?? fallback.dateFrom, dateTo: params.get('dateTo') ?? fallback.dateTo }
  const validRange = reportRangeSchema.safeParse(range)
  const pageNumber = (key: string, fallback: number, max: number) => { const value = params.get(key); return value && /^[1-9][0-9]*$/u.test(value) && Number(value) <= max ? Number(value) : fallback }
  const query: ReportQuery = { range: activity ? range : null, page: pageNumber('page', 1, 10000), pageSize: pageNumber('pageSize', 20, 50) }
  const report = useQuery({ queryKey: ['reports', name, query], queryFn: ({ signal }) => reportsApi.report(name, query, signal), enabled: !activity || validRange.success, staleTime: 0, retry: false })
  const [downloading, setDownloading] = useState(false), [downloadError, setDownloadError] = useState('')
  const downloadLock = useRef(false)
  const update = (updates: Record<string, string>) => { const next = new URLSearchParams(params); next.set('page','1'); Object.entries(updates).forEach(([key, value]) => next.set(key,value)); setDownloadError(''); setParams(next) }
  const data = report.data
  const lastPage = Math.min(data?.pagination.totalPages ?? 1,10000)
  useEffect(() => {
    if (report.isSuccess && query.page > lastPage) {
      const next = new URLSearchParams(params); next.set('page',String(lastPage)); setParams(next,{ replace: true })
    }
  },[report.isSuccess,query.page,lastPage,params,setParams])
    return <div className="space-y-7">
    <PageHeader title="Reports" description="Sales, collections, balances, and exports." actions={<Button variant="ghost" loading={report.isFetching} disabled={activity && !validRange.success} onClick={() => void report.refetch()}>Refresh</Button>} />
     <section className="space-y-5 border-y border-line py-5"><Field id="report-kind" label="Report"><select id="report-kind" className={selectClass} value={name} onChange={event => update({ report: event.target.value })}>{reportNames.map(value => <option key={value} value={value}>{reportLabels[value]}</option>)}</select></Field>
      {activity ? <DateFilters key={`${range.dateFrom}-${range.dateTo}`} range={range} onApply={value => update(value)} /> : <p className="text-sm leading-6 text-muted">Current position across all dates. Archived customers retain their debts; fully paid and zero-total purchases are excluded from outstanding credit. Date filters do not apply to this report.</p>}
     </section>
    {activity && !validRange.success ? <ErrorState title="Check the report dates" description={validRange.error.issues[0].message} /> : report.isPending ? <LoadingState label="Loading report…" /> : report.isError ? <ErrorState title="Report could not be loaded" description={reportErrorMessage(report.error)} onRetry={() => void report.refetch()} /> : data ? <>
       <section aria-label="Report summary"><h2 className="mb-3 text-base font-semibold">{reportLabels[name]} summary</h2><dl className="grid gap-5 border-y border-line py-5 sm:grid-cols-2 xl:grid-cols-4">{Object.entries(data.summary).map(([key, value]) => <div key={key}><dt className="text-xs text-muted">{name === 'payments' && key === 'total_paise' ? 'Collections' : name === 'sales' && key === 'outstanding_paise' ? 'Outstanding to date' : summaryLabels[key] ?? key}</dt><dd data-testid={`report-${key}`} className="mt-1 break-words text-lg font-semibold tabular-nums">{money(key, value)}</dd></div>)}</dl></section>
      <p className="text-xs text-muted">{activity ? `Dates use ${REPORT_TIME_ZONE} (IST).` : 'Current balances across all saved records.'}</p>
       <section className="border-y border-line bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-5"><h2 className="text-sm font-semibold">{reportLabels[name]} details</h2>{name !== 'customers' ? <Button size="sm" variant="secondary" loading={downloading} disabled={data.pagination.total > REPORT_EXPORT_ROWS} icon={<Download className="size-4" aria-hidden="true" />} onClick={() => {
        if (downloadLock.current) return
        downloadLock.current = true; setDownloading(true); setDownloadError('')
        void reportsApi.download(name, query).catch(error => setDownloadError(reportErrorMessage(error))).finally(() => { downloadLock.current = false; setDownloading(false) })
      }}>Download CSV</Button> : null}</div>
        {downloadError ? <p role="alert" className="px-5 pt-4 text-sm text-accent">{downloadError}</p> : null}
        {name !== 'customers' && data.pagination.total > REPORT_EXPORT_ROWS ? <p className="px-5 pt-4 text-sm text-muted">CSV limit: 5,000 rows. Narrow the date range where available or browse the paginated report.</p> : null}
        {data.rows.length ? <Results result={data} /> : <div className="px-5 py-12 text-center"><h3 className="font-semibold">No matching records</h3><p className="mt-2 text-sm text-muted">{activity ? 'Choose different dates to view saved activity.' : 'Saved records will appear here when applicable.'}</p></div>}
        <nav aria-label="Report pagination" className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-5 py-4"><p className="text-xs text-muted">{data.pagination.total} rows · Page {query.page} of {data.pagination.totalPages}</p><div className="flex items-center gap-2"><label htmlFor="report-page-size" className="sr-only">Rows per page</label><select id="report-page-size" className="h-9 rounded-md border border-line bg-white px-2 text-xs" value={query.pageSize} onChange={event => update({ pageSize: event.target.value })}>{Array.from(new Set([10,20,50,query.pageSize])).sort((a,b) => a-b).map(size => <option key={size} value={size}>{size} rows</option>)}</select><Button size="sm" variant="secondary" disabled={query.page <= 1} onClick={() => update({ page: String(query.page-1) })}>Previous</Button><Button size="sm" variant="secondary" disabled={query.page >= Math.min(data.pagination.totalPages,10000)} onClick={() => update({ page: String(query.page+1) })}>Next</Button></div></nav>
        {data.pagination.totalPages>10000 ? <p className="px-5 pb-4 text-xs text-muted">The first 10,000 pages are available. Narrow the date range where applicable.</p> : null}
       </section>
       {data.daily?.length ? <section className="border-y border-line py-5"><h2 className="mb-4 text-sm font-semibold">Collections by business day (IST)</h2><ul className="divide-y divide-line">{data.daily.map(row => <li key={row.business_date} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span>{row.business_date} · {row.payment_count} transactions</span><span className="font-medium tabular-nums">{purchaseMoney(row.total_paise as number)}</span></li>)}</ul></section> : null}
    </> : null}
  </div>
}
