import type { DashboardResult, ExportReportName, ReportName, ReportResult } from '../../shared/reports'
import type { ReportRange } from '../../shared/reportDates'
import { ApiError, apiRequest, downloadCsv } from './api'

export interface ReportQuery { range: ReportRange | null; page: number; pageSize: number }
const params = (query: ReportQuery, exporting = false) => new URLSearchParams({ ...(query.range ?? {}), ...(exporting ? {} : { page: String(query.page), pageSize: String(query.pageSize) }) })
export const reportsApi = {
  report: (name: ReportName, query: ReportQuery, signal?: AbortSignal) => apiRequest<ReportResult>(`/api/reports/${name}?${params(query)}`, { signal }),
  dashboard: ({ signal }: { signal?: AbortSignal } = {}) => apiRequest<DashboardResult>('/api/reports/dashboard', { signal }),
  download: (name: ExportReportName, query: ReportQuery) => downloadCsv(`/api/reports/${name}/export.csv?${params(query, true)}`),
}
export const reportErrorMessage = (error: unknown) => error instanceof ApiError || error instanceof Error ? error.message : 'The report could not be loaded. Please try again.'
