import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { salesQuerySchema, type ShopQuery } from '../../shared/shop'
import { shopApi } from '../lib/shop'
import { SaleCard } from '../components/SaleCard'
import { PageHeader } from '../components/ui/PageHeader'
import { Field, TextInput } from '../components/ui/Field'
import { EmptyState, NewSaleLink, Pagination } from '../components/ui/ShopUI'
import { ErrorState, LoadingState } from '../components/ui/States'

export function SalesPage() {
  const [input,setInput]=useState(''), [search,setSearch]=useState(''), [page,setPage]=useState(1), [status,setStatus]=useState<'all'|'due'|'paid'>('all'), [from,setFrom]=useState(''), [to,setTo]=useState('')
  useEffect(() => { const timer=setTimeout(() => { setSearch(input.trim()); setPage(1) },200); return () => clearTimeout(timer) },[input])
  const query: ShopQuery={ search,page,pageSize: 20,status,dateFrom: from || undefined,dateTo: to || undefined }
  const parsed=salesQuerySchema.safeParse({ ...query,page: String(page),pageSize: '20' })
  const sales=useQuery({ queryKey: ['shop','sales',query],queryFn: ({ signal }) => shopApi.sales(query,signal),enabled: parsed.success,staleTime: 0,retry: false })
  useEffect(() => { if (!sales.data || page<=sales.data.pagination.totalPages) return; const timer=setTimeout(()=>setPage(sales.data!.pagination.totalPages),0); return ()=>clearTimeout(timer) },[sales.data,page])
  return <div className="space-y-7"><PageHeader title="Sales" description="A clear record of every sale and its balance." actions={<NewSaleLink />} /><section className="space-y-4"><Field id="sales-search" label="Search sales"><TextInput id="sales-search" type="search" placeholder="Customer, phone or invoice number" maxLength={100} value={input} onChange={event=>setInput(event.target.value)} /></Field>
    <div className="grid grid-cols-3 gap-2">{(['all','due','paid'] as const).map(value => <button key={value} type="button" aria-pressed={status===value} onClick={() => { setStatus(value); setPage(1) }} className={`min-h-10 rounded-[10px] border text-sm font-semibold transition-colors ${status===value ? 'border-accent bg-accent/8 text-accent' : 'border-line bg-white text-muted hover:bg-paper'}`}>{value==='all' ? 'All sales' : value==='due' ? 'Payment due' : 'Paid'}</button>)}</div>
    <details className="border-y border-line py-2"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Date filters</summary><div className="mt-3 grid grid-cols-2 gap-3 pb-3"><Field id="sales-from" label="Sales from"><TextInput id="sales-from" type="date" value={from} onChange={event=>{ setFrom(event.target.value); setPage(1) }} /></Field><Field id="sales-to" label="Sales to"><TextInput id="sales-to" type="date" value={to} onChange={event=>{ setTo(event.target.value); setPage(1) }} /></Field></div><p className="text-xs text-muted">Leave dates blank to see all history.</p></details></section>
    {!parsed.success ? <p role="alert" className="text-sm text-red-700">{parsed.error.issues[0].message}</p> : sales.isPending ? <LoadingState label="Loading sales…" /> : sales.isError ? <ErrorState title="Sales could not be loaded" description={sales.error.message} onRetry={()=>void sales.refetch()} /> : <>{sales.data.sales.length ? <ul aria-label="Sales history" className="hairline-list border-y border-line bg-white">{sales.data.sales.map(sale=><li key={sale.uuid}><SaleCard sale={sale} /></li>)}</ul> : <EmptyState title="No matching sales" description="Try another search or date range, or make your first sale." action={<NewSaleLink />} />}<Pagination label="Sales pagination" page={page} pagination={sales.data.pagination} onPage={setPage} busy={sales.isFetching} /></>}
  </div>
}
