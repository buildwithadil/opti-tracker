import { describe, expect, it } from 'vitest'
import { reportBusinessDate, reportPresetRange, reportRangeSchema, reportUtcBounds } from '../shared/reportDates'
import { createCsv } from '../worker/lib/csv'

describe('business-day boundaries and spreadsheet-safe UTF-8 CSV', () => {
  it('crosses India midnight exactly without device timezone dependence', () => {
    expect(reportBusinessDate(new Date('2026-04-08T18:29:59.999Z'))).toBe('2026-04-08')
    expect(reportBusinessDate(new Date('2026-04-08T18:30:00.000Z'))).toBe('2026-04-09')
    expect(reportUtcBounds({ dateFrom: '2024-02-29',dateTo: '2024-02-29' })).toEqual({ startUtc: '2024-02-28T18:30:00.000Z',endUtcExclusive: '2024-02-29T18:30:00.000Z' })
  })
  it('handles leap years and inclusive 366-day maximum and rejects impossible/oversized dates', () => {
    expect(reportRangeSchema.safeParse({ dateFrom: '2024-01-01',dateTo: '2024-12-31' }).success).toBe(true)
    expect(reportRangeSchema.safeParse({ dateFrom: '2024-01-01',dateTo: '2025-01-01' }).success).toBe(false)
    expect(reportRangeSchema.safeParse({ dateFrom: '1900-02-29',dateTo: '1900-03-01' }).success).toBe(false)
    expect(reportRangeSchema.safeParse({ dateFrom: '2000-02-29',dateTo: '2000-03-01' }).success).toBe(true)
    expect(reportUtcBounds({ dateFrom: '0001-01-01',dateTo: '0001-01-01' }).startUtc).toBe('0000-12-31T18:30:00.000Z')
    expect(reportUtcBounds({ dateFrom: '9999-12-31',dateTo: '9999-12-31' }).endUtcExclusive).toBe('9999-12-31T18:30:00.000Z')
  })
  it('derives all presets across year/month/leap-day boundaries', () => {
    const now = new Date('2024-02-29T18:30:00.000Z')
    expect(reportPresetRange('Today',now)).toEqual({ dateFrom: '2024-03-01',dateTo: '2024-03-01' })
    expect(reportPresetRange('Yesterday',now)).toEqual({ dateFrom: '2024-02-29',dateTo: '2024-02-29' })
    expect(reportPresetRange('Last 7 days',now)).toEqual({ dateFrom: '2024-02-24',dateTo: '2024-03-01' })
    expect(reportPresetRange('Last 30 days',now)).toEqual({ dateFrom: '2024-02-01',dateTo: '2024-03-01' })
    expect(reportPresetRange('This month',now)).toEqual({ dateFrom: '2024-03-01',dateTo: '2024-03-01' })
    expect(reportPresetRange('Previous month',now)).toEqual({ dateFrom: '2024-02-01',dateTo: '2024-02-29' })
    expect(reportPresetRange('Previous month',new Date('2026-01-15T00:00:00.000Z'))).toEqual({ dateFrom: '2025-12-01',dateTo: '2025-12-31' })
  })
  it('escapes commas, quotes and embedded newlines while preserving UTF-8 and exact decimals', () => {
    expect(createCsv(['Name','Value'],[['A, "देवी"\r\nNext','90071992547409.91'],[null,0]])).toBe('\uFEFFName,Value\r\n"A, ""देवी""\r\nNext",90071992547409.91\r\n,0\r\n')
  })
  it.each(['=SUM(1)','+919876543210','-1+2','@SUM(1)',' \t=1','\ttext','\ntext','\u200b=1'])('neutralizes spreadsheet control/formula text %j',value => {
    expect(createCsv(['Text'],[[value]])).toContain(value.includes('\n') ? `"'${value}"` : `'${value}`)
  })
  it('enforces UTF-8 bytes rather than JS character count on the export byte limit', () => {
    expect(() => createCsv(['Text'],[['देवी'.repeat(500000)]])).toThrow(/exceeds 5 MiB/u)
  })
})
