import { useCallback, useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useBeforeUnload, useBlocker, useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import type { Customer } from '../../shared/customers'
import type { PurchaseDetail } from '../../shared/purchases'
import { asPaise, formatPaise } from '../../shared/money'
import { paymentMethods, paymentMethodLabels } from '../../shared/payments'
import { PurchasePaymentSummary } from '../components/PaymentSummary'
import { Button } from '../components/ui/Button'
import { ConfirmationDialog } from '../components/ui/ConfirmationDialog'
import { Field, TextInput } from '../components/ui/Field'
import { PageHeader } from '../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../components/ui/States'
import { customerErrorMessage, customerKeys, customersApi } from '../lib/customers'
import { paymentErrorCode, paymentErrorMessage, paymentFieldErrors, paymentKeys, paymentsApi, isDuplicatePayment, type PaymentFieldName } from '../lib/payments'
import { purchaseErrorMessage, purchaseKeys, purchasesApi } from '../lib/purchases'
import { localPaymentTime, paymentFormSchema, type PaymentFormValues, type PaymentSaveValues } from '../lib/paymentValidation'

export function PaymentCreatePage() {
  const { uuid = '', purchaseUuid = '' } = useParams()
  const customer = useQuery({ queryKey: customerKeys.detail(uuid), queryFn: ({ signal }) => customersApi.detail(uuid, signal), retry: false })
  const purchase = useQuery({ queryKey: purchaseKeys.detail(uuid, purchaseUuid), queryFn: ({ signal }) => purchasesApi.detail(uuid, purchaseUuid, signal), enabled: customer.isSuccess, retry: false })
  if (customer.isPending || (customer.isSuccess && purchase.isPending)) return <LoadingState label="Loading payment form…" />
  if (customer.isError) return <ErrorState title="Customer could not be loaded" description={customerErrorMessage(customer.error)} onRetry={() => void customer.refetch()} />
  if (purchase.isError) return <div className="space-y-5"><Link to={`/customers/${uuid}`} className="text-sm text-ink underline">Back to customer</Link><ErrorState title="Purchase could not be loaded" description={purchaseErrorMessage(purchase.error)} onRetry={() => void purchase.refetch()} /></div>
  if (!purchase.data) return <LoadingState label="Loading payment form…" />
  return <PaymentForm key={`${uuid}:${purchaseUuid}`} customer={customer.data} purchase={purchase.data} />
}

function PaymentForm({ customer, purchase }: { customer: Customer; purchase: PurchaseDetail }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const lock = useRef(false)
  const saved = useRef(false)
  const errorFocus = useRef<PaymentFieldName | null>(null)
  const [defaults] = useState<PaymentFormValues>(() => ({ client_request_id: crypto.randomUUID(), amount: formatPaise(asPaise(purchase.outstanding_paise)), payment_method: 'cash', received_at: localPaymentTime(), reference: '', notes: '' }))
  const form = useForm<PaymentFormValues, unknown, PaymentSaveValues>({ resolver: zodResolver(paymentFormSchema(purchase.outstanding_paise, purchase.purchase_date)), defaultValues: defaults })
  const backPath = `/customers/${customer.uuid}/purchases/${purchase.uuid}`
  const save = useMutation({
    mutationFn: (values: PaymentSaveValues) => paymentsApi.create(customer.uuid, purchase.uuid, values),
    onSuccess: async result => { saved.current = true; await Promise.all([queryClient.invalidateQueries({ queryKey: purchaseKeys.customer(customer.uuid), refetchType: 'all' }), queryClient.invalidateQueries({ queryKey: paymentKeys.customer(customer.uuid), refetchType: 'all' })]); form.reset(); navigate(backPath, { replace: true, state: { paymentNotice: `Payment recorded. ${paymentMethodLabels[result.payment.payment_method as typeof paymentMethods[number]] ?? result.payment.payment_method} payment saved.` } }) },
    onError: async error => { if (isDuplicatePayment(error)) saved.current = true; if (['PAYMENT_EXCEEDS_OUTSTANDING', 'PAYMENT_DUPLICATE'].includes(paymentErrorCode(error) ?? '')) await Promise.all([queryClient.invalidateQueries({ queryKey: purchaseKeys.customer(customer.uuid), refetchType: 'all' }), queryClient.invalidateQueries({ queryKey: paymentKeys.customer(customer.uuid), refetchType: 'all' })]); const fields = paymentFieldErrors(error); fields.forEach(({ field, message }) => form.setError(field, { type: 'server', message })); errorFocus.current = fields[0]?.field ?? null },
  })
  const pending = form.formState.isSubmitting || save.isPending
  const duplicate = isDuplicatePayment(save.error)
  useEffect(() => { if (!pending && errorFocus.current) { form.setFocus(errorFocus.current); errorFocus.current = null } }, [pending, save.error, form])
  const shouldWarn = (form.formState.isDirty && !duplicate) || pending
  const blocker = useBlocker(() => !saved.current && shouldWarn)
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => { if (!saved.current && shouldWarn) { event.preventDefault(); event.returnValue = '' } }, [shouldWarn]))
  const available = !customer.archived_at && purchase.outstanding_paise > 0 && !['void', 'refunded'].includes(purchase.status) && purchase.currency_code === 'INR'
  const errors = form.formState.errors
  const back = <Link to={backPath} className="text-sm font-medium text-ink underline underline-offset-4">Back to purchase</Link>
  if (!available && !form.formState.isDirty && !pending && !save.isError) return <div className="space-y-5">{back}<PageHeader eyebrow="Payment" title="Payment cannot be recorded" description={customer.archived_at ? 'Restore this customer before recording a payment.' : purchase.outstanding_paise === 0 ? 'This sale is fully paid.' : 'This historical sale cannot receive payments.'} /></div>
  return <div className="space-y-7">{back}<PageHeader eyebrow={`Payment · ${customer.name}`} title="Record Payment" description="Record what the customer paid." /><section className="max-w-3xl border-y border-line py-5"><PurchasePaymentSummary summary={purchase} /></section><section className="max-w-3xl space-y-5 border-y border-line py-5"><h2 className="text-[19px] font-semibold">Payment details</h2><form className="space-y-5" noValidate aria-label="Record payment" onSubmit={event => { void form.handleSubmit(async values => { if (lock.current || duplicate || !available) return; lock.current = true; save.reset(); try { await save.mutateAsync(values) } catch { /* Retain inputs and submission UUID for a safe retry. */ } finally { lock.current = false } })(event) }}><fieldset disabled={pending || duplicate} className="space-y-5 disabled:opacity-70"><legend className="sr-only">Record payment fields</legend><Field id="payment-amount" label="Payment amount (₹)" error={errors.amount?.message}><TextInput id="payment-amount" inputMode="decimal" maxLength={24} autoComplete="off" aria-required="true" aria-invalid={!!errors.amount} aria-describedby={errors.amount ? 'payment-amount-error' : 'payment-amount-hint'} {...form.register('amount')} /></Field><Field id="payment-method" label="Payment method" error={errors.payment_method?.message}><select id="payment-method" className="h-11 w-full rounded-[10px] border border-line bg-white px-3 text-base" aria-invalid={!!errors.payment_method} {...form.register('payment_method')}>{paymentMethods.map(method => <option key={method} value={method}>{paymentMethodLabels[method]}</option>)}</select></Field><Field id="payment-time" label="Payment date and time" error={errors.received_at?.message}><TextInput id="payment-time" type="datetime-local" aria-required="true" aria-invalid={!!errors.received_at} {...form.register('received_at')} /></Field><Field id="payment-reference" label="Transaction / reference ID" error={errors.reference?.message} hint="Optional."><TextInput id="payment-reference" maxLength={200} autoComplete="off" aria-invalid={!!errors.reference} {...form.register('reference')} /></Field><Field id="payment-notes" label="Payment note" error={errors.notes?.message} hint="Optional."><textarea id="payment-notes" className="min-h-28 w-full rounded-[10px] border border-line bg-white px-3 py-2 text-sm text-ink aria-invalid:border-accent" maxLength={2000} aria-invalid={!!errors.notes} {...form.register('notes')} /></Field></fieldset>{!available ? <p className="text-sm text-muted" role="alert">This sale can no longer receive a payment.</p> : null}{save.isError ? <p className="text-sm leading-6 text-accent" role="alert">{paymentErrorMessage(save.error)}{duplicate ? <Link to={backPath} className="ml-2 font-medium underline">View payment history</Link> : null}</p> : null}<div className="flex flex-wrap gap-3 border-t border-line pt-5"><Button type="submit" loading={pending} disabled={duplicate || !available}>Save payment</Button><Button variant="secondary" disabled={pending} onClick={() => navigate(backPath)}>Cancel</Button></div></form></section><ConfirmationDialog open={blocker.state === 'blocked'} title={pending ? 'Save in progress' : 'Discard unsaved changes?'} description={pending ? 'Wait for the payment save to finish before leaving this page.' : 'Your payment changes have not been saved. Leaving will discard them.'} confirmLabel="Discard changes" cancelLabel="Keep editing" danger pending={pending} onCancel={() => { if (blocker.state === 'blocked') blocker.reset() }} onConfirm={() => { if (blocker.state === 'blocked' && !pending) blocker.proceed() }} /></div>
}
