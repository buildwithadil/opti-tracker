import { z } from 'zod'
import { parseRupeesToPaise } from './money.js'
import { paymentMethods } from './payments.js'
import { purchaseCreateSchema, purchaseItemPathSchema, purchaseListSchema, rupeeAmountSchema } from './purchaseValidation.js'
import { isUtcIsoTimestamp } from './time.js'

export const paymentCreateSchema = z.object({
  client_request_id: z.string().uuid('Use a valid payment submission UUID.').toLowerCase(),
  amount: rupeeAmountSchema.refine(value => { try { return parseRupeesToPaise(value) > 0 } catch { return false } }, 'Enter a payment amount greater than zero.'),
  payment_method: z.enum(paymentMethods),
  received_at: z.string().refine(value => isUtcIsoTimestamp(value) && value.slice(0, 4) >= '0001', 'Use a real UTC timestamp with millisecond precision.')
    .refine(value => value <= new Date().toISOString(), 'The payment date/time cannot be in the future.').default(() => new Date().toISOString()),
  reference: z.string().refine(value => !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value), 'Reference must not contain control characters.')
    .trim().max(200, 'Use at most 200 characters for the reference.').nullable().default(null).transform(value => value || null),
  notes: purchaseCreateSchema.shape.notes,
}).strict()
export type PaymentCreateInput = z.input<typeof paymentCreateSchema>
export type PaymentCreateValues = z.output<typeof paymentCreateSchema>
export const paymentPathSchema = purchaseItemPathSchema.extend({ paymentUuid: z.string().uuid('Use a valid payment UUID.').toLowerCase() })
export const paymentListSchema = z.object({ page: purchaseListSchema.shape.page, pageSize: purchaseListSchema.shape.pageSize }).strict()
export type PaymentListOptions = z.output<typeof paymentListSchema>
