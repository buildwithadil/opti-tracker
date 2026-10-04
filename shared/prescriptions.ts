/** Public prescription records; the existing DB id/customer_id columns map to
 * UUID identifiers here. Clinical values are exact decimal strings or null. */
export interface PrescriptionMeasurements {
  right_sphere: string | null
  right_cylinder: string | null
  right_axis: number | null
  right_addition: string | null
  left_sphere: string | null
  left_cylinder: string | null
  left_axis: number | null
  left_addition: string | null
  distance_pd: string | null
  near_pd: string | null
  right_pd: string | null
  left_pd: string | null
}

export interface Prescription extends PrescriptionMeasurements {
  uuid: string
  customer_uuid: string
  prescription_type: 'spectacle' | 'contact_lens' | 'other'
  prescribed_on: string | null
  expires_on: string | null
  prescriber_name: string | null
  notes: string | null
  root_uuid: string
  revision_number: number
  supersedes_uuid: string | null
  superseded_by_uuid: string | null
  superseded_at: string | null
  status: 'current' | 'superseded' | 'archived'
  revision_reason: string | null
  created_at: string
  updated_at: string
}

export interface PrescriptionInput extends Partial<PrescriptionMeasurements> {
  prescribed_on: string
  expires_on?: string | null
  prescriber_name?: string | null
  notes?: string | null
}

/** A PATCH creates a replacement, never overwrites the stored clinical row. */
export interface PrescriptionRevisionInput extends Partial<PrescriptionInput> {
  revision_reason: string
}

export interface PrescriptionListQuery {
  page?: number
  pageSize?: number
}

export interface PrescriptionList {
  prescriptions: Prescription[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

export interface PrescriptionHistory extends PrescriptionList {
  root_uuid: string
}
