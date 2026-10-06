import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react'
import type { CustomerListQuery } from '../../shared/customers'
import type { ShopCustomer } from '../../shared/shop'
import { formatIndianMobile } from '../../shared/phone'
import { Button } from '../components/ui/Button'
import { TextInput } from '../components/ui/Field'
import { PageHeader } from '../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../components/ui/States'
import { customerErrorMessage } from '../lib/customers'
import { shopApi } from '../lib/shop'

type ListQuery = Required<CustomerListQuery>
const selectClass = 'h-11 w-full rounded-[10px] border border-line bg-white px-3 text-sm text-ink'
const primaryLinkClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-accent px-4 text-sm font-semibold text-white shadow-sm hover:bg-accent/90'

function boundedNumber(value: string | null, fallback: number, max: number) {
  if (!value || !/^[1-9][0-9]*$/u.test(value)) return fallback
  const number = Number(value)
  return number <= max ? number : fallback
}

function readQuery(params: URLSearchParams): ListQuery {
  const status = params.get('status')
  const sort = params.get('sort')
  return {
    search: (params.get('search') || '').trim().slice(0, 100),
    status: status === 'archived' || status === 'all' ? status : 'active',
    page: boundedNumber(params.get('page'), 1, 10_000),
    pageSize: boundedNumber(params.get('pageSize'), 20, 50),
    sort: sort === 'updated_at' || sort === 'name' || sort === 'phone' ? sort : 'created_at',
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
  }
}

function queryParams(query: ListQuery) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== '') params.set(key, String(value))
  }
  return params
}

export function CustomerStatus({ archived }: { archived: boolean }) {
  return <span className={`text-xs font-medium ${archived ? 'text-muted' : 'text-accent'}`}>{archived ? 'Archived' : 'Active'}</span>
}

function CustomerSearch({ initialValue, onSearch }: { initialValue: string; onSearch: (search: string) => void }) {
  const value=initialValue
  const error=/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value) ? 'Search must not contain control characters.' : ''
  return (
    <form
      className="min-w-0 flex-1"
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        if (!error) onSearch(value)
      }}
    >
      <label htmlFor="customer-search" className="mb-2 block text-sm font-medium text-ink">Search customers</label>
      <div className="flex gap-2">
        <TextInput id="customer-search" type="search" placeholder="Name or mobile number" maxLength={100} value={value} onChange={(event) => onSearch(event.target.value)} aria-invalid={!!error} aria-describedby={error ? 'customer-search-error' : undefined} />
        <Button type="submit" variant="secondary" className="h-11" icon={<Search className="size-4" aria-hidden="true" />}>Search</Button>
      </div>
      {error ? <p id="customer-search-error" className="mt-1.5 text-xs text-red-700" role="alert">{error}</p> : null}
    </form>
  )
}

function CustomerTable({ customers }: { customers: ShopCustomer[] }) {
  return <ul aria-label="Customer search results" className="hairline-list border-y border-line bg-white">
    {customers.map(customer => <li key={customer.uuid}><Link to={`/customers/${customer.uuid}`} className="touch-row flex items-center gap-4 px-4 sm:px-5"><span className="min-w-0 flex-1"><span className="block break-words font-semibold">{customer.name}</span><span className="mt-1 block text-sm text-muted">{formatIndianMobile(customer.normalized_phone)}</span></span><span aria-hidden="true" className="text-xl leading-none text-subtle">›</span></Link></li>)}
  </ul>
}

