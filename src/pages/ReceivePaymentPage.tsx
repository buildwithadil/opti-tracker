import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useBeforeUnload, useBlocker, useLocation, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { Customer } from '../../shared/customers'
import type { PurchaseDetail } from '../../shared/purchases'
import type { PaymentCreated } from '../../shared/payments'
import { asPaise, formatPaise, parseRupeesToPaise } from '../../shared/money'
import { CustomerPicker } from '../components/CustomerPicker'
import { PaymentFields } from '../components/PaymentFields'
import { Button } from '../components/ui/Button'
import { Card, CardContent } from '../components/ui/Card'
import { ConfirmationDialog } from '../components/ui/ConfirmationDialog'
import { PageHeader } from '../components/ui/PageHeader'
import { ActionLink, EmptyState, Pagination } from '../components/ui/ShopUI'
import { ErrorState, LoadingState } from '../components/ui/States'
import { customersApi, customerKeys } from '../lib/customers'
import { paymentsApi, paymentKeys, paymentFieldErrors, isDuplicatePayment, type PaymentFieldName } from '../lib/payments'
import { purchaseKeys, purchaseMoney, purchasesApi } from '../lib/purchases'
import { localPaymentTime, paymentFormSchema, type PaymentFormValues, type PaymentSaveValues } from '../lib/paymentValidation'
import { refreshShop, shopApi } from '../lib/shop'
import { ApiError } from '../lib/api'

