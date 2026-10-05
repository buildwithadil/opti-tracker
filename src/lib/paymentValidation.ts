import { z } from 'zod'
import { paymentCreateSchema } from '../../shared/paymentValidation'
import { parseRupeesToPaise } from '../../shared/money'

export function localPaymentTime(utc = new Date().toISOString()): string {
  const date = new Date(utc)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
const formFields = z.object({
  ...paymentCreateSchema.shape,
  received_at: z.string().refine(value => {
    const date = new Date(value)
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value) && !Number.isNaN(date.getTime()) && localPaymentTime(date.toISOString()) === value
  }, 'Enter a real local date and time.').transform(value => new Date(value).toISOString()),
}).strict().transform((value, context) => {
  const parsed = paymentCreateSchema.safeParse(value)
  if (parsed.success) return parsed.data
  parsed.error.issues.forEach(issue => context.addIssue({ code: 'custom', path: issue.path, message: issue.message }))
  return z.NEVER
})
export function paymentFormSchema(outstandingPaise: number, purchaseDate: string) {
  return formFields.superRefine((value, context) => {
    if (parseRupeesToPaise(value.amount) > outstandingPaise) context.addIssue({ code: 'custom', path: ['amount'], message: 'Payment cannot exceed the outstanding balance.' })
    if (value.received_at < `${purchaseDate}T00:00:00.000Z`) context.addIssue({ code: 'custom', path: ['received_at'], message: 'Payment time cannot precede the purchase date (UTC).' })
  })
}
export type PaymentFormValues = z.input<typeof formFields>
export type PaymentSaveValues = z.output<typeof formFields>
