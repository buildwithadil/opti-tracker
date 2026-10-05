import { z } from 'zod'
import { isUtcIsoTimestamp } from './time.js'

const text = (max: number, multiline = false) => z.string().refine(value => !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(multiline ? value.replaceAll('\n', '') : value), 'Remove unsupported control characters.').trim().min(1, 'This field is required.').max(max)
export const invoiceIdentitySchema = z.object({
  shop_name: text(200), address: text(2000, true),
  contact_number: text(32).regex(/^[+()\d -]+$/u, 'Use a contact number, including country/area code where needed.').refine(value => { const digits = value.replace(/\D/gu, ''); return digits.length >= 7 && digits.length <= 15 }, 'Use 7–15 digits for the shop contact number.'),
  gstin: z.string().trim().toUpperCase().max(15).refine(value => !value || /^\d{2}[A-Z0-9]{13}$/u.test(value), 'Use the actual 15-character GSTIN, or leave blank.').nullable().transform(value => value || null),
  updated_at: z.string().refine(isUtcIsoTimestamp, 'Reload the business information before saving.'),
}).strict()
export type InvoiceIdentityInput = z.input<typeof invoiceIdentitySchema>
export const invoiceGenerateSchema = z.object({ client_request_id: z.string().uuid().toLowerCase() }).strict()
