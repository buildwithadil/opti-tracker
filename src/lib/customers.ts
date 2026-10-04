import type { Customer, CustomerInput, CustomerList, CustomerListQuery } from '../../shared/customers'
import { ApiError, apiRequest, csrfHeaders } from './api'

export const customerKeys = {
  all: ['customers'] as const,
  list: (query: CustomerListQuery) => ['customers', 'list', query] as const,
  detail: (uuid: string) => ['customers', 'detail', uuid] as const,
}

export const customersApi = {
  list: (query: CustomerListQuery, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value))
    }
    return apiRequest<CustomerList>(`/api/customers?${params.toString()}`, { signal })
  },
  detail: (uuid: string, signal?: AbortSignal) => apiRequest<Customer>(`/api/customers/${encodeURIComponent(uuid)}`, { signal }),
  create: (input: CustomerInput) => apiRequest<Customer>('/api/customers', {
    method: 'POST', headers: csrfHeaders(), body: JSON.stringify(input),
  }),
  update: (uuid: string, input: Partial<CustomerInput>) => apiRequest<Customer>(`/api/customers/${encodeURIComponent(uuid)}`, {
    method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify(input),
  }),
  archive: (uuid: string) => apiRequest<Customer>(`/api/customers/${encodeURIComponent(uuid)}`, {
    method: 'DELETE', headers: csrfHeaders(), body: null,
  }),
  restore: (uuid: string) => apiRequest<Customer>(`/api/customers/${encodeURIComponent(uuid)}/restore`, {
    method: 'POST', headers: csrfHeaders(), body: null,
  }),
}

export function customerFieldErrors(error: unknown): { field: 'name' | 'phone'; message: string }[] {
  if (!(error instanceof ApiError) || typeof error.details !== 'object' || error.details === null || !('error' in error.details)) return []
  const failure = error.details.error
  if (typeof failure !== 'object' || failure === null) return []
  if ('details' in failure && Array.isArray(failure.details)) {
    return failure.details.flatMap((detail: unknown) => {
      if (typeof detail !== 'object' || detail === null || !('field' in detail) || !('message' in detail)) return []
      if ((detail.field !== 'name' && detail.field !== 'phone') || typeof detail.message !== 'string') return []
      return [{ field: detail.field, message: detail.message }]
    })
  }
  if ('code' in failure && failure.code === 'CUSTOMER_PHONE_CONFLICT') {
    return [{ field: 'phone', message: 'This mobile number is already in use by an active customer.' }]
  }
  return []
}

export function customerErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The customer request could not be completed. Please try again.'
}

export function customerDate(value: string, includeTime = false): string {
  // Legacy SQLite timestamps are UTC but lack a timezone suffix.
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value) ? `${value.replace(' ', 'T')}Z` : value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium', ...(includeTime ? { timeStyle: 'short' as const } : {}),
  }).format(date)
}
