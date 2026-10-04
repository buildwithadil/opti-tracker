import { describe, expect, it } from 'vitest'
import {
  addPaise, asPaise, calculateLineTotal, calculateTaxPaise, calculateTotals,
  formatPaise, multiplyPaise, parsePaise, parseRupeesToPaise, subtractPaise,
} from '../worker/lib/money'
import { normalizeDateOnly, normalizeInteger, normalizeName, normalizeOptionalText, normalizePhone } from '../worker/lib/normalize'
import { isUtcIsoTimestamp, newId, utcNow } from '../worker/lib/time'

const p = asPaise

describe('integer-paise foundation', () => {
  it.each([['0', 0], [' 12.3 ', 1230], ['199.99', 19999], ['0.01', 1], ['90071992547409.91', Number.MAX_SAFE_INTEGER]])('parses %s without floating-point currency arithmetic', (value, expected) => {
    expect(parseRupeesToPaise(value)).toBe(expected)
    expect(parseRupeesToPaise(formatPaise(p(expected)))).toBe(expected)
  })

  it.each(['-1', '1.001', '1e3', '1,000', 'NaN', '', '90071992547409.92'])('rejects invalid or overflowing rupees: %s', value => {
    expect(() => parseRupeesToPaise(value)).toThrow()
  })

  it('rejects non-integer API paise and arithmetic overflow/underflow', () => {
    for (const value of [-1, 1.2, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) expect(() => asPaise(value)).toThrow(RangeError)
    expect(() => parsePaise('100')).toThrow(TypeError)
    expect(() => addPaise(p(Number.MAX_SAFE_INTEGER), p(1))).toThrow(RangeError)
    expect(() => subtractPaise(p(0), p(1))).toThrow(RangeError)
    expect(() => multiplyPaise(p(Number.MAX_SAFE_INTEGER), 2)).toThrow(RangeError)
    expect(() => multiplyPaise(p(100), 1.5)).toThrow(RangeError)
    expect(addPaise(p(100), p(20))).toBe(120)
  })

  it('rounds basis-point tax half-up and avoids intermediate multiplication overflow', () => {
    expect(calculateTaxPaise(p(1), 5000)).toBe(1)
    expect(calculateTaxPaise(p(1), 4999)).toBe(0)
    expect(calculateTaxPaise(p(199), 250)).toBe(5)
    expect(calculateTaxPaise(p(Number.MAX_SAFE_INTEGER), 10000)).toBe(Number.MAX_SAFE_INTEGER)
    for (const rate of [-1, 10001, 2.5]) expect(() => calculateTaxPaise(p(100), rate)).toThrow(RangeError)
  })

  it('aggregates validated line totals and rejects excessive discounts or zero quantities', () => {
    const lines = [{ quantity: 2, unitPricePaise: p(10000), discountPaise: p(1000), taxPaise: p(950) }]
    expect(calculateLineTotal(lines[0])).toBe(19950)
    expect(calculateTotals(lines, p(500))).toEqual({ subtotalPaise: 20000, discountPaise: 1500, taxPaise: 950, totalPaise: 19450 })
    expect(() => calculateTotals(lines, p(20000))).toThrow(RangeError)
    expect(() => calculateLineTotal({ quantity: 0, unitPricePaise: p(1) })).toThrow(RangeError)
    expect(() => calculateLineTotal({ quantity: 1, unitPricePaise: p(100), discountPaise: p(101) })).toThrow(RangeError)
  })
})

describe('normalization and UTC identifiers', () => {
  it('normalizes human text without modifying password helpers', () => {
    expect(normalizeName('  Ａdil   Khan\n')).toBe('Adil Khan')
    expect(normalizeOptionalText('  ', 'notes')).toBeNull()
    expect(normalizePhone('+91 (98765) 43210')).toBe('+919876543210')
  })

  it('rejects impossible calendar dates and accepts leap days', () => {
    expect(normalizeDateOnly('2024-02-29')).toBe('2024-02-29')
    for (const date of ['2025-02-29', '2026-04-31', '2026-13-01']) expect(() => normalizeDateOnly(date)).toThrow()
  })

  it('does not coerce booleans, arrays, or objects into integers', () => {
    expect(normalizeInteger('42', 'quantity', { min: 1 })).toBe(42)
    for (const value of [true, false, [], [1], {}, '1.2', '']) expect(() => normalizeInteger(value, 'quantity')).toThrow()
  })

  it('requires a real, canonical UTC timestamp', () => {
    expect(isUtcIsoTimestamp(utcNow())).toBe(true)
    expect(isUtcIsoTimestamp('2024-02-29T00:00:00.000Z')).toBe(true)
    for (const value of ['2026-02-30T00:00:00.000Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00.000+00:00', null]) expect(isUtcIsoTimestamp(value)).toBe(false)
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/u)
  })
})
