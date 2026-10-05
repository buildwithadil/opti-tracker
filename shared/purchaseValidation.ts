import { z } from 'zod'
import { purchaseCategories } from './purchases.js'
import { asPaise, calculateLineTotal, calculateTotals, parseRupeesToPaise } from './money.js'
const controls = /[\p{Cc}\p{Cf}\u2028\u2029]/u
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Use a date in YYYY-MM-DD format.').refine((value) => {
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}, 'Use a real calendar date.')

/** Keep money as decimal text until the worker's exact paise parser runs. */
export const rupeeAmountSchema = z.string().trim().max(24, 'The amount is too large.')
  .regex(/^\d+(?:\.\d{1,2})?$/u, 'Use a non-negative rupee amount with at most two decimal places.')
  .refine(value => { try { parseRupeesToPaise(value); return true } catch { return false } }, 'The amount is outside the supported integer-paise range.')
const uuid = z.string().uuid('Use a valid prescription UUID.').toLowerCase()
const cleanText = (label: string, max: number) => z.string()
  .refine(value => !controls.test(value), `${label} must not contain control characters.`)
  .transform(value => value.trim())
  .pipe(z.string().min(1, `Enter ${label.toLowerCase()}.`).max(max, `Use at most ${max} characters for ${label.toLowerCase()}.`))
const itemSchema = z.object({
  description: cleanText('a description', 500),
  product_category: z.enum(purchaseCategories),
  quantity: z.number().int('Quantity must be a whole number.').min(1).max(100000),
  unit_price: rupeeAmountSchema,
  discount: rupeeAmountSchema.default('0'),
}).strict().superRefine((item, context) => {
  try { calculateLineTotal({ quantity: item.quantity, unitPricePaise: parseRupeesToPaise(item.unit_price), discountPaise: parseRupeesToPaise(item.discount) }) }
  catch { context.addIssue({ code: 'custom', path: ['discount'], message: 'Check the line amount and discount. Discount cannot exceed quantity × unit price, and the amount must fit the supported range.' }) }
})

const bodySchema = z.object({
  client_request_id: z.string().uuid('Use a valid purchase submission UUID.').toLowerCase(),
  purchase_date: calendarDate,
  notes: z.string().refine(value => !controls.test(value.replaceAll('\n', '')), 'Notes may contain line breaks, but not other control characters.')
    .trim().max(2000, 'Use at most 2000 characters for purchase notes.').nullable().default(null).transform(value => value || null),
  prescription_uuid: uuid.nullable().default(null),
  order_discount: rupeeAmountSchema.default('0'),
  items: z.array(itemSchema).min(1, 'Add at least one purchase item.').max(100, 'A purchase may contain at most 100 items.'),
}).strict().superRefine((values, context) => {
  try { purchaseAmounts(values) }
  catch { context.addIssue({ code: 'custom', path: ['order_discount'], message: 'The combined discounts cannot exceed the subtotal. All totals must fit the supported integer-paise range.' }) }
})

/** Shared preview/backend computation. No rounding, binary-decimal arithmetic,
 * tax inference, or client-provided totals. Line discounts apply to the whole line. */
export function purchaseAmounts(values: { items: { quantity: number; unit_price: string; discount?: string }[]; order_discount?: string }) {
  const lines = values.items.map(item => ({ quantity: item.quantity, unitPricePaise: parseRupeesToPaise(item.unit_price), discountPaise: parseRupeesToPaise(item.discount ?? '0') }))
  return { ...calculateTotals(lines, parseRupeesToPaise(values.order_discount ?? '0')), lineTotals: lines.map(calculateLineTotal), orderDiscountPaise: parseRupeesToPaise(values.order_discount ?? '0'), lineDiscountPaise: calculateTotals(lines, asPaise(0)).discountPaise }
}

export const purchaseCreateSchema = bodySchema
export const purchaseItemSchema = itemSchema
export type PurchaseCreateValues = z.infer<typeof purchaseCreateSchema>
export type PurchaseItemInput = z.infer<typeof itemSchema>
export type PurchaseCreateInput = z.input<typeof purchaseCreateSchema>

export const purchaseCustomerPathSchema = z.object({ customerUuid: z.string().uuid('Use a valid customer UUID.').toLowerCase() }).strict()
export const purchaseItemPathSchema = z.object({
  customerUuid: z.string().uuid('Use a valid customer UUID.').toLowerCase(),
  purchaseUuid: z.string().uuid('Use a valid purchase UUID.').toLowerCase(),
}).strict()

function boundedInteger(max: number) {
  return z.string().regex(/^[1-9][0-9]*$/u, 'Use a positive whole number.')
    .transform(Number).pipe(z.number().int().min(1).max(max))
}
export const purchaseListSchema = z.object({
  page: boundedInteger(10000).default(1), pageSize: boundedInteger(50).default(20),
  dateFrom: calendarDate.optional(), dateTo: calendarDate.optional(), category: z.enum(purchaseCategories).optional(),
}).strict().refine(value => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, { path: ['dateTo'], message: 'The end date cannot precede the start date.' })
export type PurchaseListOptions = z.infer<typeof purchaseListSchema>