export function CustomersPage() {
  const [params, setParams] = useSearchParams()
  const query = useMemo(()=>readQuery(params),[params])
  const [search,setSearch]=useState(query.search)
  useEffect(()=>{ const timer=setTimeout(()=>setSearch(query.search),200); return ()=>clearTimeout(timer) },[query.search])
  const requestQuery={ ...query,search }
  const validSearch=!/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(search)
  const customers = useQuery({ queryKey: ['shop','customers',requestQuery], queryFn: ({ signal }) => shopApi.customers(requestQuery, signal), enabled: validSearch,staleTime: 0,retry: false })
  const lastPage = Math.min(customers.data?.pagination.totalPages ?? 1, 10_000)
  const outsidePage = customers.isSuccess && query.page > lastPage

  useEffect(() => {
    if (outsidePage) setParams(queryParams({ ...query, page: lastPage }), { replace: true })
  }, [outsidePage, lastPage, query, setParams])

  const updateQuery = useCallback((updates: Partial<ListQuery>) => setParams(queryParams({ ...query, page: 1, ...updates })),[query,setParams])
  const searchCustomers=useCallback((search: string)=>{ if (search!==params.get('search')) setParams(queryParams({ ...query,search,page: 1 }),{ replace: true }) },[params,query,setParams])
  const pagination = customers.data?.pagination
  const firstRecord = pagination && pagination.total > 0 ? (query.page - 1) * query.pageSize + 1 : 0
  const lastRecord = pagination ? Math.min(query.page * query.pageSize, pagination.total) : 0

  return (
    <div className="space-y-8">
      <PageHeader title="Customers" actions={<Link aria-label="Add Customer" className={primaryLinkClass} to="/customers/new"><Plus className="size-4" aria-hidden="true" />Add customer</Link>} />
      <section className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <CustomerSearch initialValue={params.get('search') ?? ''} onSearch={searchCustomers} />
          </div>
          <details className="border-y border-line py-2"><summary aria-label="List options" className="min-h-11 cursor-pointer py-2 text-sm font-semibold">List options</summary><div className="mt-3 grid gap-4 pb-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <label htmlFor="customer-status" className="mb-2 block text-sm font-medium text-ink">Customer status</label>
              <select id="customer-status" className={selectClass} value={query.status} onChange={(event) => updateQuery({ status: event.target.value as ListQuery['status'] })}>
                <option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option>
              </select>
            </div>
            <div>
              <label htmlFor="customer-sort" className="mb-2 block text-sm font-medium text-ink">Sort by</label>
              <select id="customer-sort" className={selectClass} value={query.sort} onChange={(event) => updateQuery({ sort: event.target.value as ListQuery['sort'] })}>
                <option value="created_at">Date created</option><option value="updated_at">Last updated</option><option value="name">Full name</option><option value="phone">Mobile number</option>
              </select>
            </div>
            <div>
              <label htmlFor="customer-order" className="mb-2 block text-sm font-medium text-ink">Sort order</label>
              <select id="customer-order" className={selectClass} value={query.order} onChange={(event) => updateQuery({ order: event.target.value as ListQuery['order'] })}>
                <option value="desc">{query.sort === 'name' ? 'Z to A' : query.sort === 'phone' ? 'Highest first' : 'Newest first'}</option>
                <option value="asc">{query.sort === 'name' ? 'A to Z' : query.sort === 'phone' ? 'Lowest first' : 'Oldest first'}</option>
              </select>
            </div>
            <div>
              <label htmlFor="customer-page-size" className="mb-2 block text-sm font-medium text-ink">Per page</label>
              <select id="customer-page-size" className={selectClass} value={query.pageSize} onChange={(event) => updateQuery({ pageSize: Number(event.target.value) })}>
                {Array.from(new Set([10, 20, 50, query.pageSize])).sort((a, b) => a - b).map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </div>
          </div></details>
          {query.search || query.status !== 'active' ? <Button size="sm" variant="ghost" onClick={() => updateQuery({ search: '', status: 'active' })}>Clear filters</Button> : null}
      </section>
      {validSearch && (customers.isPending || outsidePage) ? <LoadingState label="Loading customers…" /> : null}
      {customers.isError ? <ErrorState title="Customers could not be loaded" description={customerErrorMessage(customers.error)} onRetry={() => void customers.refetch()} /> : null}
      {customers.isSuccess && !outsidePage ? (
        <section className="overflow-hidden border-y border-line bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4 sm:px-6">
            <h2 className="text-sm font-semibold text-ink">{query.search ? 'Search results' : query.status === 'archived' ? 'Archived customers' : query.status === 'all' ? 'All customers' : 'Active customers'}</h2>
            <p className="text-xs text-muted" role="status">{pagination?.total ?? 0} {(pagination?.total ?? 0) === 1 ? 'customer' : 'customers'}</p>
          </div>
           {customers.data.customers.length ? <CustomerTable customers={customers.data.customers} /> : (
            <div className="px-5 py-12 text-center sm:px-6">
              <h3 className="text-base font-semibold text-ink">{query.search ? 'No matching customers' : query.status === 'archived' ? 'No archived customers' : 'No customers yet'}</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">{query.search ? 'Try a different name or mobile number, or change the customer status.' : query.status === 'archived' ? 'Archived profiles will appear here. Archiving keeps the customer record available.' : 'Add a customer to start managing contact details. No sample records are shown.'}</p>
              {query.search ? <Button className="mt-5" variant="secondary" onClick={() => updateQuery({ search: '' })}>Clear search</Button> : query.status !== 'archived' ? <Link className={`${primaryLinkClass} mt-5`} to="/customers/new">Add Customer</Link> : null}
            </div>
          )}
          <nav className="flex flex-col gap-4 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6" aria-label="Customer pagination">
            <p className="text-xs text-muted">{pagination?.total ? `${firstRecord}–${lastRecord} of ${pagination.total}` : '0 customers'} · Page {query.page} of {pagination?.totalPages ?? 1}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={query.page <= 1} onClick={() => updateQuery({ page: query.page - 1 })} icon={<ChevronLeft className="size-4" aria-hidden="true" />}>Previous</Button>
              <Button size="sm" variant="secondary" disabled={query.page >= lastPage} onClick={() => updateQuery({ page: query.page + 1 })}>Next<ChevronRight className="size-4" aria-hidden="true" /></Button>
            </div>
          </nav>
          {(pagination?.totalPages ?? 1) > 10_000 ? <p className="px-5 pb-4 text-xs leading-5 text-muted sm:px-6">The first 10,000 pages are available. Narrow your search to find other customers.</p> : null}
         </section>
      ) : null}
    </div>
  )
}
