import { z } from 'zod'
import type { Customer } from './customers.js'
import type { Payment, PaymentSummary } from './payments.js'
import { purchaseListSchema } from './purchaseValidation.js'

const uuid = z.string().uuid().toLowerCase()
const base = z.object({ page: purchaseListSchema.shape.page, pageSize: purchaseListSchema.shape.pageSize,
  search: z.string().refine(value => !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value), 'Search cannot contain control characters.').trim().max(100).default(''),
  customer_uuid: uuid.optional(), submission_uuid: uuid.optional(),
})
export const salesQuerySchema = base.extend({ status: z.enum(['all','due','paid']).default('all'), dateFrom: purchaseListSchema.shape.dateFrom, dateTo: purchaseListSchema.shape.dateTo }).strict().superRefine((value, context) => {
  if (value.dateFrom && value.dateTo && value.dateTo < value.dateFrom) context.addIssue({ code: 'custom', path: ['dateTo'], message: 'The end date cannot precede the start date.' })
  if (value.submission_uuid && !value.customer_uuid) context.addIssue({ code: 'custom', path: ['customer_uuid'], message: 'A submission lookup requires its customer.' })
})
export const receiptsQuerySchema = base.extend({ sale_uuid: uuid.optional() }).strict().superRefine((value, context) => {
  if (value.submission_uuid && (!value.customer_uuid || !value.sale_uuid)) context.addIssue({ code: 'custom', path: ['submission_uuid'], message: 'A receipt lookup requires its customer and sale.' })
})
export type SalesOptions = z.output<typeof salesQuerySchema>
export type ReceiptOptions = z.output<typeof receiptsQuerySchema>
export type ShopQuery = Partial<Omit<z.input<typeof salesQuerySchema>, 'page' | 'pageSize'>> & { page?: number; pageSize?: number }
export type ReceiptQuery = Partial<Omit<z.input<typeof receiptsQuerySchema>, 'page' | 'pageSize'>> & { page?: number; pageSize?: number }
export interface Pagination { page: number; pageSize: number; total: number; totalPages: number }
export interface Sale extends PaymentSummary { uuid: string; customer_uuid: string; customer_name: string; customer_phone: string; archived_at: string | null; invoice_number: string | null; prescription_uuid: string | null; purchase_date: string; created_at: string; status: string }
export interface SalesList { sales: Sale[]; pagination: Pagination }
export interface ShopCustomer extends Customer { outstanding_paise: number | null; balance_review_required: boolean; last_sale: { uuid: string; purchase_date: string; total_paise: number } | null }
export interface ShopCustomerList { customers: ShopCustomer[]; pagination: Pagination }
export interface ShopPayment extends Payment { customer_name: string; invoice_number: string | null }
export interface ShopPaymentList { payments: ShopPayment[]; pagination: Pagination }
