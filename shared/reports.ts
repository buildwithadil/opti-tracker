import type { ReportRange, REPORT_TIME_ZONE } from './reportDates.js'
export const reportNames = ['sales', 'payments', 'outstanding', 'customers', 'categories'] as const
export type ReportName = typeof reportNames[number]
export type ExportReportName = Exclude<ReportName, 'customers'>
export const reportLabels: Record<ReportName, string> = { sales: 'Sales', payments: 'Payments', outstanding: 'Outstanding credit', customers: 'Customers', categories: 'Product categories' }
export const REPORT_EXPORT_ROWS = 5000
export const REPORT_EXPORT_BYTES = 5 * 1024 * 1024
export type ReportRow = Record<string, string | number | null>
export interface ReportResult {
  report: ReportName
  timeZone: typeof REPORT_TIME_ZONE
  range: ReportRange | null
  generatedAt: string
  summary: Record<string, number>
  rows: ReportRow[]
  daily?: ReportRow[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}
export interface DashboardResult {
  businessDate: string
  timeZone: typeof REPORT_TIME_ZONE
  generatedAt: string
  sales: Record<string, number>
  payments: Record<string, number>
  outstanding: Record<string, number>
  customers: Record<string, number>
}
