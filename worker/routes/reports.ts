import type { BlazeApp } from 'blazefw'
import { z } from 'zod'
import type { Env } from '../types.js'
import { apiSuccess, sendResponse } from '../lib/api.js'
import { requireAdmin } from '../lib/auth.js'
import { exportReport, getDashboard, getReport } from '../services/reports.js'
import { assertEmptyReportQuery, parseReportQuery, reportPathSchema } from '../validators/reports.js'
import type { RegisterRoute } from './auth.js'

export function registerReports(app: BlazeApp<Env>, route: RegisterRoute): void {
  app.get('/api/reports/dashboard', route(async (req, res) => {
    requireAdmin(req)
    assertEmptyReportQuery(new URL(req.raw.url))
    sendResponse(res, apiSuccess(await getDashboard(req.env.DB), { meta: { requestId: req.id } }))
  }))
  app.get('/api/reports/:report/export.csv', route(async (req, res) => {
    requireAdmin(req)
    const { report } = z.object({ report: z.enum(['sales','payments','outstanding','categories']) }).strict().parse(req.params)
    const { csv, filename } = await exportReport(req.env.DB, report, parseReportQuery(new URL(req.raw.url), report, true))
    // Blaze's send() checks the capitalized key before adding its fallback type.
    // Send through the writer to retain every central authentication/security header.
    res.header('Content-Type', 'text/csv; charset=utf-8')
    res.header('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(csv)
  }))
  app.get('/api/reports/:report', route(async (req, res) => {
    requireAdmin(req)
    const { report } = reportPathSchema.parse(req.params)
    sendResponse(res, apiSuccess(await getReport(req.env.DB, report, parseReportQuery(new URL(req.raw.url), report)), { meta: { requestId: req.id } }))
  }))
}
