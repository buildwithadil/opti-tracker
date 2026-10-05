import type { PurchaseDetail, PurchaseList, PurchaseListQuery, PurchaseCategory } from '../../shared/purchases'
import { purchaseCategoryLabels } from '../../shared/purchases'
import type { PurchaseCreateInput } from '../../shared/purchaseValidation'
import { asPaise, formatPaise } from '../../shared/money'
import { ApiError, apiRequest, csrfHeaders } from './api'

export const purchaseKeys = {
  all: ['purchases'] as const,
  customer: (uuid: string) => ['purchases', uuid] as const,
  list: (uuid: string, query: PurchaseListQuery) => ['purchases', uuid, 'list', query] as const,
  detail: (uuid: string, purchaseUuid: string) => ['purchases', uuid, 'detail', purchaseUuid] as const,
}
const path = (uuid: string) => `/api/customers/${encodeURIComponent(uuid)}/purchases`
export const purchasesApi = {
  list: (uuid: string, query: PurchaseListQuery, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)) })
    return apiRequest<PurchaseList>(`${path(uuid)}?${params}`, { signal })
  },
  detail: (uuid: string, purchaseUuid: string, signal?: AbortSignal) => apiRequest<PurchaseDetail>(`${path(uuid)}/${encodeURIComponent(purchaseUuid)}`, { signal }),
  create: (uuid: string, input: PurchaseCreateInput) => apiRequest<PurchaseDetail>(path(uuid), { method: 'POST', headers: csrfHeaders(), body: JSON.stringify(input) }),
}
export const purchaseErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'The purchase request could not be completed. Please try again.'
export const categoryLabel = (category: string) => purchaseCategoryLabels[category as PurchaseCategory] ?? category
export const purchaseMoney = (paise: number) => `₹${formatPaise(asPaise(paise))}`
export function isDuplicatePurchase(error: unknown) {
  return error instanceof ApiError && error.status === 409 && typeof error.details === 'object' && error.details !== null && 'error' in error.details && typeof error.details.error === 'object' && error.details.error !== null && 'code' in error.details.error && error.details.error.code === 'PURCHASE_DUPLICATE'
}

export function purchaseFieldErrors(error: unknown): { field: string; message: string }[] {
  if (!(error instanceof ApiError) || typeof error.details !== 'object' || !error.details || !('error' in error.details)) return []
  const failure = error.details.error
  if (typeof failure !== 'object' || !failure || !('details' in failure) || !Array.isArray(failure.details)) return []
  return failure.details.flatMap((detail: unknown) => {
    if (typeof detail !== 'object' || !detail || !('field' in detail) || !('message' in detail)) return []
    return typeof detail.field === 'string' && typeof detail.message === 'string' && /^(purchase_date|prescription_uuid|order_discount|notes|items(?:\.\d+\.(?:description|product_category|quantity|unit_price|discount))?)$/u.test(detail.field) ? [{ field: detail.field, message: detail.message }] : []
  })
}
