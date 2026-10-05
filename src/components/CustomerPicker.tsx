import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { Customer } from '../../shared/customers'
import { formatIndianMobile } from '../../shared/phone'
import { customerSchema, type CustomerFormValues } from '../lib/customerValidation'
import { customerErrorMessage, customerFieldErrors, customerKeys, customersApi } from '../lib/customers'
import { Button } from './ui/Button'
import { Field, TextInput } from './ui/Field'
import { EmptyState, Pagination, Sheet } from './ui/ShopUI'
import { ErrorState, LoadingState } from './ui/States'

export function CustomerPicker({ onSelect }: { onSelect: (customer: Customer) => void }) {
  const [input,setInput] = useState(''), [search,setSearch] = useState(''), [page,setPage] = useState(1)
  useEffect(() => { const timer=setTimeout(() => { setSearch(input.trim()); setPage(1) },200); return () => clearTimeout(timer) },[input])
  const valid = !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(search)
  const query = { search,status: 'active' as const,page,pageSize: 10,sort: 'updated_at' as const,order: 'desc' as const }
  const customers = useQuery({ queryKey: customerKeys.list(query),queryFn: ({ signal }) => customersApi.list(query,signal),enabled: valid,staleTime: 0,retry: false })
  return <div className="space-y-4"><Field id="choose-customer" label="Search customer"><TextInput id="choose-customer" type="search" autoComplete="off" placeholder="Name or mobile number" maxLength={100} value={input} onChange={event => setInput(event.target.value)} /></Field>
    {!valid ? <p role="alert">Search cannot contain control characters.</p> : customers.isPending ? <LoadingState label="Finding customers…" /> : customers.isError ? <ErrorState description={customerErrorMessage(customers.error)} onRetry={() => void customers.refetch()} /> : <>
      {customers.data.customers.length ? <ul aria-label="Choose customer" className="divide-y divide-line rounded-2xl border border-line bg-white">{customers.data.customers.map(customer => <li key={customer.uuid}><button type="button" onClick={() => onSelect(customer)} className="flex min-h-16 w-full items-center justify-between gap-3 px-4 py-3 text-left" aria-label={`Select ${customer.name}`}><span className="min-w-0"><span className="block break-words font-semibold">{customer.name}</span><span className="text-sm text-muted">{formatIndianMobile(customer.normalized_phone)}</span></span><span className="text-sm font-semibold text-accent">Select</span></button></li>)}</ul> : <EmptyState title="No matching customers" description="Try a name or number, or add a customer below." />}
      <Pagination label="Customer choices" page={page} pagination={customers.data.pagination} onPage={setPage} busy={customers.isFetching} />
    </>}
  </div>
}

export function CustomerCreateSheet({ open,onClose,onCreated,onDirtyChange,onPendingChange }: { open: boolean; onClose: () => void; onCreated: (customer: Customer) => void; onDirtyChange?: (dirty: boolean) => void; onPendingChange?: (pending: boolean)=>void }) {
  const [pending,setPending]=useState(false)
  const updatePending=useCallback((value: boolean)=>{ setPending(value); onPendingChange?.(value) },[onPendingChange])
  return <Sheet open={open} title="Add customer" onClose={onClose} pending={pending}>{open ? <InlineCustomerForm onCreated={onCreated} onDirtyChange={onDirtyChange} onPendingChange={updatePending} /> : null}</Sheet>
}
function InlineCustomerForm({ onCreated,onDirtyChange,onPendingChange }: { onCreated: (customer: Customer) => void; onDirtyChange?: (dirty: boolean) => void; onPendingChange: (pending: boolean)=>void }) {
  const client=useQueryClient(), lock=useRef(false), focus=useRef<'name'|'phone'|null>(null)
  const form=useForm<CustomerFormValues>({ resolver: zodResolver(customerSchema),defaultValues: { name: '',phone: '' } })
  const save=useMutation({ mutationFn: customersApi.create,onSuccess: async customer => { form.reset(); client.setQueryData(customerKeys.detail(customer.uuid),customer); await Promise.all([client.invalidateQueries({ queryKey: customerKeys.all }),client.invalidateQueries({ queryKey: ['shop'] })]); onCreated(customer) },onError: error => { const fields=customerFieldErrors(error); fields.forEach(field => form.setError(field.field,{ message: field.message })); focus.current=fields[0]?.field ?? null } })
  const pending=form.formState.isSubmitting || save.isPending
  useEffect(() => { onDirtyChange?.(form.formState.isDirty || pending) },[form.formState.isDirty,pending,onDirtyChange])
  useEffect(()=>{ onPendingChange(pending); return ()=>onPendingChange(false) },[pending,onPendingChange])
  useEffect(() => { if (!pending && focus.current) { form.setFocus(focus.current); focus.current=null } },[pending,save.error,form])
  return <form noValidate aria-label="Add customer in sale" className="space-y-4" onSubmit={event => { void form.handleSubmit(async values => { if (lock.current) return; lock.current=true; try { await save.mutateAsync(values) } catch { /* Keep the draft and focus the server error. */ } finally { lock.current=false } })(event) }}>
    <fieldset disabled={pending} className="space-y-4"><Field id="inline-name" label="Full name" error={form.formState.errors.name?.message}><TextInput id="inline-name" autoFocus autoComplete="name" maxLength={200} aria-invalid={!!form.formState.errors.name} {...form.register('name')} /></Field><Field id="inline-phone" label="Mobile number" error={form.formState.errors.phone?.message}><TextInput id="inline-phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={32} aria-invalid={!!form.formState.errors.phone} {...form.register('phone')} /></Field></fieldset>
    {save.isError ? <p role="alert" className="text-sm text-red-700">{customerErrorMessage(save.error)} If a save was interrupted, search this number before creating another profile.</p> : null}<Button type="submit" loading={pending} className="w-full">Save & Continue</Button>
  </form>
}
