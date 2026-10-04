import { describe, expect, it } from 'vitest'
import { formatIndianMobile, normalizeIndianMobile } from '../shared/phone'
import {
  createCustomerSchema, customerPathSchema, parseCustomerListQuery, patchCustomerSchema,
} from '../worker/validators/customers'
import { acceptedMobileForms, invalidMobileInputs } from './customer-fixtures'

const canonical = '+919876543210'
const input = { name: 'Customer', phone: '9876543210' }

describe('strict shared Indian mobile normalization', () => {
  it.each(['6123456789', '7123456789', '8123456789', '9876543210'].flatMap(national =>
    acceptedMobileForms(national).map(form => ({ form, national }))))('normalizes $form without losing digits', ({ form, national }) => {
    expect(normalizeIndianMobile(form)).toBe(`+91${national}`)
    expect(normalizeIndianMobile(` ${form} `)).toBe(`+91${national}`)
    expect(formatIndianMobile(`+91${national}`)).toBe(`+91 ${national.slice(0, 5)} ${national.slice(5)}`)
  })

  it.each(invalidMobileInputs.map(value => ({ value })))('rejects malformed, foreign, non-ASCII and non-string input: $value', ({ value }) => {
    expect(() => normalizeIndianMobile(value)).toThrow(Error)
  })

  it.each(['9876543210', '+91 98765 43210', '+915123456789', '+91987654321', '+9198765432100', '+91987654321x', ''])('does not format noncanonical stored values: %j', value => {
    expect(() => formatIndianMobile(value)).toThrow(/not canonical/u)
  })

  it('round-trips formatted canonical values, with an exact raw input length boundary', () => {
    expect(normalizeIndianMobile(formatIndianMobile(canonical))).toBe(canonical)
    expect(normalizeIndianMobile(' '.repeat(22) + '9876543210')).toBe(canonical)
    expect(() => normalizeIndianMobile(' '.repeat(23) + '9876543210')).toThrow()
  })
})

describe('customer name and mutation validation', () => {
  it('normalizes NFKC, edges and repeated spaces but preserves ordinary Unicode names', () => {
    expect(createCustomerSchema.parse({ name: '  Ａsha　　देवी  ', phone: '0091-98765-43210' })).toEqual({ name: 'Asha देवी', phone: canonical })
    expect(createCustomerSchema.parse({ name: 'Élodie O’Neil / 李', phone: input.phone }).name).toBe('Élodie O’Neil / 李')
    expect(createCustomerSchema.parse({ ...input, name: 'X' }).name).toBe('X')
    expect(createCustomerSchema.parse({ ...input, name: 'X'.repeat(200) }).name).toHaveLength(200)
  })

  it.each([null, 123, '', '   ', 'X'.repeat(201), 'A\0B', 'A\nB', 'A\rB', 'A\tB', 'A\u007fB', 'A\u200bB', 'A\u202eB', 'A\u2028B', 'A\u2029B'])('rejects invalid names: %j', name => {
    for (const schema of [createCustomerSchema, patchCustomerSchema]) {
      const result = schema.safeParse({ ...input, name })
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.issues.some(issue => issue.path[0] === 'name')).toBe(true)
    }
  })

  it.each(invalidMobileInputs.map(phone => ({ phone })))('rejects invalid phone in both create and edit: $phone', ({ phone }) => {
    expect(createCustomerSchema.safeParse({ ...input, phone }).success).toBe(false)
    // A missing partial field is allowed, but explicit invalid values are not.
    if (phone !== undefined) expect(patchCustomerSchema.safeParse({ phone }).success).toBe(false)
  })

  it.each([null, [], 'string', 1, true, {}, { name: 'Only name' }, { phone: input.phone }, { ...input, uuid: crypto.randomUUID() }, { ...input, archived_at: null }, { ...input, revision: 100 }, { ...input, created_by_admin_id: 'attacker' }])('requires strict complete creation input: %j', value => {
    expect(createCustomerSchema.safeParse(value).success).toBe(false)
  })

  it('allows only strict nonempty partial edits', () => {
    expect(patchCustomerSchema.parse({ name: '  New   name ' })).toEqual({ name: 'New name' })
    expect(patchCustomerSchema.parse({ phone: '0-98765 43210' })).toEqual({ phone: canonical })
    expect(patchCustomerSchema.parse(input)).toEqual({ name: input.name, phone: canonical })
    for (const value of [{}, { name: undefined }, { phone: undefined }, { phone: null }, { name: 'Good', role: 'owner' }, { archived_at: null }]) {
      expect(patchCustomerSchema.safeParse(value).success).toBe(false)
    }
  })

  it('requires valid UUID paths and canonicalizes their case', () => {
    const uuid = 'A8179A73-89B8-4EA1-AB19-412DDB7AAF41'
    expect(customerPathSchema.parse({ uuid })).toEqual({ uuid: uuid.toLowerCase() })
    for (const value of [{ uuid: 'customer-1' }, { uuid: '../x' }, {}, { uuid, extra: true }]) {
      expect(customerPathSchema.safeParse(value).success).toBe(false)
    }
  })
})

describe('strict customer list query parsing', () => {
  it('provides contract defaults and accepts every enum and boundary', () => {
    expect(parseCustomerListQuery(new URL('https://test/api/customers'))).toEqual({ search: '', status: 'active', page: 1, pageSize: 20, sort: 'created_at', order: 'desc' })
    expect(parseCustomerListQuery(new URL('https://test/api/customers?search=%20A%25_%5C%20&page=10000&pageSize=50&status=all&sort=phone&order=asc')))
      .toEqual({ search: 'A%_\\', page: 10000, pageSize: 50, status: 'all', sort: 'phone', order: 'asc' })
    for (const status of ['active', 'archived', 'all']) for (const sort of ['created_at', 'updated_at', 'name', 'phone']) for (const order of ['asc', 'desc']) {
      expect(parseCustomerListQuery(new URL(`https://test/api/customers?status=${status}&sort=${sort}&order=${order}`))).toMatchObject({ status, sort, order })
    }
    expect(parseCustomerListQuery(new URL(`https://test/api/customers?search=${'x'.repeat(100)}`)).search).toHaveLength(100)
  })

  it.each([
    'page=0', 'page=-1', 'page=1.1', 'page=1e2', 'page=01', 'page=+1', 'page=%201', 'page=', 'page=10001', 'page=9007199254740993',
    'pageSize=0', 'pageSize=51', 'pageSize=01', 'pageSize=NaN', 'status=deleted', 'status=Active', 'sort=revision', 'sort=name%3BDROP%20TABLE%20customers', 'order=ASC',
    'search=%00', 'search=%0a', 'search=%E2%80%8B', `search=${'x'.repeat(101)}`, 'search=a&search=b', 'page=1&page=2', '%70age=1&page=2',
    'unknown=1', '__proto__=evil', 'constructor=evil', '=value', 'search=%', 'search=%GG', 'search=%FF', 'search=%C0%AF', '&',
    `search=${'x'.repeat(2049)}`,
  ])('rejects invalid, duplicate or dangerous query syntax: %s', query => {
    expect(() => parseCustomerListQuery(new URL(`https://test/api/customers?${query}`))).toThrow()
  })
})