export function ReceivePaymentPage() {
  const location=useLocation()
  return <ReceivePaymentFlow key={location.key} />
}
function ReceivePaymentFlow() {
  const [params]=useSearchParams(), [customer,setCustomer]=useState<Customer|null>(null), [saleId,setSaleId]=useState(params.get('sale') ?? ''), [page,setPage]=useState(1), [received,setReceived]=useState<PaymentCreated|null>(null)
  const directCustomer=params.get('customer')
  const customerContext=useQuery({ queryKey: customerKeys.detail(directCustomer ?? ''),queryFn: ({ signal })=>customersApi.detail(directCustomer!,signal),enabled: !!directCustomer,staleTime: 0,retry: false })
  const selected=customer ?? customerContext.data
  const credit=useQuery({ queryKey: paymentKeys.credit(selected?.uuid ?? ''),queryFn: ({ signal })=>paymentsApi.credit(selected!.uuid,signal),enabled: !!selected,staleTime: 0,retry: false })
  const bills=useQuery({ queryKey: ['shop','payable-sales',selected?.uuid,page],queryFn: ({ signal })=>shopApi.sales({ customer_uuid: selected!.uuid,status: 'due',page,pageSize: 20 },signal),enabled: !!selected && !saleId && !selected.archived_at,staleTime: 0,retry: false })
  const effectiveSale=saleId || (bills.data?.pagination.total===1 && bills.data.sales.length===1 ? bills.data.sales[0].uuid : '')
  const purchase=useQuery({ queryKey: purchaseKeys.detail(selected?.uuid ?? '',effectiveSale),queryFn: ({ signal })=>purchasesApi.detail(selected!.uuid,effectiveSale,signal),enabled: !!selected && !!effectiveSale,staleTime: 0,retry: false })
  if (received && selected) return <div className="mx-auto max-w-xl space-y-5"><PageHeader title="Payment received" description={selected.name} /><Card><CardContent className="space-y-3"><p className="text-3xl font-semibold tabular-nums">{purchaseMoney(received.payment.amount_paise)}</p><p className="text-sm text-muted">Remaining on this sale: <strong data-testid="received-remaining">{purchaseMoney(received.purchase_summary.outstanding_paise)}</strong></p></CardContent></Card><ActionLink className="w-full" to="/dashboard">Home</ActionLink><ActionLink secondary to={`/customers/${selected.uuid}/purchases/${received.payment.purchase_uuid}`}>View sale & receipt</ActionLink><ActionLink secondary to="/outstanding">Outstanding</ActionLink></div>
   return <div className="mx-auto max-w-2xl space-y-6"><PageHeader title="Receive Payment" description="Choose a customer, then record what they paid." />{!selected ? directCustomer && customerContext.isPending ? <LoadingState label="Loading customer…" /> : customerContext.isError ? <ErrorState description={customerContext.error.message} onRetry={()=>void customerContext.refetch()} /> : <CustomerPicker onSelect={record=>{ setCustomer(record); setSaleId(''); setReceived(null) }} /> : <>
     <Card><CardContent><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h2 className="break-words font-semibold">{selected.name}</h2><p className="text-sm text-muted">{selected.phone}</p><p className="mt-2 text-sm text-muted">Customer outstanding: <strong>{credit.data ? purchaseMoney(credit.data.outstanding_paise) : '—'}</strong></p></div><ActionLink secondary to="/receive-payment">Change customer</ActionLink></div>{saleId ? <ActionLink secondary className="mt-3" to={`/receive-payment?customer=${selected.uuid}`}>Choose another sale</ActionLink> : null}{credit.isError ? <p role="alert">{credit.error.message}</p> : null}</CardContent></Card>
    {selected.archived_at ? <EmptyState title="Restore this customer first" description="Their history and outstanding balance are preserved." action={<ActionLink secondary to={`/customers/${selected.uuid}`}>Open customer</ActionLink>} /> : effectiveSale ? purchase.isPending ? <LoadingState label="Loading sale balance…" /> : purchase.isError ? <ErrorState description={purchase.error.message} onRetry={()=>void purchase.refetch()} /> : <CollectForm key={effectiveSale} customer={selected} purchase={purchase.data} onReceived={setReceived} /> : bills.isPending ? <LoadingState label="Finding sales with a balance…" /> : bills.isError ? <ErrorState description={bills.error.message} onRetry={()=>void bills.refetch()} /> : <>{bills.data?.sales.length ? <ul aria-label="Choose sale to pay" className="space-y-3">{bills.data.sales.map(sale=><li key={sale.uuid}><button type="button" className="flex min-h-20 w-full items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4 text-left" onClick={()=>setSaleId(sale.uuid)}><span><span className="block font-semibold">{sale.invoice_number || 'Sale'} · {sale.purchase_date}</span><span className="text-sm text-muted">Total {purchaseMoney(sale.total_paise)} · Paid {purchaseMoney(sale.amount_paid_paise)}</span></span><span className="font-semibold">{purchaseMoney(sale.outstanding_paise)} due</span></button></li>)}</ul> : <EmptyState title="No payable sales" description="There are no current sales eligible for another payment. Historical or unsupported balances may require review." action={<ActionLink secondary to={`/customers/${selected.uuid}`}>View customer history</ActionLink>} />}{bills.data ? <Pagination label="Payable sales pagination" page={page} pagination={bills.data.pagination} onPage={setPage} /> : null}</>}
  </>}</div>
}
function CollectForm({ customer,purchase,onReceived }: { customer: Customer; purchase: PurchaseDetail; onReceived: (result: PaymentCreated)=>void }) {
  const client=useQueryClient(), lock=useRef(false), frozen=useRef<PaymentSaveValues|null>(null)
  const [saved,setSaved]=useState(false)
  const [pending,setPending]=useState(false), [error,setError]=useState(''), [uncertain,setUncertain]=useState(false)
  const errorFocus=useRef<PaymentFieldName|null>(null)
  const form=useForm<PaymentFormValues,unknown,PaymentSaveValues>({ resolver: zodResolver(paymentFormSchema(purchase.outstanding_paise,purchase.purchase_date)),defaultValues: { client_request_id: crypto.randomUUID(),amount: formatPaise(asPaise(purchase.outstanding_paise)),payment_method: 'cash',received_at: localPaymentTime(),reference: '',notes: '' } })
  const dirty=!saved && (form.formState.isDirty || pending || uncertain), available=purchase.outstanding_paise>0 && !['void','refunded'].includes(purchase.status) && purchase.currency_code==='INR'
  const blocker=useBlocker(()=>dirty)
  useEffect(()=>{ if (!pending && errorFocus.current) { form.setFocus(errorFocus.current); errorFocus.current=null } },[pending,error,form])
  useBeforeUnload(useCallback((event: BeforeUnloadEvent)=>{ if (dirty) { event.preventDefault(); event.returnValue='' } },[dirty]))
  async function existing(values: PaymentSaveValues): Promise<PaymentCreated|null> {
    const found=await shopApi.payments({ customer_uuid: customer.uuid,sale_uuid: purchase.uuid,submission_uuid: values.client_request_id,pageSize: 1 })
    if (!found.payments.length) return null
    const payment=found.payments[0]
    if (found.payments.length!==1 || payment.amount_paise!==parseRupeesToPaise(values.amount) || payment.payment_method!==values.payment_method) throw new Error('The saved receipt needs review. Do not record another payment.')
    const current=await purchasesApi.detail(customer.uuid,purchase.uuid)
    return { payment,purchase_summary: current }
  }
  async function collect(values: PaymentSaveValues) {
    if (lock.current) return
    lock.current=true; setPending(true); setError(''); frozen.current=values
    try {
      let result=uncertain ? await existing(values) : null
      if (!result) { try { result=await paymentsApi.create(customer.uuid,purchase.uuid,values) } catch (failure) { if (!isDuplicatePayment(failure)) throw failure; result=await existing(values); if (!result) throw failure } }
      setSaved(true); form.reset(); onReceived(result); await refreshShop(client)
    } catch (failure) {
      const unknown=!(failure instanceof ApiError) || failure.status===0 || failure.status>=500
      setUncertain(unknown); setError(failure instanceof Error ? failure.message : 'Payment could not be recorded.')
      if (!unknown) {
        await client.invalidateQueries({ queryKey: purchaseKeys.detail(customer.uuid,purchase.uuid) })
        const fields=paymentFieldErrors(failure)
        if (fields.length) fields.forEach(field=>form.setError(field.field,{ message: field.message }))
        else form.setError('amount',{ message: 'Review the current balance before trying again.' })
        errorFocus.current=fields[0]?.field ?? 'amount'
      }
    } finally { setPending(false); lock.current=false }
  }
  return <><Card><CardContent><p className="text-sm text-muted">Sale · {purchase.purchase_date}</p><p className="mt-1 text-2xl font-semibold tabular-nums" data-testid="collect-outstanding">{purchaseMoney(purchase.outstanding_paise)} due</p><ActionLink secondary className="mt-3" to={`/customers/${customer.uuid}/purchases/${purchase.uuid}`}>View sale</ActionLink></CardContent></Card>{!available && !uncertain ? <EmptyState title="This sale is settled" description="No further payment can be recorded for this sale." /> : <form noValidate aria-label="Receive payment" className="space-y-4" onSubmit={event=>{ event.preventDefault(); if (uncertain && frozen.current) { void collect(frozen.current); return }; void form.handleSubmit(collect)() }}><fieldset disabled={pending || uncertain}><PaymentFields form={form} /></fieldset>{error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}{uncertain ? ' Check/continue uses the same receipt, never a new payment.' : ''}</p> : null}<div className="sticky-actions"><Button type="submit" loading={pending} className="w-full">{uncertain ? 'Check / continue payment' : 'Receive Payment'}</Button></div></form>}<ConfirmationDialog open={blocker.state==='blocked'} title={pending ? 'Save in progress' : 'Discard unsaved changes?'} description={pending ? 'Wait for the payment operation to finish.' : uncertain ? 'A receipt may already be saved. Review payment history before starting another payment.' : 'The unsaved payment fields will be discarded.'} confirmLabel="Discard changes" cancelLabel="Keep editing" pending={pending} danger onCancel={()=>{ if (blocker.state==='blocked') blocker.reset() }} onConfirm={()=>{ if (blocker.state==='blocked' && !pending) blocker.proceed() }} /></>
}
