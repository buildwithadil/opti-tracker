import { z } from 'zod'
import { calendarDate } from './purchaseValidation.js'

export const REPORT_TIME_ZONE = 'Asia/Kolkata' as const
export const REPORT_OFFSET_MINUTES = 330
export const REPORT_MAX_DAYS = 366
const DAY = 86400000
const OFFSET = REPORT_OFFSET_MINUTES * 60000
const midnight = (date: string) => new Date(`${date}T00:00:00.000Z`).getTime()
const dateText = (milliseconds: number) => new Date(milliseconds).toISOString().slice(0, 10)

/** Saved purchase dates are calendar dates. Only timestamp boundaries move to UTC. */
export const reportRangeSchema = z.object({ dateFrom: calendarDate, dateTo: calendarDate }).strict()
  .superRefine((range, context) => {
    if (range.dateFrom > range.dateTo) context.addIssue({ code: 'custom', path: ['dateTo'], message: 'The end date cannot precede the start date.' })
    else if ((midnight(range.dateTo) - midnight(range.dateFrom)) / DAY + 1 > REPORT_MAX_DAYS) {
      context.addIssue({ code: 'custom', path: ['dateTo'], message: `Choose at most ${REPORT_MAX_DAYS} inclusive business days.` })
    }
  })
export type ReportRange = z.infer<typeof reportRangeSchema>
export function reportUtcBounds(range: ReportRange) {
  return { startUtc: new Date(midnight(range.dateFrom) - OFFSET).toISOString(), endUtcExclusive: new Date(midnight(range.dateTo) + DAY - OFFSET).toISOString() }
}
export const reportBusinessDate = (instant = new Date()) => dateText(instant.getTime() + OFFSET)
export const reportPresets = ['Today', 'Yesterday', 'Last 7 days', 'Last 30 days', 'This month', 'Previous month', 'Custom'] as const
export type ReportPreset = typeof reportPresets[number]
export function reportPresetRange(preset: Exclude<ReportPreset, 'Custom'>, instant = new Date()): ReportRange {
  const today = reportBusinessDate(instant), end = midnight(today)
  if (preset === 'Today') return { dateFrom: today, dateTo: today }
  if (preset === 'Yesterday') return { dateFrom: dateText(end - DAY), dateTo: dateText(end - DAY) }
  if (preset === 'Last 7 days' || preset === 'Last 30 days') return { dateFrom: dateText(end - (preset === 'Last 7 days' ? 6 : 29) * DAY), dateTo: today }
  const monthStart = `${today.slice(0, 7)}-01`
  if (preset === 'This month') return { dateFrom: monthStart, dateTo: today }
  const previousEnd = dateText(midnight(monthStart) - DAY)
  return { dateFrom: `${previousEnd.slice(0, 7)}-01`, dateTo: previousEnd }
}
