import { useCallback, useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useBeforeUnload, useBlocker, useNavigate, useParams } from 'react-router-dom'
import { useFieldArray, useForm, useWatch, type FieldPath } from 'react-hook-form'
import { Plus, Trash2 } from 'lucide-react'
import type { Customer } from '../../shared/customers'
import type { Prescription } from '../../shared/prescriptions'
import { purchaseCategories, purchaseCategoryLabels } from '../../shared/purchases'
import { purchaseAmounts } from '../../shared/purchaseValidation'
import { calculateLineTotal, parseRupeesToPaise } from '../../shared/money'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { ConfirmationDialog } from '../components/ui/ConfirmationDialog'
import { Field, TextInput } from '../components/ui/Field'
import { PageHeader } from '../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../components/ui/States'
import { customerErrorMessage, customerKeys, customersApi } from '../lib/customers'
import { prescriptionDate, prescriptionErrorMessage, prescriptionKeys, prescriptionsApi } from '../lib/prescriptions'
import { isDuplicatePurchase, purchaseErrorMessage, purchaseFieldErrors, purchaseKeys, purchaseMoney, purchasesApi } from '../lib/purchases'
import { purchaseFormSchema, type PurchaseFormValues, type PurchaseSaveValues } from '../lib/purchaseValidation'

export function PurchaseCreatePage() {
  const { uuid = '' } = useParams()
  const customer = useQuery({ queryKey: customerKeys.detail(uuid), queryFn: ({ signal }) => customersApi.detail(uuid, signal), retry: false })
  if (customer.isPending) return <LoadingState label="Loading purchase form…" />
  if (customer.isError) return <div className="space-y-5"><Link to="/customers" className="text-sm text-ink underline">Back to customers</Link><ErrorState title="Customer could not be loaded" description={customerErrorMessage(customer.error)} onRetry={() => void customer.refetch()} /></div>
  if (customer.data.archived_at) return <div className="space-y-5"><Link to={`/customers/${uuid}`} className="text-sm text-ink underline">Back to customer</Link><PageHeader eyebrow="Purchase management" title="Purchase cannot be added" description="This customer is archived. Restore the customer before adding a purchase. Existing history remains readable." /></div>
  return <PurchaseForm key={uuid} customer={customer.data} />
}

