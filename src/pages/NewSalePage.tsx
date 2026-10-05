import { useCallback, useEffect, useRef, useState } from 'react'
import { useBeforeUnload, useBlocker, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useFieldArray, useForm, useWatch, type FieldPath } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { Check, Plus, Trash2 } from 'lucide-react'
import type { Customer } from '../../shared/customers'
import type { Prescription } from '../../shared/prescriptions'
import type { PurchaseDetail } from '../../shared/purchases'
import type { Invoice } from '../../shared/invoices'
import { purchaseCategories, purchaseCategoryLabels } from '../../shared/purchases'
import { purchaseAmounts } from '../../shared/purchaseValidation'
import { asPaise, formatPaise, parseRupeesToPaise } from '../../shared/money'
import { CustomerPicker, CustomerCreateSheet } from '../components/CustomerPicker'
import { InlinePrescription } from '../components/InlinePrescription'
import { PaymentFields } from '../components/PaymentFields'
import { Button } from '../components/ui/Button'
import { Card, CardContent } from '../components/ui/Card'
import { ConfirmationDialog } from '../components/ui/ConfirmationDialog'
import { Field, TextInput } from '../components/ui/Field'
import { PageHeader } from '../components/ui/PageHeader'
import { ActionLink, Disclosure, Sheet } from '../components/ui/ShopUI'
import { customersApi } from '../lib/customers'
import { purchaseFormSchema, type PurchaseFormValues, type PurchaseSaveValues } from '../lib/purchaseValidation'
import { isDuplicatePurchase, purchaseFieldErrors, purchaseMoney, purchasesApi } from '../lib/purchases'
import { localPaymentTime, paymentFormSchema, type PaymentFormValues, type PaymentSaveValues } from '../lib/paymentValidation'
import { isDuplicatePayment, paymentFieldErrors, paymentsApi } from '../lib/payments'
import { incompleteInvoice, invoiceKeys, invoicesApi } from '../lib/invoices'
import { prescriptionDate, prescriptionsApi } from '../lib/prescriptions'
import { refreshShop, shopApi } from '../lib/shop'
import { ApiError } from '../lib/api'

const newItem = () => ({ description: '',product_category: 'spectacle_frames' as const,quantity: '1',unit_price: '',discount: '0' })
// Receipt eligibility starts at sale-date midnight UTC. Default to the current
// supported UTC date so an ordinary sale works before 05:30 IST as well.
function defaults(): PurchaseFormValues { return { client_request_id: crypto.randomUUID(),purchase_date: new Date().toISOString().slice(0,10),prescription_uuid: '',notes: '',order_discount: '0',items: [newItem()] } }

