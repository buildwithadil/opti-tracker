import { z } from 'zod'

const controls = /[\p{Cc}\p{Cf}\u2028\u2029]/u

/** Exact transcription, not a clinical range or quarter-diopter restriction.
 * Numbers are inspected as decimal text; excess precision is never rounded.
 * Blank/unknown measurements stay null and only explicit zero becomes 0.00.
 */
export function normalizePrescriptionDecimal(input: unknown, kind: 'power' | 'pd'): string | null {
  if (input === undefined || input === null) return null
  if (typeof input !== 'string' && typeof input !== 'number') throw new Error('Enter a decimal number.')
  if (typeof input === 'number' && !Number.isFinite(input)) throw new Error('Enter a finite decimal number.')
  const text = String(input).trim()
  if (!text) return null
  // Six whole digits and two fractional digits are a technical storage bound,
  // not a judgement about the suitability of a prescription or dispensing PD.
  if (!/^[+-]?(?:[0-9]{1,6}(?:\.[0-9]{1,2})?|\.[0-9]{1,2})$/u.test(text)) {
    throw new Error('Use up to 6 whole digits and at most 2 decimal places.')
  }
  const negative = text.startsWith('-')
  const unsigned = text.replace(/^[+-]/u, '')
  const [whole = '', fraction = ''] = unsigned.split('.')
  const integer = whole.replace(/^0+/u, '') || '0'
  const decimals = fraction.padEnd(2, '0')
  const isZero = integer === '0' && decimals === '00'
  if (kind === 'pd' && (negative || isZero)) throw new Error('Enter a positive PD measurement in millimetres.')
  if (isZero) return '0.00'
  return `${negative ? '-' : kind === 'power' ? '+' : ''}${integer}.${decimals}`
}

function decimal(kind: 'power' | 'pd') {
  return z.union([z.string(), z.number(), z.null()]).transform((input, context) => {
    try { return normalizePrescriptionDecimal(input, kind) }
    catch (error) {
      context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Enter a valid measurement.' })
      return z.NEVER
    }
  })
}

const axis = z.union([z.string(), z.number(), z.null()]).transform((input, context) => {
  if (input === null || (typeof input === 'string' && !input.trim())) return null
  const text = typeof input === 'string' ? input.trim() : String(input)
  const value = Number(text)
  if (!/^[0-9]{1,3}$/u.test(text) || !Number.isInteger(value) || value < 0 || value > 180) {
    context.addIssue({ code: 'custom', message: 'Enter a whole-number axis from 0 to 180 degrees.' })
    return z.NEVER
  }
  return value
})

function isCalendarDate(value: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= days[month - 1]
}
const date = z.string().refine(isCalendarDate, 'Enter a real calendar date in YYYY-MM-DD format.')
const expiry = z.union([z.string(), z.null()]).transform(value => value === null || !value.trim() ? null : value)
  .pipe(date.nullable())
const prescriber = z.string().refine(value => !controls.test(value), 'The prescriber name must not contain control characters.')
  .trim().max(200, 'Use at most 200 characters for the prescriber name.').nullable()
  .transform(value => value || null)
const notes = z.string().refine(value => !controls.test(value.replaceAll('\n', '')),
  'Notes may contain line breaks, but not other control characters.')
  .trim().max(2000, 'Use at most 2000 characters for prescription notes.').nullable()
  .transform(value => value || null)
const revisionReason = z.string().refine(value => !controls.test(value), 'The revision reason must not contain control characters.')
  .trim().min(1, 'Enter a revision reason.').max(500, 'Use at most 500 characters for the revision reason.')

const clinicalFields = {
  prescribed_on: date,
  expires_on: expiry,
  right_sphere: decimal('power'),
  right_cylinder: decimal('power'),
  right_axis: axis,
  right_addition: decimal('power'),
  left_sphere: decimal('power'),
  left_cylinder: decimal('power'),
  left_axis: axis,
  left_addition: decimal('power'),
  distance_pd: decimal('pd'),
  near_pd: decimal('pd'),
  right_pd: decimal('pd'),
  left_pd: decimal('pd'),
  prescriber_name: prescriber,
  notes,
}

/** Strict creation object before the cross-field date refinement. */
export const prescriptionFieldsSchema = z.object({
  ...clinicalFields,
  expires_on: expiry.default(null),
  right_sphere: clinicalFields.right_sphere.default(null),
  right_cylinder: clinicalFields.right_cylinder.default(null),
  right_axis: axis.default(null),
  right_addition: clinicalFields.right_addition.default(null),
  left_sphere: clinicalFields.left_sphere.default(null),
  left_cylinder: clinicalFields.left_cylinder.default(null),
  left_axis: axis.default(null),
  left_addition: clinicalFields.left_addition.default(null),
  distance_pd: clinicalFields.distance_pd.default(null),
  near_pd: clinicalFields.near_pd.default(null),
  right_pd: clinicalFields.right_pd.default(null),
  left_pd: clinicalFields.left_pd.default(null),
  prescriber_name: prescriber.default(null),
  notes: notes.default(null),
}).strict()

function validateDatePair(input: { prescribed_on?: string; expires_on?: string | null }, context: z.RefinementCtx): void {
  if (input.prescribed_on && input.expires_on && input.expires_on < input.prescribed_on) {
    context.addIssue({ code: 'custom', path: ['expires_on'], message: 'The expiry / recheck date must not be before the prescription date.' })
  }
}

export const prescriptionCreateSchema = prescriptionFieldsSchema.superRefine(validateDatePair)
// No creation defaults here: omitted fields retain their prior values in the
// service; explicit null clears optional values. Validate the merged version
// again with the full creation schema before inserting its immutable row.
export const prescriptionRevisionSchema = z.object(clinicalFields).partial()
  .extend({ revision_reason: revisionReason }).strict()
  .refine(input => Object.keys(clinicalFields).some(key => input[key as keyof typeof clinicalFields] !== undefined), {
    message: 'Provide at least one prescription field to revise.',
  }).superRefine(validateDatePair)

export type PrescriptionCreateValues = z.infer<typeof prescriptionCreateSchema>
export type PrescriptionRevisionValues = z.infer<typeof prescriptionRevisionSchema>
