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

const newItem = () => ({ description: '', product_category: 'spectacle_frames' as const, quantity: '1', unit_price: '', discount: '0' })

// Receipt eligibility starts at sale-date midnight UTC. Default to the current
// supported UTC date so an ordinary sale works before 05:30 IST as well.
function defaults(): PurchaseFormValues {
  return { client_request_id: crypto.randomUUID(), purchase_date: new Date().toISOString().slice(0, 10), prescription_uuid: '', notes: '', order_discount: '0', items: [newItem()] }
}

export function NewSalePage() {
  const location = useLocation()
  return <NewSaleFlow key={location.key} />
}

function NewSaleFlow() {
  const [params] = useSearchParams()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [step, setStep] = useState(0)
  const [sheet, setSheet] = useState<'customer' | 'prescription' | null>(null)
  const [childDirty, setChildDirty] = useState(false)
  const [childPending, setChildPending] = useState(false)
  const [discardSheet, setDiscardSheet] = useState(false)
  const [prescription, setPrescription] = useState<Prescription | null>(null)
  const [rxPage, setRxPage] = useState(1)
  const [initial] = useState(defaults)
  const [receiveNow, setReceiveNow] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const [done, setDone] = useState(false)
  const [savedSale, setSavedSale] = useState<PurchaseDetail | null>(null)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [needsNewInvoiceKey, setNeedsNewInvoiceKey] = useState(false)
  const [writingStarted, setWritingStarted] = useState(false)
  const [correctingPayment, setCorrectingPayment] = useState(false)
  const started = useRef(false)
  const paymentAttempted = useRef(false)
  const lock = useRef(false)
  const committed = useRef<PurchaseDetail | null>(null)
  const paid = useRef(false)
  const purchaseInput = useRef<PurchaseSaveValues | null>(null)
  const paymentInput = useRef<PaymentSaveValues | null>(null)
  const invoiceKey = useRef(crypto.randomUUID())
  const form = useForm<PurchaseFormValues, unknown, PurchaseSaveValues>({ resolver: zodResolver(purchaseFormSchema), defaultValues: initial })
  const items = useFieldArray({ control: form.control, name: 'items' })
  const watched = useWatch({ control: form.control })
  let total: number | null = null
  try {
    total = purchaseAmounts({ items: (watched.items ?? []).map(item => ({ quantity: Number(item.quantity), unit_price: item.unit_price ?? '', discount: item.discount })), order_discount: watched.order_discount }).totalPaise
  } catch {
    // Incomplete price/quantity has no false total.
  }
  const paymentLimit = correctingPayment && savedSale ? savedSale.outstanding_paise : total ?? 0
  const payment = useForm<PaymentFormValues, unknown, PaymentSaveValues>({ resolver: zodResolver(paymentFormSchema(paymentLimit, watched.purchase_date ?? initial.purchase_date)), defaultValues: { client_request_id: crypto.randomUUID(), amount: '', payment_method: 'cash', received_at: localPaymentTime(), reference: '', notes: '' } })
  const paymentAmount = useWatch({ control: payment.control, name: 'amount' })
  let remaining: number | null = null
  try {
    const received = receiveNow ? parseRupeesToPaise(paymentAmount || '0') : 0
    if (total !== null && received <= paymentLimit) remaining = paymentLimit - received
  } catch {
    // Invalid input is handled by the shared validator.
  }

  useEffect(() => {
    const uuid = params.get('customer')
    if (!uuid) return
    let alive = true
    void customersApi.detail(uuid).then(record => { if (alive) { setCustomer(record); setStep(1) } }).catch(failure => { if (alive) setError(failure.message) })
    return () => { alive = false }
  }, [params])
  const rx = useQuery({ queryKey: ['prescriptions', customer?.uuid, 'checkout', rxPage], queryFn: ({ signal }) => prescriptionsApi.list(customer!.uuid, { page: rxPage, pageSize: 10 }, signal), enabled: !!customer, staleTime: 0, retry: false })
  const identity = useQuery({ queryKey: invoiceKeys.identity, queryFn: ({ signal }) => invoicesApi.identity(signal), staleTime: 0, retry: false })
  const dirty = !done && (!!customer || form.formState.isDirty || payment.formState.isDirty || childDirty || pending)
  const blocker = useBlocker(() => dirty)
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }, [dirty]))
  const choose = (record: Customer) => { setCustomer(record); setRxPage(1); setStep(1); setSheet(null); setChildDirty(false); setError('') }
  const closeSheet = () => { if (childPending) return; if (childDirty) setDiscardSheet(true); else setSheet(null) }
  const sheetConfirmation = discardSheet ? { title: 'Discard unsaved changes?', description: 'The customer or prescription draft will be discarded.', onCancel: () => setDiscardSheet(false), onConfirm: () => { setDiscardSheet(false); setChildDirty(false); setSheet(null) }, pending: childPending } : undefined
  const continueToPayment = () => {
    void form.handleSubmit(values => { purchaseInput.current = values; if (!payment.formState.isDirty) payment.setValue('amount', formatPaise(asPaise(purchaseAmounts(values).totalPaise))); setStep(2) })()
  }

  async function complete(values: PaymentSaveValues | null) {
    if (lock.current || !customer || done) return
    lock.current = true
    setPending(true)
    setError('')
    let receiptRejected = false
    const recoveringSale = started.current
    try {
      // Freeze validated input and UUIDs once writes start; later retries resume
      // committed progress, including uncertain response recovery, not new sales.
      if (!purchaseInput.current) throw new Error('Review the items before completing the sale.')
      if (!committed.current) {
        if (!started.current) paymentInput.current = values
        started.current = true
        setWritingStarted(true)
        setProgress('Saving sale…')
        if (recoveringSale) {
          const recovered = await shopApi.sales({ customer_uuid: customer.uuid, submission_uuid: purchaseInput.current.client_request_id, pageSize: 1 })
          if (recovered.sales.length === 1) committed.current = await purchasesApi.detail(customer.uuid, recovered.sales[0].uuid)
        }
        try { if (!committed.current) committed.current = await purchasesApi.create(customer.uuid, purchaseInput.current) }
        catch (failure) {
          if (!isDuplicatePurchase(failure)) throw failure
          const recovered = await shopApi.sales({ customer_uuid: customer.uuid, submission_uuid: purchaseInput.current.client_request_id, pageSize: 1 })
          if (recovered.sales.length !== 1) throw new Error('Cannot confirm the saved sale. Check Sales before starting another.', { cause: failure })
          committed.current = await purchasesApi.detail(customer.uuid, recovered.sales[0].uuid)
        }
        setSavedSale(committed.current)
      }
      const sale = committed.current
      if (correctingPayment) { paymentInput.current = values; setCorrectingPayment(false) }
      if (paymentInput.current && !paid.current) {
        setProgress('Recording payment…')
        const recovered = paymentAttempted.current ? await shopApi.payments({ customer_uuid: customer.uuid, sale_uuid: sale.uuid, submission_uuid: paymentInput.current.client_request_id, pageSize: 1 }) : null
        if (recovered?.payments.length && (recovered.payments.length !== 1 || recovered.payments[0].amount_paise !== parseRupeesToPaise(paymentInput.current.amount) || recovered.payments[0].payment_method !== paymentInput.current.payment_method)) throw new Error('The saved receipt needs review before continuing.')
        try { if (!recovered?.payments.length) { paymentAttempted.current = true; await paymentsApi.create(customer.uuid, sale.uuid, paymentInput.current) } }
        catch (failure) {
          if (!isDuplicatePayment(failure)) { receiptRejected = failure instanceof ApiError && [400, 413, 409].includes(failure.status); throw failure }
          const recovered = await shopApi.payments({ customer_uuid: customer.uuid, sale_uuid: sale.uuid, submission_uuid: paymentInput.current.client_request_id, pageSize: 1 })
          if (recovered.payments.length !== 1 || recovered.payments[0].amount_paise !== parseRupeesToPaise(paymentInput.current.amount) || recovered.payments[0].payment_method !== paymentInput.current.payment_method) throw new Error('Cannot confirm this receipt. Check payment history before recording anything else.', { cause: failure })
        }
        paid.current = true
      }
      setProgress('Preparing invoice…')
      if (needsNewInvoiceKey) { invoiceKey.current = crypto.randomUUID(); setNeedsNewInvoiceKey(false) }
      const issued = await invoicesApi.generate(customer.uuid, sale.uuid, invoiceKey.current)
      const current = await purchasesApi.detail(customer.uuid, sale.uuid)
      setSavedSale(current)
      setInvoice(issued)
      client.setQueryData(invoiceKeys.purchase(customer.uuid, sale.uuid), issued)
      setDone(true)
      await refreshShop(client)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not complete the sale.')
      if (incompleteInvoice(failure)) setNeedsNewInvoiceKey(true)
      if (!committed.current && !recoveringSale && failure instanceof ApiError && [400, 413, 409].includes(failure.status) && !isDuplicatePurchase(failure)) {
        started.current = false
        setWritingStarted(false)
        const fields = purchaseFieldErrors(failure)
        fields.forEach(field => form.setError(field.field as FieldPath<PurchaseFormValues>, { message: field.message }))
        if (fields.length) setStep(1)
      }
      if (receiptRejected && committed.current && !paid.current) {
        paymentAttempted.current = false
        paymentInput.current = null
        setCorrectingPayment(true)
        paymentFieldErrors(failure).forEach(field => payment.setError(field.field, { message: field.message }))
        try { setSavedSale(await purchasesApi.detail(customer.uuid, committed.current.uuid)) } catch { /* Keep the saved-sale link and original error if refresh is unavailable. */ }
      }
    } finally {
      setPending(false)
      setProgress('')
      lock.current = false
    }
  }

  const archived = !!customer?.archived_at
  const configured = identity.data && !!identity.data.shop_name.trim() && !!identity.data.address.trim() && !!identity.data.contact_number.trim()
  if (done && savedSale && invoice && customer) return <div className="mx-auto max-w-2xl space-y-6"><div className="flex size-12 items-center justify-center rounded-full bg-accent-tint text-accent"><Check className="size-6" aria-hidden="true" /></div><PageHeader title="Sale completed" description={`${customer.name} · ${invoice.invoice_number}`} /><section className="border-y border-line py-5"><p className="text-sm text-muted">Total</p><p className="mt-1 text-[32px] font-semibold tracking-tight tabular-nums" data-testid="completed-total">{purchaseMoney(savedSale.total_paise)}</p><dl className="mt-5 grid grid-cols-2 divide-x divide-line"><div className="pr-4"><dt className="text-sm text-muted">Paid</dt><dd className="mt-1 font-semibold tabular-nums" data-testid="completed-paid">{purchaseMoney(savedSale.amount_paid_paise)}</dd></div><div className="pl-4"><dt className="text-sm text-muted">Due</dt><dd className="mt-1 font-semibold tabular-nums" data-testid="completed-due">{purchaseMoney(savedSale.outstanding_paise)}</dd></div></dl></section><ActionLink to={`/customers/${customer.uuid}/purchases/${savedSale.uuid}/invoice`} state={{ printInvoice: true }} className="w-full">Print Invoice</ActionLink><div className="grid grid-cols-2 gap-3"><ActionLink secondary to={`/customers/${customer.uuid}/purchases/${savedSale.uuid}`}>View sale</ActionLink>{savedSale.outstanding_paise > 0 ? <ActionLink secondary to={`/receive-payment?customer=${customer.uuid}&sale=${savedSale.uuid}`}>Receive Payment</ActionLink> : <ActionLink secondary to="/dashboard">Home</ActionLink>}</div><Button variant="secondary" className="w-full" onClick={() => navigate('/sales/new')}>New Sale</Button></div>

  return <div className="mx-auto max-w-3xl space-y-7">
    <PageHeader eyebrow={customer ? 'Sale' : undefined} title="New Sale" description={customer ? `For ${customer.name}` : 'Start with a customer.'} />
    {error && step < 2 ? <p role="alert" className="border-y border-line py-3 text-sm text-accent">{error}</p> : null}
    {archived ? <p role="alert" className="border-y border-line py-4 text-sm">Restore this customer before making a sale. <ActionLink secondary to={`/customers/${customer!.uuid}`}>Open customer</ActionLink></p> : !customer ? <section aria-label="Customer" className="space-y-4"><div><h2 className="text-[19px] font-semibold">Customer</h2><p className="mt-1 text-sm text-muted">Search by name or mobile.</p></div><CustomerPicker onSelect={choose} /><Button variant="secondary" className="w-full sm:w-auto" onClick={() => setSheet('customer')}><Plus className="size-4" aria-hidden="true" />Add customer</Button></section> : <>
      <section aria-label="Selected customer" className="flex items-center justify-between gap-4 border-y border-line py-4"><div className="min-w-0"><p className="text-sm text-muted">Customer</p><p className="mt-1 truncate font-semibold">{customer.name}</p><p className="text-sm text-muted">{customer.phone}</p></div><Button variant="ghost" size="sm" onClick={() => { if (!writingStarted) { setCustomer(null); setStep(0); setPrescription(null); form.setValue('prescription_uuid', '') } }}>Change</Button></section>
      <form noValidate aria-label="Sale items" className="space-y-7" onSubmit={event => { event.preventDefault(); continueToPayment() }}>
        <section aria-labelledby="items-title"><div className="mb-2 flex items-end justify-between gap-3"><div><h2 id="items-title" className="text-[19px] font-semibold">Items</h2><p className="mt-1 text-sm text-muted">Add what the customer is buying.</p></div><span className="text-sm text-muted">{items.fields.length} {items.fields.length === 1 ? 'item' : 'items'}</span></div><div className="border-y border-line">
          {items.fields.map((item, index) => <fieldset key={item.id} className="space-y-4 py-5" aria-label={`Item ${index + 1}`}><div className="flex items-center justify-between gap-3"><legend className="font-semibold">Item {index + 1}</legend>{items.fields.length > 1 ? <Button variant="ghost" size="sm" aria-label={`Remove item ${index + 1}`} onClick={() => items.remove(index)}><Trash2 className="size-4" aria-hidden="true" /></Button> : null}</div><div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]"><Field id={`item-${index}-description`} label="Product name / description" error={form.formState.errors.items?.[index]?.description?.message}><TextInput id={`item-${index}-description`} maxLength={500} placeholder="e.g. Acetate frame" {...form.register(`items.${index}.description`)} /></Field><Field id={`item-${index}-category`} label="Product category"><select id={`item-${index}-category`} className="h-11 w-full rounded-[10px] border border-line bg-white px-3" {...form.register(`items.${index}.product_category`)}>{purchaseCategories.map(category => <option value={category} key={category}>{purchaseCategoryLabels[category]}</option>)}</select></Field></div><div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3"><Field id={`item-${index}-quantity`} label="Quantity" error={form.formState.errors.items?.[index]?.quantity?.message}><TextInput id={`item-${index}-quantity`} inputMode="numeric" maxLength={6} {...form.register(`items.${index}.quantity`)} /></Field><Field id={`item-${index}-price`} label="Unit price (₹)" error={form.formState.errors.items?.[index]?.unit_price?.message}><TextInput id={`item-${index}-price`} inputMode="decimal" maxLength={24} placeholder="0.00" {...form.register(`items.${index}.unit_price`)} /></Field></div><Disclosure title="Line discount" invalid={!!form.formState.errors.items?.[index]?.discount}><Field id={`item-${index}-discount`} label="Line discount (₹)" error={form.formState.errors.items?.[index]?.discount?.message}><TextInput id={`item-${index}-discount`} inputMode="decimal" {...form.register(`items.${index}.discount`)} /></Field></Disclosure></fieldset>)}
        </div><Button variant="secondary" className="mt-3" onClick={() => items.append(newItem())} disabled={items.fields.length >= 100}><Plus className="size-4" aria-hidden="true" />Add item</Button></section>
        <section aria-labelledby="prescription-title" className="border-y border-line py-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="prescription-title" className="font-semibold">Prescription <span className="font-normal text-muted">· optional</span></h2><p className="mt-1 text-sm text-muted">Attach an existing prescription or add one.</p></div><Button variant="secondary" aria-label="New prescription" onClick={() => setSheet('prescription')}>Add prescription</Button></div>{watched.prescription_uuid ? <p className="mt-4 text-sm text-muted">Attached: {prescription ? `${prescriptionDate(prescription.prescribed_on)} · version ${prescription.revision_number}` : 'Selected prescription'}</p> : null}<div className="mt-4"><Disclosure title="Choose existing prescription"><Field id="sale-prescription" label="Select prescription" labelHidden><select id="sale-prescription" className="h-11 w-full rounded-[10px] border border-line bg-white px-3" value={watched.prescription_uuid ?? ''} onChange={event => { form.setValue('prescription_uuid', event.target.value, { shouldDirty: true }); setPrescription(rx.data?.prescriptions.find(record => record.uuid === event.target.value) ?? null) }}><option value="">No prescription</option>{prescription && !rx.data?.prescriptions.some(record => record.uuid === prescription.uuid) ? <option value={prescription.uuid}>{prescriptionDate(prescription.prescribed_on)} · Version {prescription.revision_number}</option> : null}{rx.data?.prescriptions.map(record => <option key={record.uuid} value={record.uuid}>{prescriptionDate(record.prescribed_on)} · Version {record.revision_number} · {record.status}</option>)}</select></Field>{rx.isError ? <p role="alert" className="mt-3 text-sm text-accent">{rx.error.message} <Button variant="ghost" size="sm" onClick={() => void rx.refetch()}>Retry</Button></p> : null}{(rx.data?.pagination.totalPages ?? 1) > 1 ? <div className="mt-3 flex gap-2"><Button variant="secondary" size="sm" disabled={rxPage <= 1} onClick={() => setRxPage(value => value - 1)}>Previous</Button><Button variant="secondary" size="sm" disabled={rxPage >= Math.min(rx.data!.pagination.totalPages, 10000)} onClick={() => setRxPage(value => value + 1)}>Next</Button></div> : null}</Disclosure></div></section>
        <Disclosure title="More sale details" invalid={!!form.formState.errors.order_discount || !!form.formState.errors.purchase_date || !!form.formState.errors.notes}><div className="space-y-4"><Field id="sale-discount" label="Sale discount (₹)" error={form.formState.errors.order_discount?.message}><TextInput id="sale-discount" inputMode="decimal" {...form.register('order_discount')} /></Field><Field id="sale-date" label="Sale date" error={form.formState.errors.purchase_date?.message}><TextInput id="sale-date" type="date" {...form.register('purchase_date')} /></Field><Field id="sale-notes" label="Sale notes" error={form.formState.errors.notes?.message}><textarea id="sale-notes" className="min-h-24 w-full rounded-[10px] border border-line bg-white p-3" maxLength={2000} {...form.register('notes')} /></Field></div></Disclosure>
        {step < 2 ? <div className="sticky-actions space-y-3"><div className="flex items-baseline justify-between border-t border-line pt-4"><span className="text-sm text-muted">Total</span><span className="text-2xl font-semibold tabular-nums" data-testid="sale-total">{total === null ? '—' : purchaseMoney(total)}</span></div><Button type="submit" className="w-full">Continue to payment</Button></div> : null}
      </form>
      {step >= 2 ? <section aria-labelledby="payment-title" className="space-y-5 border-t border-line pt-6"><div><h2 id="payment-title" className="text-[19px] font-semibold">Payment</h2><p className="mt-1 text-sm text-muted">Collect now or leave the balance outstanding.</p></div><div className="grid grid-cols-3 divide-x divide-line border-y border-line py-4"><div className="pr-3"><p className="text-sm text-muted">Total</p><p className="mt-1 font-semibold tabular-nums" data-testid="sale-total">{total === null ? '—' : purchaseMoney(total)}</p></div><div className="px-3"><p className="text-sm text-muted">Paid</p><p className="mt-1 font-semibold tabular-nums">{receiveNow && paymentAmount ? `₹${paymentAmount}` : '₹0.00'}</p></div><div className="pl-3"><p className="text-sm text-muted">Due</p><p className="mt-1 font-semibold tabular-nums" data-testid="sale-remaining">{remaining === null ? '—' : purchaseMoney(remaining)}</p></div></div><fieldset disabled={pending || (writingStarted && !correctingPayment)} className="space-y-4"><legend className="sr-only">Payment options</legend><div className="grid grid-cols-2 gap-2"><Button variant={receiveNow ? 'primary' : 'secondary'} onClick={() => setReceiveNow(true)}>Paid now</Button><Button variant={!receiveNow ? 'primary' : 'secondary'} onClick={() => setReceiveNow(false)}>Pay later</Button></div>{receiveNow && paymentLimit !== 0 ? <PaymentFields form={payment} /> : <p className="text-sm text-muted">{paymentLimit === 0 ? 'No payment is needed for this sale.' : 'Collect the remaining money later from Outstanding.'}</p>}</fieldset>{!configured && !identity.isPending ? <section className="border-y border-line py-4"><p className="font-semibold">Shop details needed for the invoice</p><p className="mt-1 text-sm text-muted">Add shop name, address, and contact in Settings. Your sale stays here while you do that.</p><div className="mt-3 flex flex-wrap gap-2"><ActionLink secondary to="/settings" target="_blank" rel="noopener">Open settings</ActionLink><Button variant="ghost" onClick={() => void identity.refetch()}>Recheck</Button></div>{identity.isError ? <p role="alert" className="mt-3 text-sm text-accent">{identity.error.message}</p> : null}</section> : null}{error ? <p role="alert" className="border-y border-line py-3 text-sm text-accent">{savedSale ? 'The sale is already saved. ' : ''}{error} {correctingPayment ? 'Correct the payment to continue.' : 'Retry continues the same sale.'}</p> : null}{savedSale && error ? <ActionLink secondary to={`/customers/${customer!.uuid}/purchases/${savedSale.uuid}`}>Open saved sale</ActionLink> : null}<div className="sticky-actions space-y-2">{progress ? <p role="status" className="text-sm text-muted">{progress}</p> : null}<Button className="w-full" loading={pending} disabled={!configured || archived} onClick={() => { if (writingStarted && !correctingPayment) { void complete(paymentInput.current); return } if (!receiveNow || paymentLimit === 0) { void complete(null); return } void payment.handleSubmit(values => complete(values))() }}>{writingStarted ? needsNewInvoiceKey ? 'Retry invoice with a new number' : 'Continue saved sale' : 'Complete Sale'}</Button><Button variant="ghost" className="w-full" disabled={pending} onClick={() => setStep(1)}>Back to items</Button></div></section> : null}
    </>}
    <CustomerCreateSheet open={sheet === 'customer'} onClose={closeSheet} onCreated={choose} onDirtyChange={setChildDirty} onPendingChange={setChildPending} confirmation={sheet === 'customer' ? sheetConfirmation : undefined} />
    <Sheet open={sheet === 'prescription'} title="New prescription" onClose={closeSheet} pending={childPending} confirmation={sheet === 'prescription' ? sheetConfirmation : undefined}>{sheet === 'prescription' && customer ? <InlinePrescription customer={customer.uuid} onDirtyChange={setChildDirty} onPendingChange={setChildPending} onReview={() => { setSheet(null); setChildDirty(false); void rx.refetch() }} onSaved={record => { setPrescription(record); form.setValue('prescription_uuid', record.uuid, { shouldDirty: true }); setSheet(null); setChildDirty(false); void rx.refetch() }} /> : null}</Sheet>
    <ConfirmationDialog open={blocker.state === 'blocked'} title={pending || childPending ? 'Save in progress' : 'Discard unsaved changes?'} description={pending || childPending ? 'Wait until the current operation finishes.' : savedSale ? 'The sale is already saved. Unsaved payment steps can be completed from its detail page.' : 'Unsaved sale fields will be discarded. Customers and prescriptions you saved remain available.'} confirmLabel="Discard changes" cancelLabel="Keep editing" danger pending={pending || childPending} onCancel={() => { if (blocker.state === 'blocked') blocker.reset() }} onConfirm={() => { if (blocker.state === 'blocked' && !pending && !childPending) blocker.proceed() }} />
  </div>
}
