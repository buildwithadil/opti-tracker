import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react'
import type { Customer, CustomerListQuery } from '../../shared/customers'
import { formatIndianMobile } from '../../shared/phone'
import { Button } from '../components/ui/Button'
import { Card, CardContent } from '../components/ui/Card'
import { TextInput } from '../components/ui/Field'
import { PageHeader } from '../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../components/ui/States'
import { customerDate, customerErrorMessage, customerKeys, customersApi } from '../lib/customers'

type ListQuery = Required<CustomerListQuery>
const selectClass = 'h-11 w-full rounded-md border border-line bg-white px-3 text-sm text-ink'
const primaryLinkClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-white hover:bg-ink/90'

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
  return <span className="inline-flex rounded-full border border-line bg-paper px-2.5 py-1 text-xs font-medium text-muted">{archived ? 'Archived' : 'Active'}</span>
}

function CustomerSearch({ initialValue, onSearch }: { initialValue: string; onSearch: (search: string) => void }) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState('')
  return (
    <form
      className="min-w-0 flex-1"
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value)) {
          setError('Search must not contain control characters.')
          return
        }
        setError('')
        onSearch(value.trim())
      }}
    >
      <label htmlFor="customer-search" className="mb-2 block text-sm font-medium text-ink">Search customers</label>
      <div className="flex gap-2">
        <TextInput id="customer-search" type="search" placeholder="Name or mobile number" maxLength={100} value={value} onChange={(event) => setValue(event.target.value)} aria-invalid={!!error} aria-describedby={error ? 'customer-search-error' : undefined} />
        <Button type="submit" variant="secondary" className="h-11" icon={<Search className="size-4" aria-hidden="true" />}>Search</Button>
      </div>
      {error ? <p id="customer-search-error" className="mt-1.5 text-xs text-red-700" role="alert">{error}</p> : null}
    </form>
  )
}

function CustomerTable({ customers }: { customers: Customer[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Customer search results</caption>
          <thead className="border-b border-line bg-paper text-xs text-muted">
            <tr>
              <th scope="col" className="px-6 py-3 font-medium">Name</th>
              <th scope="col" className="px-4 py-3 font-medium">Phone</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 font-medium">Date added</th>
              <th scope="col" className="px-6 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {customers.map((customer) => (
              <tr key={customer.uuid} className="hover:bg-paper/70">
                <th scope="row" className="max-w-72 px-6 py-4 font-medium text-ink">
                  <Link className="rounded-sm underline-offset-4 hover:underline [overflow-wrap:anywhere]" to={`/customers/${customer.uuid}`}>{customer.name}</Link>
                </th>
                <td className="whitespace-nowrap px-4 py-4 text-muted">{formatIndianMobile(customer.normalized_phone)}</td>
                <td className="px-4 py-4"><CustomerStatus archived={!!customer.archived_at} /></td>
                <td className="whitespace-nowrap px-4 py-4 text-muted"><time dateTime={customer.created_at}>{customerDate(customer.created_at)}</time></td>
                <td className="px-6 py-4 text-right"><Link to={`/customers/${customer.uuid}`} className="rounded-sm font-medium text-ink underline underline-offset-4 hover:no-underline" aria-label={`View ${customer.name}`}>View</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line md:hidden" aria-label="Customer search results">
        {customers.map((customer) => (
          <li key={customer.uuid} className="space-y-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <Link className="min-w-0 rounded-sm text-sm font-semibold text-ink underline-offset-4 hover:underline [overflow-wrap:anywhere]" to={`/customers/${customer.uuid}`}>{customer.name}</Link>
              <CustomerStatus archived={!!customer.archived_at} />
            </div>
            <p className="text-sm text-muted">{formatIndianMobile(customer.normalized_phone)}</p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted">Date added <time dateTime={customer.created_at}>{customerDate(customer.created_at)}</time></p>
              <Link to={`/customers/${customer.uuid}`} className="rounded-sm text-sm font-medium text-ink underline underline-offset-4 hover:no-underline" aria-label={`View ${customer.name}`}>View profile</Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

export function CustomersPage() {
  const [params, setParams] = useSearchParams()
  const query = readQuery(params)
  const customers = useQuery({ queryKey: customerKeys.list(query), queryFn: ({ signal }) => customersApi.list(query, signal), retry: false })
  const lastPage = Math.min(customers.data?.pagination.totalPages ?? 1, 10_000)
  const outsidePage = customers.isSuccess && query.page > lastPage

  useEffect(() => {
    if (outsidePage) setParams(queryParams({ ...query, page: lastPage }), { replace: true })
  }, [outsidePage, lastPage, query, setParams])

  const updateQuery = (updates: Partial<ListQuery>) => setParams(queryParams({ ...query, page: 1, ...updates }))
  const pagination = customers.data?.pagination
  const firstRecord = pagination && pagination.total > 0 ? (query.page - 1) * query.pageSize + 1 : 0
  const lastRecord = pagination ? Math.min(query.page * query.pageSize, pagination.total) : 0

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Customer management" title="Customers" description="Find customers, keep contact details current, and manage active or archived profiles." actions={<Link className={primaryLinkClass} to="/customers/new"><Plus className="size-4" aria-hidden="true" />Add Customer</Link>} />
      <Card>
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <CustomerSearch key={query.search} initialValue={query.search} onSearch={(search) => updateQuery({ search })} />
            <div className="sm:w-44">
              <label htmlFor="customer-status" className="mb-2 block text-sm font-medium text-ink">Customer status</label>
              <select id="customer-status" className={selectClass} value={query.status} onChange={(event) => updateQuery({ status: event.target.value as ListQuery['status'] })}>
                <option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option>
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem]">
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
          </div>
          {query.search || query.status !== 'active' ? <Button size="sm" variant="ghost" onClick={() => updateQuery({ search: '', status: 'active' })}>Clear filters</Button> : null}
        </CardContent>
      </Card>
      {customers.isPending || outsidePage ? <LoadingState label="Loading customers…" /> : null}
      {customers.isError ? <ErrorState title="Customers could not be loaded" description={customerErrorMessage(customers.error)} onRetry={() => void customers.refetch()} /> : null}
      {customers.isSuccess && !outsidePage ? (
        <Card>
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
        </Card>
      ) : null}
    </div>
  )
}
