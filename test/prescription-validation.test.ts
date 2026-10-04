import { describe, expect, it } from 'vitest'
import { normalizePrescriptionDecimal, prescriptionCreateSchema, prescriptionRevisionSchema } from '../shared/prescriptionValidation'
import { parsePrescriptionListQuery, prescriptionCustomerPathSchema, prescriptionItemPathSchema } from '../worker/validators/prescriptions'

const powerFields = ['right_sphere', 'right_cylinder', 'right_addition', 'left_sphere', 'left_cylinder', 'left_addition'] as const
const pdFields = ['distance_pd', 'near_pd', 'right_pd', 'left_pd'] as const
const optionalFields = [...powerFields, ...pdFields, 'right_axis', 'left_axis', 'expires_on', 'prescriber_name', 'notes'] as const
const base = { prescribed_on: '2024-02-29' }

const acceptedPower: [unknown, string | null][] = [
  [undefined, null], [null, null], ['', null], ['   ', null],
  [0, '0.00'], [-0, '0.00'], ['0', '0.00'], ['-0.00', '0.00'], ['+000000.00', '0.00'],
  [1, '+1.00'], [-1.2, '-1.20'], ['+1.25', '+1.25'], ['-1.25', '-1.25'],
  ['.01', '+0.01'], ['-.1', '-0.10'], ['+.25', '+0.25'], ['  +00001.2  ', '+1.20'],
  ['0.13', '+0.13'], ['-999999.99', '-999999.99'], ['999999.99', '+999999.99'],
]
const invalidDecimals = [true, false, {}, [], NaN, Infinity, -Infinity, 'NaN', 'Infinity',
  '1e2', '1E-2', '1,25', '1 25', '1.', '.', '+', '--1', '++1', '+-1', '1.234', '0.001',
  '1000000', '0000000', '-1000000.00', '１.２５', '१.२५', '1\0', '1\u200b', '1\u202e', '0x10', '1/2']

describe('exact clinical decimal transcription, never floating-point rounding or inferred zero', () => {
  it.each(acceptedPower)('normalizes power %j to %j', (input, expected) => {
    expect(normalizePrescriptionDecimal(input, 'power')).toBe(expected)
    for (const field of powerFields) {
      expect(prescriptionCreateSchema.parse({ ...base, [field]: input })[field]).toBe(expected)
    }
  })
  it.each(invalidDecimals)('rejects malformed, nonfinite, overprecision or overwidth power %j', input => {
    expect(() => normalizePrescriptionDecimal(input, 'power')).toThrow()
    for (const field of powerFields) expect(prescriptionCreateSchema.safeParse({ ...base, [field]: input }).success).toBe(false)
  })
  it.each< [unknown, string | null] >([
    [undefined, null], [null, null], ['', null], [' ', null], ['+63.5', '63.50'], [63.5, '63.50'],
    ['000063.50', '63.50'], ['.01', '0.01'], ['1', '1.00'], ['999999.99', '999999.99'],
    ['20', '20.00'], ['120', '120.00'],
  ])('accepts positive PD %j as %j without a typical-adult range restriction', (input, expected) => {
    expect(normalizePrescriptionDecimal(input, 'pd')).toBe(expected)
    for (const field of pdFields) expect(prescriptionCreateSchema.parse({ ...base, [field]: input })[field]).toBe(expected)
  })
  it.each([...invalidDecimals, 0, -0, '0.00', '+0', '-0.00', '-.01', -63.5])('rejects invalid or nonpositive PD %j', input => {
    expect(() => normalizePrescriptionDecimal(input, 'pd')).toThrow()
    for (const field of pdFields) expect(prescriptionCreateSchema.safeParse({ ...base, [field]: input }).success).toBe(false)
  })
  it('does not require CYL/AXIS pairing, quarter steps, equal PD sums or derived near/monocular measurements', () => {
    const result = prescriptionCreateSchema.parse({ ...base, right_cylinder: '-0.13', left_axis: 180,
      distance_pd: '80.01', near_pd: '120', right_pd: '1', left_pd: '2' })
    expect(result).toMatchObject({ right_cylinder: '-0.13', right_axis: null, left_cylinder: null,
      left_axis: 180, distance_pd: '80.01', near_pd: '120.00', right_pd: '1.00', left_pd: '2.00' })
  })
})

