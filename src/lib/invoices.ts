import type { Invoice, InvoiceIdentity } from '../../shared/invoices'
import type { InvoiceIdentityInput } from '../../shared/invoiceValidation'
import { ApiError, apiRequest, csrfHeaders } from './api'

export const invoiceKeys = {
  identity: ['invoice-identity'] as const,
  purchase: (customer: string, purchase: string) => ['invoice', customer, purchase] as const,
}
const base = (customer: string, purchase: string) => `/api/customers/${encodeURIComponent(customer)}/purchases/${encodeURIComponent(purchase)}/invoice`
export const invoicesApi = {
  get: (customer: string, purchase: string, signal?: AbortSignal) => apiRequest<Invoice | null>(base(customer, purchase), { signal }),
  generate: (customer: string, purchase: string, clientRequestId: string) => apiRequest<Invoice>(base(customer, purchase), { method: 'POST', headers: csrfHeaders(), body: JSON.stringify({ client_request_id: clientRequestId }) }),
  identity: (signal?: AbortSignal) => apiRequest<InvoiceIdentity>('/api/shop/invoice-identity', { signal }),
  updateIdentity: (input: InvoiceIdentityInput) => apiRequest<InvoiceIdentity>('/api/shop/invoice-identity', { method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify(input) }),
}
export const invoiceErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'The invoice could not be loaded. Please try again.'
export function incompleteInvoice(error: unknown) {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== 'object' || !('error' in error.details)) return false
  const failure = error.details.error
  return !!failure && typeof failure === 'object' && 'code' in failure && failure.code === 'INVOICE_GENERATION_INCOMPLETE'
}
