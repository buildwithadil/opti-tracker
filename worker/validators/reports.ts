import { z } from 'zod'
import { reportNames, type ReportName } from '../../shared/reports.js'
import { reportRangeSchema, type ReportRange } from '../../shared/reportDates.js'
import { readQueryParameters } from '../lib/query.js'

export const reportPathSchema = z.object({ report: z.enum(reportNames) }).strict()
const integer = (max: number) => z.string().regex(/^[1-9][0-9]*$/u).transform(Number).pipe(z.number().int().min(1).max(max))
const pageSchema = z.object({ page: integer(10000).default(1), pageSize: integer(50).default(20) }).strict()
export interface ReportOptions { range: ReportRange | null; page: number; pageSize: number }
export const activityReport = (report: ReportName) => ['sales', 'payments', 'categories'].includes(report)
export function parseReportQuery(url: URL, report: ReportName, exporting = false): ReportOptions {
  const values = readQueryParameters(url, 'report')
  const schema = activityReport(report)
    ? z.object({ dateFrom: z.string(), dateTo: z.string(), ...(exporting ? {} : pageSchema.shape) }).strict()
    : exporting ? z.object({}).strict() : pageSchema
  schema.parse(values)
  const range = activityReport(report) ? reportRangeSchema.parse({ dateFrom: values.dateFrom, dateTo: values.dateTo }) : null
  return { range, ...pageSchema.parse(exporting ? {} : { page: values.page, pageSize: values.pageSize }) }
}
export function assertEmptyReportQuery(url: URL): void { z.object({}).strict().parse(readQueryParameters(url, 'dashboard')) }