describe('blank/null versus explicit-zero, axis and genuine calendar dates', () => {
  it('requires only the prescription date and materializes every omitted optional value as null', () => {
    const result = prescriptionCreateSchema.parse(base)
    expect(Object.keys(result).sort()).toEqual(['prescribed_on', ...optionalFields].sort())
    for (const field of optionalFields) expect(result[field]).toBeNull()
    for (const value of [null, '', '   ']) {
      const blank = prescriptionCreateSchema.parse({ ...base, ...Object.fromEntries(optionalFields.map(field => [field, value])) })
      for (const field of optionalFields) expect(blank[field]).toBeNull()
    }
    const zero = prescriptionCreateSchema.parse({ ...base, right_sphere: '-0', left_cylinder: '+0', right_axis: '0', left_axis: 0 })
    expect(zero).toMatchObject({ right_sphere: '0.00', left_cylinder: '0.00', right_axis: 0, left_axis: 0 })
    expect(zero.left_sphere).toBeNull()
  })
  it.each([0, 1, 90, 179, 180, '0', '000', '090', '180', ' 90 '])('accepts inclusive integer axis %j for both eyes', value => {
    for (const field of ['right_axis', 'left_axis'] as const) expect(prescriptionCreateSchema.parse({ ...base, [field]: value })[field]).toBe(Number(value))
  })
  it.each([-1, 181, 360, 1.5, true, false, [], {}, NaN, Infinity, '-0', '+1', '1.0', '1e2', '0000', '１', '90°'])('rejects invalid axis %j without coercing blanks to zero', value => {
    for (const field of ['right_axis', 'left_axis']) expect(prescriptionCreateSchema.safeParse({ ...base, [field]: value }).success).toBe(false)
  })
  it.each(['0001-01-01', '2000-02-29', '2024-02-29', '2026-04-30', '9999-12-31'])('accepts genuine date %s', prescribed_on => {
    expect(prescriptionCreateSchema.parse({ prescribed_on }).prescribed_on).toBe(prescribed_on)
  })
  it.each([undefined, null, '', ' ', 20260228, '0000-01-01', '1900-02-29', '2100-02-29', '2023-02-29',
    '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32', '2026-1-01',
    '2026-01-1', '26-01-01', '2026-01-01T00:00:00Z', '2026-01-01 ', '2026-02-29', '２０２６-01-01'])('rejects invalid required date %j', prescribed_on => {
    expect(prescriptionCreateSchema.safeParse({ prescribed_on }).success).toBe(false)
  })
  it('checks every day/month boundary across ordinary, leap and century years against the independent UTC calendar', () => {
    for (const year of [1, 4, 100, 400, 1899, 1900, 2000, 2023, 2024, 2100, 2400, 9999]) {
      for (let month = 1; month <= 12; month++) for (let day = 1; day <= 32; day++) {
        const prescribed_on = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        const timestamp = Date.parse(`${prescribed_on}T00:00:00.000Z`)
        const valid = Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === prescribed_on
        expect(prescriptionCreateSchema.safeParse({ prescribed_on }).success, prescribed_on).toBe(valid)
      }
    }
  })

  it('validates both dates and permits equal expiry without allowing an earlier expiry', () => {
    for (const expires_on of ['2024-02-29', '2025-02-28']) expect(prescriptionCreateSchema.safeParse({ ...base, expires_on }).success).toBe(true)
    for (const expires_on of ['2024-02-28', '2025-02-29', 20250228]) {
      const result = prescriptionCreateSchema.safeParse({ ...base, expires_on })
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.issues.some(issue => issue.path[0] === 'expires_on')).toBe(true)
    }
  })
})

