import type { Prescription, PrescriptionHistory, PrescriptionInput, PrescriptionList, PrescriptionListQuery, PrescriptionRevisionInput } from '../../shared/prescriptions'
import { prescriptionFieldsSchema } from '../../shared/prescriptionValidation'
import { ApiError, apiRequest, csrfHeaders } from './api'

export const prescriptionKeys = {
  all: ['prescriptions'] as const,
  customer: (customerUuid: string) => ['prescriptions', customerUuid] as const,
  list: (customerUuid: string, query: PrescriptionListQuery) => ['prescriptions', customerUuid, 'list', query] as const,
  detail: (customerUuid: string, prescriptionUuid: string) => ['prescriptions', customerUuid, 'detail', prescriptionUuid] as const,
  history: (customerUuid: string, prescriptionUuid: string, query: PrescriptionListQuery) => ['prescriptions', customerUuid, 'history', prescriptionUuid, query] as const,
}

function customerPath(customerUuid: string) {
  return `/api/customers/${encodeURIComponent(customerUuid)}/prescriptions`
}

function itemPath(customerUuid: string, prescriptionUuid: string) {
  return `${customerPath(customerUuid)}/${encodeURIComponent(prescriptionUuid)}`
}

function pageParams(query: PrescriptionListQuery) {
  const params = new URLSearchParams()
  if (query.page !== undefined) params.set('page', String(query.page))
  if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize))
  return params.toString()
}

export const prescriptionsApi = {
  list: (customerUuid: string, query: PrescriptionListQuery, signal?: AbortSignal) =>
    apiRequest<PrescriptionList>(`${customerPath(customerUuid)}?${pageParams(query)}`, { signal }),
  detail: (customerUuid: string, prescriptionUuid: string, signal?: AbortSignal) =>
    apiRequest<Prescription>(itemPath(customerUuid, prescriptionUuid), { signal }),
  history: (customerUuid: string, prescriptionUuid: string, query: PrescriptionListQuery, signal?: AbortSignal) =>
    apiRequest<PrescriptionHistory>(`${itemPath(customerUuid, prescriptionUuid)}/history?${pageParams(query)}`, { signal }),
  create: (customerUuid: string, input: PrescriptionInput) => apiRequest<Prescription>(customerPath(customerUuid), {
    method: 'POST', headers: csrfHeaders(), body: JSON.stringify(input),
  }),
  revise: (customerUuid: string, prescriptionUuid: string, input: PrescriptionRevisionInput) => apiRequest<Prescription>(itemPath(customerUuid, prescriptionUuid), {
    method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify(input),
  }),
}

export const prescriptionFieldNames = [
  'prescribed_on', 'expires_on', 'right_sphere', 'right_cylinder', 'right_axis', 'right_addition',
  'left_sphere', 'left_cylinder', 'left_axis', 'left_addition', 'distance_pd', 'near_pd', 'right_pd', 'left_pd',
  'prescriber_name', 'notes', 'revision_reason',
] as const
export type PrescriptionFieldName = typeof prescriptionFieldNames[number]

export function prescriptionFieldErrors(error: unknown): { field: PrescriptionFieldName; message: string }[] {
  if (!(error instanceof ApiError) || typeof error.details !== 'object' || error.details === null || !('error' in error.details)) return []
  const failure = error.details.error
  if (typeof failure !== 'object' || failure === null || !('details' in failure) || !Array.isArray(failure.details)) return []
  return failure.details.flatMap((detail: unknown) => {
    if (typeof detail !== 'object' || detail === null || !('field' in detail) || !('message' in detail)) return []
    const field = prescriptionFieldNames.find(name => name === detail.field)
    return field && typeof detail.message === 'string' ? [{ field, message: detail.message }] : []
  })
}

export function prescriptionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The prescription request could not be completed. Please try again.'
}

export function prescriptionDate(value: string | null): string {
  if (!value) return 'Unknown'
  // Preserve noncanonical legacy dates verbatim rather than normalizing them.
  if (!prescriptionFieldsSchema.shape.prescribed_on.safeParse(value).success) return value
  // Calendar dates are displayed in local time, never shifted by UTC parsing.
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date)
}

export function prescriptionMeasurement(value: string | number | null, unit: string): string {
  return value === null ? 'Unknown' : `${value}${unit}`
}

export function prescriptionEyeSummary(record: Prescription, eye: 'right' | 'left'): string {
  return `SPH ${prescriptionMeasurement(record[`${eye}_sphere`], ' D')} · CYL ${prescriptionMeasurement(record[`${eye}_cylinder`], ' D')} · AXIS ${prescriptionMeasurement(record[`${eye}_axis`], '°')} · ADD ${prescriptionMeasurement(record[`${eye}_addition`], ' D')}`
}

export function prescriptionTypeLabel(type: Prescription['prescription_type']): string {
  return type === 'spectacle' ? 'Spectacle' : type === 'contact_lens' ? 'Contact lens (legacy)' : 'Other (legacy)'
}