const newItem = () => ({ description: '', product_category: 'spectacle_frames' as const, quantity: '1', unit_price: '', discount: '0' })
function defaults(): PurchaseFormValues {
  const today = new Date()
  return { client_request_id: crypto.randomUUID(), purchase_date: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`, prescription_uuid: '', notes: '', order_discount: '0', items: [newItem()] }
}
function linePreview(item?: PurchaseFormValues['items'][number]) {
  try {
    if (!item || !/^[1-9][0-9]*$/u.test(item.quantity) || Number(item.quantity) > 100000) return null
    return calculateLineTotal({ quantity: Number(item.quantity), unitPricePaise: parseRupeesToPaise(item.unit_price), discountPaise: parseRupeesToPaise(item.discount ?? '0') })
  } catch { return null }
}
const prescriptionLabel = (record: Prescription) => `${prescriptionDate(record.prescribed_on)} · Version ${record.revision_number} · ${record.status} · ${record.uuid.slice(0, 8)}`

function PurchaseForm({ customer }: { customer: Customer }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const submissionLock = useRef(false)
  const saved = useRef(false)
  const errorFocus = useRef<FieldPath<PurchaseFormValues> | null>(null)
  const [prescriptionPage, setPrescriptionPage] = useState(1)
  const [selectedPrescription, setSelectedPrescription] = useState<Prescription | null>(null)
  const [initialValues] = useState(defaults)
  const form = useForm<PurchaseFormValues, unknown, PurchaseSaveValues>({ resolver: zodResolver(purchaseFormSchema), defaultValues: initialValues })
  const items = useFieldArray({ control: form.control, name: 'items' })
  const watched = useWatch({ control: form.control })
  const prescriptionQuery = { page: prescriptionPage, pageSize: 20 }
  const prescriptions = useQuery({ queryKey: prescriptionKeys.list(customer.uuid, prescriptionQuery), queryFn: ({ signal }) => prescriptionsApi.list(customer.uuid, prescriptionQuery, signal), retry: false })
  const save = useMutation({
    mutationFn: (values: PurchaseSaveValues) => purchasesApi.create(customer.uuid, values),
    onSuccess: async result => {
      saved.current = true
      queryClient.setQueryData(purchaseKeys.detail(customer.uuid, result.uuid), result)
      await queryClient.invalidateQueries({ queryKey: purchaseKeys.customer(customer.uuid) })
      form.reset()
      navigate(`/customers/${customer.uuid}/purchases/${result.uuid}`, { replace: true, state: { purchaseNotice: 'Purchase saved. The original item details and prices are preserved.' } })
    },
    onError: error => {
      if (isDuplicatePurchase(error)) saved.current = true
      const fields = purchaseFieldErrors(error)
      fields.forEach(({ field, message }) => form.setError(field as FieldPath<PurchaseFormValues>, { type: 'server', message }))
      errorFocus.current = fields[0]?.field as FieldPath<PurchaseFormValues> ?? null
    },
  })
  const pending = form.formState.isSubmitting || save.isPending
  const duplicate = isDuplicatePurchase(save.error)
  useEffect(() => {
    if (!pending && errorFocus.current) { form.setFocus(errorFocus.current); errorFocus.current = null }
  }, [pending, save.error, form])
  const shouldWarn = (form.formState.isDirty && !duplicate) || pending
  const blocker = useBlocker(() => !saved.current && shouldWarn)
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (!saved.current && shouldWarn) { event.preventDefault(); event.returnValue = '' }
  }, [shouldWarn]))
  let preview: ReturnType<typeof purchaseAmounts> | null = null
  try {
    if (watched.items?.length && watched.items.every(item => !!item && linePreview(item as PurchaseFormValues['items'][number]) !== null)) {
      preview = purchaseAmounts({ items: watched.items.map(item => ({ quantity: Number(item.quantity), unit_price: item.unit_price ?? '', discount: item.discount })), order_discount: watched.order_discount })
    }
  } catch { /* Incomplete/invalid monetary fields have no misleading preview. */ }
  const errors = form.formState.errors
  const text = (name: FieldPath<PurchaseFormValues>, label: string, options: { type?: 'text' | 'date'; inputMode?: 'decimal' | 'numeric'; maxLength?: number; hint?: string; required?: boolean } = {}) => {
    const id = `purchase-${name.replaceAll('.', '-')}`
    const error = form.getFieldState(name, form.formState).error?.message
    return <Field id={id} label={label} error={error} hint={options.hint}><TextInput id={id} type={options.type ?? 'text'} inputMode={options.inputMode} maxLength={options.maxLength} autoComplete="off" aria-required={options.required || undefined} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : options.hint ? `${id}-hint` : undefined} {...form.register(name)} /></Field>
  }
  const cancelPath = `/customers/${customer.uuid}`
  return <div className="space-y-7 [overflow-wrap:anywhere]">
    <Link to={cancelPath} className="text-sm font-medium text-ink underline underline-offset-4">Back to customer</Link>
    <PageHeader eyebrow={`Purchase · ${customer.name}`} title="Add purchase" description="Record the items and their original prices. Saved purchases are permanent, read-only records." />
    <form className="max-w-5xl space-y-6" noValidate aria-label="New purchase" onSubmit={event => {
      void form.handleSubmit(async values => {
        if (submissionLock.current || duplicate) return
        submissionLock.current = true
        save.reset()
        try { await save.mutateAsync(values) } catch { /* Keep values and the same submission key for a safe retry. */ }
        finally { submissionLock.current = false }
      })(event)
    }}>
      <fieldset disabled={pending || duplicate} className="min-w-0 space-y-6 disabled:opacity-70"><legend className="sr-only">Purchase for {customer.name}</legend>
        <Card><CardHeader><CardTitle>Purchase information</CardTitle></CardHeader><CardContent className="space-y-5">
          {text('purchase_date', 'Purchase date', { type: 'date', required: true })}
          <Field id="purchase-prescription" label="Link prescription (optional)" error={errors.prescription_uuid?.message} hint="Choose a specific version. A newer prescription will never replace this link.">
            <select id="purchase-prescription" value={watched.prescription_uuid ?? ''} className="h-11 w-full rounded-md border border-line bg-white px-3 text-sm text-ink" aria-invalid={!!errors.prescription_uuid} aria-describedby={errors.prescription_uuid ? 'purchase-prescription-error' : 'purchase-prescription-hint'} {...form.register('prescription_uuid', { onChange: event => setSelectedPrescription(prescriptions.data?.prescriptions.find(record => record.uuid === event.target.value) ?? null) })}>
              <option value="">No prescription</option>
              {selectedPrescription && !prescriptions.data?.prescriptions.some(record => record.uuid === selectedPrescription.uuid) ? <option key={selectedPrescription.uuid} value={selectedPrescription.uuid}>{prescriptionLabel(selectedPrescription)}</option> : null}
              {prescriptions.data?.prescriptions.map(record => <option key={record.uuid} value={record.uuid}>{prescriptionLabel(record)}</option>)}
            </select>
          </Field>
          {prescriptions.isPending ? <p className="text-xs text-muted" role="status">Loading prescription choices…</p> : prescriptions.isError ? <ErrorState title="Prescription choices could not be loaded" description={prescriptionErrorMessage(prescriptions.error)} onRetry={() => void prescriptions.refetch()} /> : !prescriptions.data?.pagination.total ? <p className="text-xs text-muted">No prescriptions recorded. You can save this purchase without one.</p> : <nav aria-label="Prescription selection pagination" className="flex flex-wrap items-center gap-3 text-xs text-muted"><span>Prescription page {prescriptionPage} of {prescriptions.data.pagination.totalPages}</span><Button variant="secondary" size="sm" disabled={prescriptionPage <= 1 || prescriptions.isFetching} onClick={() => setPrescriptionPage(value => value - 1)}>Previous prescriptions</Button><Button variant="secondary" size="sm" disabled={prescriptionPage >= Math.min(prescriptions.data.pagination.totalPages, 10000) || prescriptions.isFetching} onClick={() => setPrescriptionPage(value => value + 1)}>Next prescriptions</Button></nav>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Purchase items</CardTitle></CardHeader><CardContent className="space-y-6">
          <p className="text-sm leading-6 text-muted">Prices and discounts are rupee amounts, with up to two decimal places. A line discount applies to the whole line, not each unit.</p>
          {items.fields.map((item, index) => {
            const categoryId = `purchase-items-${index}-category`
            const line = linePreview(watched.items?.[index] as PurchaseFormValues['items'][number])
            return <fieldset key={item.id} className="min-w-0 space-y-5 rounded-md border border-line p-4"><legend className="px-1 text-sm font-semibold text-ink">Item {index + 1}</legend>
              {text(`items.${index}.description`, 'Product name / description', { maxLength: 500, required: true })}
              <Field id={categoryId} label="Product category" error={errors.items?.[index]?.product_category?.message}><select id={categoryId} className="h-11 w-full rounded-md border border-line bg-white px-3 text-sm text-ink" {...form.register(`items.${index}.product_category`)}>{purchaseCategories.map(value => <option key={value} value={value}>{purchaseCategoryLabels[value]}</option>)}</select></Field>
              <div className="grid gap-5 sm:grid-cols-3">{text(`items.${index}.quantity`, 'Quantity', { inputMode: 'numeric', maxLength: 6, required: true })}{text(`items.${index}.unit_price`, 'Unit price (₹)', { inputMode: 'decimal', maxLength: 24, required: true })}{text(`items.${index}.discount`, 'Line discount (₹)', { inputMode: 'decimal', maxLength: 24 })}</div>
              <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm tabular-nums text-ink">Line total: <span data-testid={`line-preview-${index}`}>{line === null ? '—' : purchaseMoney(line)}</span></p><Button variant="ghost" size="sm" icon={<Trash2 className="size-4" aria-hidden="true" />} onClick={() => { items.remove(index); form.clearErrors('items') }} aria-label={`Remove item ${index + 1}`}>Remove item</Button></div>
            </fieldset>
          })}
          {errors.items?.root?.message || errors.items?.message ? <p role="alert" className="text-sm text-red-700">{errors.items.root?.message ?? errors.items.message}</p> : null}
          {!items.fields.length ? <p className="text-sm text-muted">No items. Add at least one item before saving.</p> : null}
          <Button variant="secondary" icon={<Plus className="size-4" aria-hidden="true" />} disabled={items.fields.length >= 100} onClick={() => { items.append(newItem()); form.clearErrors('items') }}>Add item</Button>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Purchase total preview</CardTitle></CardHeader><CardContent className="space-y-5">
          {text('order_discount', 'Purchase discount (₹)', { inputMode: 'decimal', maxLength: 24, hint: 'Optional additional fixed discount after line discounts. Enter 0 for none.' })}
          <dl className="space-y-3 text-sm tabular-nums" aria-live="polite">{[['Subtotal', preview?.subtotalPaise], ['Line discounts', preview?.lineDiscountPaise], ['Total discount', preview?.discountPaise], ['Grand total', preview?.totalPaise]].map(([label, amount]) => <div key={label} className={`flex justify-between gap-4 ${label === 'Grand total' ? 'border-t border-line pt-4 text-base font-semibold' : ''}`}><dt>{label}</dt><dd data-testid={label === 'Grand total' ? 'purchase-total-preview' : undefined}>{typeof amount === 'number' ? purchaseMoney(amount) : '—'}</dd></div>)}</dl>
          {!preview ? <p className="text-xs text-muted">Enter valid quantities, prices and discounts to preview totals.</p> : null}
        </CardContent></Card>
        <Card><CardContent className="pt-6"><Field id="purchase-notes" label="Purchase notes" error={errors.notes?.message} hint="Optional. Up to 2,000 characters; line breaks are allowed."><textarea id="purchase-notes" className="min-h-28 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink aria-invalid:border-red-700" maxLength={2000} aria-invalid={!!errors.notes} aria-describedby={errors.notes ? 'purchase-notes-error' : 'purchase-notes-hint'} {...form.register('notes')} /></Field></CardContent></Card>
      </fieldset>
      {save.isError ? <p className="text-sm leading-6 text-red-700" role="alert">{purchaseErrorMessage(save.error)}{duplicate ? <Link to={cancelPath} className="ml-2 font-medium underline">View purchase history</Link> : null}</p> : null}
      <div className="flex flex-wrap gap-3"><Button type="submit" loading={pending} disabled={duplicate}>Save purchase</Button><Button variant="secondary" disabled={pending} onClick={() => navigate(cancelPath)}>Cancel</Button></div>
    </form>
    <ConfirmationDialog open={blocker.state === 'blocked'} title={pending ? 'Save in progress' : 'Discard unsaved changes?'} description={pending ? 'Wait for the purchase save to finish before leaving this page.' : 'Your changes have not been saved. Leaving this page will discard them.'} confirmLabel="Discard changes" cancelLabel="Keep editing" danger pending={pending} onCancel={() => { if (blocker.state === 'blocked') blocker.reset() }} onConfirm={() => { if (blocker.state === 'blocked' && !pending) blocker.proceed() }} />
  </div>
}