describe('strict inputs, optional text and omission-preserving revisions', () => {
  it('trims optional text, retains multiline/unicode notes and enforces precise text bounds', () => {
    expect(prescriptionCreateSchema.parse({ ...base, prescriber_name: '  Dr. देवी  ', notes: '  First line\nSecond line  ' }))
      .toMatchObject({ prescriber_name: 'Dr. देवी', notes: 'First line\nSecond line' })
    for (const [field, limit] of [['prescriber_name', 200], ['notes', 2000]] as const) {
      expect(prescriptionCreateSchema.safeParse({ ...base, [field]: 'x'.repeat(limit) }).success).toBe(true)
      expect(prescriptionCreateSchema.safeParse({ ...base, [field]: 'x'.repeat(limit + 1) }).success).toBe(false)
    }
    for (const value of ['A\0B', 'A\tB', 'A\rB', 'A\u200bB', 'A\u202eB', 'A\u2066B', 'A\u2028B']) {
      for (const field of ['prescriber_name', 'notes']) expect(prescriptionCreateSchema.safeParse({ ...base, [field]: value }).success).toBe(false)
    }
    expect(prescriptionCreateSchema.safeParse({ ...base, prescriber_name: 'A\nB' }).success).toBe(false)
  })
  it.each(['uuid', 'id', 'customer_uuid', 'customer_id', 'prescription_type', 'root_uuid', 'root_id',
    'revision_number', 'supersedes_uuid', 'supersedes_id', 'superseded_by_uuid', 'status', 'created_at',
    'updated_at', 'deleted_at', 'created_by_admin_id', 'revision_reason', '__proto__'])('rejects unknown/private creation field %s', field => {
    const input = JSON.parse(JSON.stringify(base).slice(0, -1) + `,${JSON.stringify(field)}:"injected"}`)
    expect(prescriptionCreateSchema.safeParse(input).success).toBe(false)
  })
  it.each([null, [], 'text', 1, true, {}])('rejects nonobject/missing-date creation %j', value => {
    expect(prescriptionCreateSchema.safeParse(value).success).toBe(false)
  })
  it('keeps omitted revision fields absent; explicit null/blank clear only optional fields', () => {
    expect(prescriptionRevisionSchema.parse({ revision_reason: '  Correct transcription  ', right_sphere: '-.13' }))
      .toEqual({ revision_reason: 'Correct transcription', right_sphere: '-0.13' })
    expect(prescriptionRevisionSchema.parse({ revision_reason: 'Clear unknown', notes: null, right_axis: '', near_pd: ' ' }))
      .toEqual({ revision_reason: 'Clear unknown', notes: null, right_axis: null, near_pd: null })
  })
  it.each([{}, { revision_reason: 'Only reason' }, { revision_reason: 'Undefined field', notes: undefined },
    { notes: 'Changed' }, { notes: 'Changed', revision_reason: '' }, { notes: 'Changed', revision_reason: ' ' },
    { notes: 'Changed', revision_reason: null }, { notes: 'Changed', revision_reason: 'x'.repeat(501) },
    { notes: 'Changed', revision_reason: 'A\nB' }, { notes: 'Changed', revision_reason: 'A\u202eB' },
    { notes: 'Changed', revision_reason: 'Reason', customer_uuid: 'other' },
    { prescribed_on: null, revision_reason: 'Reason' }, { prescribed_on: '2025-01-02', expires_on: '2025-01-01', revision_reason: 'Reason' },
  ])('rejects incomplete/unsafe revision %j', value => {
    expect(prescriptionRevisionSchema.safeParse(value).success).toBe(false)
  })
  it('accepts a 500-character reason and all-null optional replacement fields', () => {
    expect(prescriptionRevisionSchema.safeParse({ revision_reason: 'x'.repeat(500),
      ...Object.fromEntries(optionalFields.map(field => [field, null])) }).success).toBe(true)
  })
})

describe('strict scoped prescription identifiers and query parser', () => {
  it('requires both UUIDs, normalizes uppercase and uses bounded pagination defaults', () => {
    const customerUuid = crypto.randomUUID(), prescriptionUuid = crypto.randomUUID()
    expect(prescriptionCustomerPathSchema.parse({ customerUuid: customerUuid.toUpperCase() })).toEqual({ customerUuid })
    expect(prescriptionItemPathSchema.parse({ customerUuid, prescriptionUuid: prescriptionUuid.toUpperCase() })).toEqual({ customerUuid, prescriptionUuid })
    for (const value of [{ customerUuid }, { customerUuid: 'invalid', prescriptionUuid }, { customerUuid, prescriptionUuid: 'invalid' }]) {
      expect(prescriptionItemPathSchema.safeParse(value).success).toBe(false)
    }
    expect(parsePrescriptionListQuery(new URL('https://test.invalid/'))).toEqual({ page: 1, pageSize: 20 })
    expect(parsePrescriptionListQuery(new URL('https://test.invalid/?page=10000&pageSize=50'))).toEqual({ page: 10000, pageSize: 50 })
  })
  it.each(['page=0', 'page=-1', 'page=01', 'page=1.5', 'page=1e2', 'page=10001', 'pageSize=0', 'pageSize=51',
    'page=', 'pageSize=', 'page=1&page=2', '%70age=1&page=2', 'status=current', 'sort=id',
    '__proto__=x', 'page=%GG', 'page=%FF', '&', `notes=${'x'.repeat(2050)}`])('rejects malformed/unknown query %s', query => {
    expect(() => parsePrescriptionListQuery(new URL(`https://test.invalid/?${query}`))).toThrow()
  })
})
