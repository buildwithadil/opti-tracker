import type { UseFormReturn } from 'react-hook-form'
import { paymentMethods, paymentMethodLabels } from '../../shared/payments'
import type { PaymentFormValues, PaymentSaveValues } from '../lib/paymentValidation'
import { Field, TextInput } from './ui/Field'
import { Disclosure } from './ui/ShopUI'

export function PaymentFields({ form }: { form: UseFormReturn<PaymentFormValues,unknown,PaymentSaveValues> }) {
  const errors=form.formState.errors
  return <div className="space-y-5"><Field id="payment-amount" label="Payment amount (₹)" error={errors.amount?.message}><TextInput id="payment-amount" inputMode="decimal" maxLength={24} aria-invalid={!!errors.amount} {...form.register('amount')} /></Field>
    <fieldset><legend className="mb-2 text-[13px] font-medium">Method</legend><div className="grid grid-cols-3 gap-2">{paymentMethods.map(method => <label key={method} className="relative cursor-pointer"><input className="peer absolute inset-0 size-full cursor-pointer opacity-0" type="radio" value={method} {...form.register('payment_method')} /><span className="pointer-events-none flex min-h-11 items-center justify-center rounded-[10px] border border-line bg-white text-sm font-semibold peer-checked:border-accent peer-checked:bg-accent/8 peer-checked:text-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2">{paymentMethodLabels[method]}</span></label>)}</div></fieldset>
    <Disclosure title="Payment details (optional)" invalid={!!errors.received_at || !!errors.reference || !!errors.notes}><Field id="payment-time" label="Payment date and time" error={errors.received_at?.message}><TextInput id="payment-time" type="datetime-local" aria-invalid={!!errors.received_at} aria-describedby={errors.received_at ? 'payment-time-error' : undefined} {...form.register('received_at')} /></Field><Field id="payment-reference" label="Transaction / reference ID" error={errors.reference?.message}><TextInput id="payment-reference" maxLength={200} aria-invalid={!!errors.reference} aria-describedby={errors.reference ? 'payment-reference-error' : undefined} {...form.register('reference')} /></Field><Field id="payment-notes" label="Payment note" error={errors.notes?.message}><textarea id="payment-notes" className="min-h-24 w-full rounded-xl border border-line p-3" maxLength={2000} aria-invalid={!!errors.notes} aria-describedby={errors.notes ? 'payment-notes-error' : undefined} {...form.register('notes')} /></Field></Disclosure>
  </div>
}