export function NewSalePage() {
  const location=useLocation()
  return <NewSaleFlow key={location.key} />
}
function NewSaleFlow() {
  const [params]=useSearchParams(), client=useQueryClient(), navigate=useNavigate()
  const [customer,setCustomer]=useState<Customer|null>(null), [step,setStep]=useState(0), [sheet,setSheet]=useState<'customer'|'prescription'|null>(null), [childDirty,setChildDirty]=useState(false), [childPending,setChildPending]=useState(false), [discardSheet,setDiscardSheet]=useState(false)
  const [prescription,setPrescription]=useState<Prescription|null>(null), [rxPage,setRxPage]=useState(1)
  const [initial]=useState(defaults), [receiveNow,setReceiveNow]=useState(true), [pending,setPending]=useState(false), [error,setError]=useState(''), [progress,setProgress]=useState(''), [done,setDone]=useState(false), [savedSale,setSavedSale]=useState<PurchaseDetail|null>(null), [invoice,setInvoice]=useState<Invoice|null>(null), [needsNewInvoiceKey,setNeedsNewInvoiceKey]=useState(false)
  const [writingStarted,setWritingStarted]=useState(false), [correctingPayment,setCorrectingPayment]=useState(false)
  const started=useRef(false), paymentAttempted=useRef(false), lock=useRef(false), committed=useRef<PurchaseDetail|null>(null), paid=useRef(false), purchaseInput=useRef<PurchaseSaveValues|null>(null), paymentInput=useRef<PaymentSaveValues|null>(null), invoiceKey=useRef(crypto.randomUUID())
  const form=useForm<PurchaseFormValues,unknown,PurchaseSaveValues>({ resolver: zodResolver(purchaseFormSchema),defaultValues: initial })
  const items=useFieldArray({ control: form.control,name: 'items' }), watched=useWatch({ control: form.control })
  let total: number|null=null
  try { total=purchaseAmounts({ items: (watched.items ?? []).map(item => ({ quantity: Number(item.quantity),unit_price: item.unit_price ?? '',discount: item.discount })),order_discount: watched.order_discount }).totalPaise } catch { /* Incomplete price/quantity has no false total. */ }
  const paymentLimit=correctingPayment && savedSale ? savedSale.outstanding_paise : total ?? 0
  const payment=useForm<PaymentFormValues,unknown,PaymentSaveValues>({ resolver: zodResolver(paymentFormSchema(paymentLimit,watched.purchase_date ?? initial.purchase_date)),defaultValues: { client_request_id: crypto.randomUUID(),amount: '',payment_method: 'cash',received_at: localPaymentTime(),reference: '',notes: '' } })
  const paymentAmount=useWatch({ control: payment.control,name: 'amount' })
  let remaining: number|null=null
  try { const received=receiveNow ? parseRupeesToPaise(paymentAmount || '0') : 0; if (total !== null && received<=paymentLimit) remaining=paymentLimit-received } catch { /* Invalid input is handled by the shared validator. */ }
  useEffect(() => { const uuid=params.get('customer'); if (!uuid) return; let alive=true; void customersApi.detail(uuid).then(record => { if (alive) { setCustomer(record); setStep(1) } }).catch(failure => { if (alive) setError(failure.message) }); return () => { alive=false } },[params])
  const rx=useQuery({ queryKey: ['prescriptions',customer?.uuid,'checkout',rxPage],queryFn: ({ signal }) => prescriptionsApi.list(customer!.uuid,{ page: rxPage,pageSize: 10 },signal),enabled: !!customer && step===1,staleTime: 0,retry: false })
  const identity=useQuery({ queryKey: invoiceKeys.identity,queryFn: ({ signal }) => invoicesApi.identity(signal),staleTime: 0,retry: false })
  const dirty=!done && (!!customer || form.formState.isDirty || payment.formState.isDirty || childDirty || pending)
  const blocker=useBlocker(() => dirty)
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue='' } },[dirty]))
  const choose=(record: Customer) => { setCustomer(record); setRxPage(1); setStep(1); setSheet(null); setChildDirty(false); setError('') }
  const closeSheet=() => { if (childPending) return; if (childDirty) setDiscardSheet(true); else setSheet(null) }
  const sheetConfirmation = discardSheet ? { title: 'Discard unsaved changes?', description: 'The customer or prescription draft will be discarded.', onCancel: () => setDiscardSheet(false), onConfirm: () => { setDiscardSheet(false); setChildDirty(false); setSheet(null) }, pending: childPending } : undefined
  const continueToPayment=() => { void form.handleSubmit(values => { purchaseInput.current=values; if (!payment.formState.isDirty) payment.setValue('amount',formatPaise(asPaise(purchaseAmounts(values).totalPaise))); setStep(2) })() }

  async function complete(values: PaymentSaveValues|null) {
    if (lock.current || !customer || done) return
    lock.current=true; setPending(true); setError('')
    let receiptRejected=false
    const recoveringSale=started.current
    try {
      // Freeze validated input and UUIDs once writes start; later retries resume
      // committed progress, including uncertain response recovery, not new sales.
      if (!purchaseInput.current) throw new Error('Review the items before completing the sale.')
      if (!committed.current) {
        if (!started.current) paymentInput.current=values
        started.current=true; setWritingStarted(true)
        setProgress('Saving sale…')
        if (recoveringSale) {
          const recovered=await shopApi.sales({ customer_uuid: customer.uuid,submission_uuid: purchaseInput.current.client_request_id,pageSize: 1 })
          if (recovered.sales.length===1) committed.current=await purchasesApi.detail(customer.uuid,recovered.sales[0].uuid)
        }
        try { if (!committed.current) committed.current=await purchasesApi.create(customer.uuid,purchaseInput.current) }
        catch (failure) {
          if (!isDuplicatePurchase(failure)) throw failure
          const recovered=await shopApi.sales({ customer_uuid: customer.uuid,submission_uuid: purchaseInput.current.client_request_id,pageSize: 1 })
          if (recovered.sales.length !== 1) throw new Error('Cannot confirm the saved sale. Check Sales before starting another.',{ cause: failure })
          committed.current=await purchasesApi.detail(customer.uuid,recovered.sales[0].uuid)
        }
        setSavedSale(committed.current)
      }
      const sale=committed.current
      if (correctingPayment) { paymentInput.current=values; setCorrectingPayment(false) }
      if (paymentInput.current && !paid.current) {
        setProgress('Recording payment…')
        const recovered=paymentAttempted.current ? await shopApi.payments({ customer_uuid: customer.uuid,sale_uuid: sale.uuid,submission_uuid: paymentInput.current.client_request_id,pageSize: 1 }) : null
        if (recovered?.payments.length && (recovered.payments.length!==1 || recovered.payments[0].amount_paise!==parseRupeesToPaise(paymentInput.current.amount) || recovered.payments[0].payment_method!==paymentInput.current.payment_method)) throw new Error('The saved receipt needs review before continuing.')
        try { if (!recovered?.payments.length) { paymentAttempted.current=true; await paymentsApi.create(customer.uuid,sale.uuid,paymentInput.current) } }
        catch (failure) {
          if (!isDuplicatePayment(failure)) { receiptRejected=failure instanceof ApiError && [400,413,409].includes(failure.status); throw failure }
          const recovered=await shopApi.payments({ customer_uuid: customer.uuid,sale_uuid: sale.uuid,submission_uuid: paymentInput.current.client_request_id,pageSize: 1 })
          if (recovered.payments.length !== 1 || recovered.payments[0].amount_paise !== parseRupeesToPaise(paymentInput.current.amount) || recovered.payments[0].payment_method !== paymentInput.current.payment_method) throw new Error('Cannot confirm this receipt. Check payment history before recording anything else.',{ cause: failure })
        }
        paid.current=true
      }
      setProgress('Preparing invoice…')
      if (needsNewInvoiceKey) { invoiceKey.current=crypto.randomUUID(); setNeedsNewInvoiceKey(false) }
      const issued=await invoicesApi.generate(customer.uuid,sale.uuid,invoiceKey.current)
      const current=await purchasesApi.detail(customer.uuid,sale.uuid)
      setSavedSale(current); setInvoice(issued); client.setQueryData(invoiceKeys.purchase(customer.uuid,sale.uuid),issued); setDone(true)
      await refreshShop(client)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not complete the sale.')
      if (incompleteInvoice(failure)) setNeedsNewInvoiceKey(true)
      // Known validation/eligibility rejections did not commit a purchase. An
      // uncertain network/500 response stays frozen until same-key recovery.
      if (!committed.current && !recoveringSale && failure instanceof ApiError && [400,413,409].includes(failure.status) && !isDuplicatePurchase(failure)) {
        started.current=false; setWritingStarted(false)
        const fields=purchaseFieldErrors(failure)
        fields.forEach(field=>form.setError(field.field as FieldPath<PurchaseFormValues>,{ message: field.message }))
        if (fields.length) setStep(1)
      }
      if (receiptRejected && committed.current && !paid.current) {
        // The atomic receipt was rejected: permit correction of payment only.
        // The committed sale/items and their submission ID stay immutable.
        paymentAttempted.current=false; paymentInput.current=null; setCorrectingPayment(true)
        paymentFieldErrors(failure).forEach(field=>payment.setError(field.field,{ message: field.message }))
        try { setSavedSale(await purchasesApi.detail(customer.uuid,committed.current.uuid)) } catch { /* Keep saved-sale link and original error if refresh is unavailable. */ }
      }
    }
    finally { setPending(false); setProgress(''); lock.current=false }
  }
  const archived=!!customer?.archived_at
  const configured=identity.data && !!identity.data.shop_name.trim() && !!identity.data.address.trim() && !!identity.data.contact_number.trim()
  if (done && savedSale && invoice && customer) return <div className="mx-auto max-w-2xl space-y-5"><div className="flex size-14 items-center justify-center rounded-2xl bg-accent/10 text-accent"><Check className="size-7" aria-hidden="true" /></div><PageHeader title="Sale completed" description={`${customer.name} · ${invoice.invoice_number}`} /><Card><CardContent><p className="text-sm text-muted">Sale total</p><p className="mt-1 text-3xl font-semibold tabular-nums" data-testid="completed-total">{purchaseMoney(savedSale.total_paise)}</p><div className="mt-4 grid grid-cols-2 gap-4"><div><p className="text-sm text-muted">Paid</p><p className="font-semibold tabular-nums" data-testid="completed-paid">{purchaseMoney(savedSale.amount_paid_paise)}</p></div><div><p className="text-sm text-muted">Due</p><p className="font-semibold tabular-nums" data-testid="completed-due">{purchaseMoney(savedSale.outstanding_paise)}</p></div></div></CardContent></Card><ActionLink to={`/customers/${customer.uuid}/purchases/${savedSale.uuid}/invoice`} state={{ printInvoice: true }} className="w-full">Print Invoice</ActionLink><div className="grid grid-cols-2 gap-3"><ActionLink secondary to={`/customers/${customer.uuid}/purchases/${savedSale.uuid}`}>View sale</ActionLink>{savedSale.outstanding_paise>0 ? <ActionLink secondary to={`/receive-payment?customer=${customer.uuid}&sale=${savedSale.uuid}`}>Receive Payment</ActionLink> : <ActionLink secondary to="/dashboard">Home</ActionLink>}</div><Button variant="secondary" className="w-full" onClick={() => navigate('/sales/new')}>New Sale</Button></div>
  return <div className="mx-auto max-w-3xl space-y-6"><PageHeader title="New Sale" description={customer ? customer.name : 'Start with a customer, then add items and payment.'} />
     <p className="border-b border-line pb-3 text-sm text-muted" aria-label="Sale progress">{step === 0 ? 'Choose a customer' : step === 1 ? 'Add items and prescription' : 'Payment'}</p>
    {archived ? <p role="alert">Restore this archived customer before making a sale. <ActionLink secondary to={`/customers/${customer!.uuid}`}>Open customer</ActionLink></p> : step===0 ? <><CustomerPicker onSelect={choose} /><Button variant="secondary" className="w-full" onClick={() => setSheet('customer')}><Plus className="size-4" aria-hidden="true" />Add customer</Button></> : step===1 ? <>
      <div className="flex items-center justify-between gap-3"><p className="min-w-0 truncate text-sm">For <strong>{customer?.name}</strong></p><Button variant="ghost" size="sm" onClick={() => { setStep(0); setPrescription(null); form.setValue('prescription_uuid','') }}>Change customer</Button></div>
      <form noValidate aria-label="Sale items" className="space-y-4" onSubmit={event => { event.preventDefault(); continueToPayment() }}>
        {items.fields.map((item,index) => <Card key={item.id}><CardContent><fieldset className="space-y-4" aria-label={`Item ${index+1}`}><div className="flex items-center justify-between"><h2 className="font-semibold">Item {index+1}</h2><Button variant="ghost" size="sm" aria-label={`Remove item ${index+1}`} onClick={() => items.remove(index)}><Trash2 className="size-4" aria-hidden="true" /></Button></div><Field id={`item-${index}-description`} label="Product name / description" error={form.formState.errors.items?.[index]?.description?.message}><TextInput id={`item-${index}-description`} maxLength={500} placeholder="e.g. Acetate frame" {...form.register(`items.${index}.description`)} /></Field><Field id={`item-${index}-category`} label="Product category"><select id={`item-${index}-category`} className="h-12 w-full rounded-xl border border-line bg-white px-3" {...form.register(`items.${index}.product_category`)}>{purchaseCategories.map(category => <option value={category} key={category}>{purchaseCategoryLabels[category]}</option>)}</select></Field><div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3"><Field id={`item-${index}-quantity`} label="Quantity" error={form.formState.errors.items?.[index]?.quantity?.message}><TextInput id={`item-${index}-quantity`} inputMode="numeric" maxLength={6} {...form.register(`items.${index}.quantity`)} /></Field><Field id={`item-${index}-price`} label="Unit price (₹)" error={form.formState.errors.items?.[index]?.unit_price?.message}><TextInput id={`item-${index}-price`} inputMode="decimal" maxLength={24} {...form.register(`items.${index}.unit_price`)} /></Field></div><details><summary className="cursor-pointer text-sm font-medium text-muted">Line discount</summary><div className="mt-3"><Field id={`item-${index}-discount`} label="Line discount (₹)" error={form.formState.errors.items?.[index]?.discount?.message}><TextInput id={`item-${index}-discount`} inputMode="decimal" {...form.register(`items.${index}.discount`)} /></Field></div></details></fieldset></CardContent></Card>)}
        {form.formState.errors.items?.root?.message || form.formState.errors.items?.message ? <p role="alert" className="text-sm text-red-700">{form.formState.errors.items.root?.message ?? form.formState.errors.items.message}</p> : null}<Button variant="secondary" onClick={() => items.append(newItem())} disabled={items.fields.length>=100}><Plus className="size-4" aria-hidden="true" />Add item</Button>
        <Card><CardContent className="space-y-4"><h2 className="font-semibold">Prescription <span className="font-normal text-muted">· optional</span></h2><Field id="sale-prescription" label="Select prescription"><select id="sale-prescription" className="h-12 w-full rounded-xl border border-line bg-white px-3" value={watched.prescription_uuid ?? ''} onChange={event => { form.setValue('prescription_uuid',event.target.value,{ shouldDirty: true }); setPrescription(rx.data?.prescriptions.find(record => record.uuid===event.target.value) ?? null) }}><option value="">No prescription</option>{prescription && !rx.data?.prescriptions.some(record => record.uuid===prescription.uuid) ? <option value={prescription.uuid}>{prescriptionDate(prescription.prescribed_on)} · Version {prescription.revision_number}</option> : null}{rx.data?.prescriptions.map(record => <option key={record.uuid} value={record.uuid}>{prescriptionDate(record.prescribed_on)} · Version {record.revision_number} · {record.status}</option>)}</select></Field>{rx.isError ? <p role="alert" className="text-sm text-red-700">{rx.error.message}<Button variant="ghost" onClick={() => void rx.refetch()}>Retry prescription choices</Button></p> : null}{(rx.data?.pagination.totalPages ?? 1)>1 ? <div className="flex gap-2"><Button variant="secondary" disabled={rxPage<=1} onClick={() => setRxPage(value=>value-1)}>Previous prescriptions</Button><Button variant="secondary" disabled={rxPage>=Math.min(rx.data!.pagination.totalPages,10000)} onClick={() => setRxPage(value=>value+1)}>Next prescriptions</Button></div> : null}<Button variant="secondary" onClick={() => setSheet('prescription')}>New prescription</Button></CardContent></Card>
        <Disclosure title="Discount, date & notes" className="bg-white" invalid={!!form.formState.errors.order_discount || !!form.formState.errors.purchase_date || !!form.formState.errors.notes}>
          <Field id="sale-discount" label="Sale discount (₹)" error={form.formState.errors.order_discount?.message}><TextInput id="sale-discount" inputMode="decimal" {...form.register('order_discount')} /></Field>
          <Field id="sale-date" label="Sale date" error={form.formState.errors.purchase_date?.message} hint="Defaults to today's UTC date. Payments must be on or after the sale date at midnight UTC."><TextInput id="sale-date" type="date" {...form.register('purchase_date')} /></Field>
          <Field id="sale-notes" label="Sale notes" error={form.formState.errors.notes?.message}><textarea id="sale-notes" className="min-h-24 w-full rounded-xl border border-line p-3" maxLength={2000} {...form.register('notes')} /></Field>
        </Disclosure>
        <div className="sticky-actions space-y-3"><div className="flex justify-between text-lg font-semibold"><span>Total</span><span data-testid="sale-total">{total===null ? '—' : purchaseMoney(total)}</span></div><Button type="submit" className="w-full">Continue to payment</Button></div>
      </form>
    </> : <>
      <Card><CardContent><div className="flex justify-between text-xl font-semibold"><span>Total</span><span data-testid="sale-total">{total===null ? '—' : purchaseMoney(total)}</span></div><p className="mt-2 text-sm text-muted">{customer?.name} · {items.fields.length} items</p></CardContent></Card>
      <fieldset disabled={pending || (writingStarted && !correctingPayment)} className="space-y-4"><div className="grid grid-cols-2 gap-2"><Button variant={receiveNow ? 'primary' : 'secondary'} onClick={() => setReceiveNow(true)}>Receive now</Button><Button variant={!receiveNow ? 'primary' : 'secondary'} onClick={() => setReceiveNow(false)}>Pay later</Button></div>{receiveNow && paymentLimit!==0 ? <PaymentFields form={payment} /> : <p className="text-sm text-muted">{paymentLimit===0 ? 'No payment is needed for a settled or zero-total sale.' : 'Collect the remaining money later from Outstanding.'}</p>}</fieldset>
      <div className="flex justify-between rounded-xl bg-line/50 p-4 font-semibold"><span>Remaining due</span><span data-testid="sale-remaining">{remaining===null ? '—' : purchaseMoney(remaining)}</span></div>
      {!configured && !identity.isPending ? <Card><CardContent className="space-y-3"><p className="font-semibold">Set up invoice business information</p><p className="text-sm text-muted">Add your shop name, address and contact in Settings before issuing the first invoice. Your draft stays here while you review the form in a separate tab.</p><ActionLink secondary to="/settings" target="_blank" rel="noopener">Open shop settings</ActionLink><Button variant="secondary" onClick={() => void identity.refetch()}>Recheck shop information</Button>{identity.isError ? <p role="alert">{identity.error.message}</p> : null}</CardContent></Card> : null}
      {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{savedSale ? 'The sale is already saved. ' : ''}{error} {correctingPayment ? 'The payment was rejected. Correct its fields or choose Pay later; the saved sale will be reused.' : 'Retry continues the same sale and receipt.'}</p> : null}
      {savedSale && error ? <ActionLink secondary to={`/customers/${customer!.uuid}/purchases/${savedSale.uuid}`}>Open saved sale</ActionLink> : null}
      <div className="sticky-actions space-y-2">{progress ? <p role="status" className="text-sm text-muted">{progress}</p> : null}<Button className="w-full" loading={pending} disabled={!configured || archived} onClick={() => { if (writingStarted && !correctingPayment) { void complete(paymentInput.current); return }; if (!receiveNow || paymentLimit===0) { void complete(null); return }; void payment.handleSubmit(values => complete(values))() }}>{writingStarted ? needsNewInvoiceKey ? 'Retry invoice with a new number' : 'Continue saved sale' : 'Complete Sale'}</Button>{!writingStarted ? <Button variant="ghost" className="w-full" disabled={pending} onClick={() => setStep(1)}>Back to items</Button> : null}</div>
    </>}
    {step<2 && error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
     <CustomerCreateSheet open={sheet==='customer'} onClose={closeSheet} onCreated={choose} onDirtyChange={setChildDirty} onPendingChange={setChildPending} confirmation={sheet==='customer' ? sheetConfirmation : undefined} />
     <Sheet open={sheet==='prescription'} title="New prescription" onClose={closeSheet} pending={childPending} confirmation={sheet==='prescription' ? sheetConfirmation : undefined}>{sheet==='prescription' && customer ? <InlinePrescription customer={customer.uuid} onDirtyChange={setChildDirty} onPendingChange={setChildPending} onReview={()=>{ setSheet(null); setChildDirty(false); void rx.refetch() }} onSaved={record => { setPrescription(record); form.setValue('prescription_uuid',record.uuid,{ shouldDirty: true }); setSheet(null); setChildDirty(false); void rx.refetch() }} /> : null}</Sheet>
    <ConfirmationDialog open={blocker.state==='blocked'} title={pending || childPending ? 'Save in progress' : 'Discard unsaved changes?'} description={pending || childPending ? 'Wait until the current operation finishes.' : savedSale ? 'The sale is already saved. Unsaved payment/invoice steps can be completed from its detail page.' : 'Unsaved sale fields will be discarded. Customers and prescriptions you already saved remain available.'} confirmLabel="Discard changes" cancelLabel="Keep editing" danger pending={pending || childPending} onCancel={() => { if (blocker.state==='blocked') blocker.reset() }} onConfirm={() => { if (blocker.state==='blocked' && !pending && !childPending) blocker.proceed() }} />
  </div>
}
