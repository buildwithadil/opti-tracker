import type { CustomerCreditSummary, Payment, PaymentCreated, PaymentList, PaymentListQuery } from '../../shared/payments'
import type { PaymentCreateInput } from '../../shared/paymentValidation'
import { ApiError, apiRequest, csrfHeaders } from './api'

export const paymentKeys = {
  customer: (customerUuid: string) => ['payments', customerUuid] as const,
  list: (customerUuid: string, purchaseUuid: string, query: PaymentListQuery) => ['payments', customerUuid, purchaseUuid, 'list', query] as const,
  credit: (customerUuid: string) => ['payments', customerUuid, 'credit'] as const,
}
const base = (customerUuid: string, purchaseUuid: string) => `/api/customers/${encodeURIComponent(customerUuid)}/purchases/${encodeURIComponent(purchaseUuid)}/payments`
export const paymentsApi = {
  list: (customerUuid: string, purchaseUuid: string, query: PaymentListQuery, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (query.page !== undefined) params.set('page', String(query.page))
    if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize))
    return apiRequest<PaymentList>(`${base(customerUuid, purchaseUuid)}?${params}`, { signal })
  },
  detail: (customerUuid: string, purchaseUuid: string, paymentUuid: string, signal?: AbortSignal) => apiRequest<Payment>(`${base(customerUuid, purchaseUuid)}/${encodeURIComponent(paymentUuid)}`, { signal }),
  create: (customerUuid: string, purchaseUuid: string, input: PaymentCreateInput) => apiRequest<PaymentCreated>(base(customerUuid, purchaseUuid), { method: 'POST', headers: csrfHeaders(), body: JSON.stringify(input) }),
  credit: (customerUuid: string, signal?: AbortSignal) => apiRequest<CustomerCreditSummary>(`/api/customers/${encodeURIComponent(customerUuid)}/credit-summary`, { signal }),
}
export const paymentErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'The payment request could not be completed. Please try again.'
export function isDuplicatePayment(error: unknown) {
  return paymentErrorCode(error) === 'PAYMENT_DUPLICATE'
}
export function paymentErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError) || typeof error.details !== 'object' || !error.details || !('error' in error.details)) return null
  const failure = error.details.error
  return typeof failure === 'object' && failure !== null && 'code' in failure && typeof failure.code === 'string' ? failure.code : null
}
export const paymentFieldNames = ['amount', 'payment_method', 'received_at', 'reference', 'notes'] as const
export type PaymentFieldName = typeof paymentFieldNames[number]
export function paymentFieldErrors(error: unknown): { field: PaymentFieldName; message: string }[] {
  if (!(error instanceof ApiError) || typeof error.details !== 'object' || !error.details || !('error' in error.details)) return []
  const failure = error.details.error
  if (typeof failure !== 'object' || !failure || !('details' in failure) || !Array.isArray(failure.details)) return []
  return failure.details.flatMap((detail: unknown) => {
    if (typeof detail !== 'object' || !detail || !('field' in detail) || !('message' in detail)) return []
    const field = paymentFieldNames.find(field => field === detail.field)
    return field && typeof detail.message === 'string' ? [{ field, message: detail.message }] : []
  })
}
