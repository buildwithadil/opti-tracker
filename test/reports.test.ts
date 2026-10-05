import { describe, expect, it } from 'vitest'
import { reportBusinessDate } from '../shared/reportDates'
import type { DashboardResult, ReportResult } from '../shared/reports'
import { createPurchase } from '../worker/services/purchases'
import { updateCustomer } from '../worker/services/customers'
import { getReport } from '../worker/services/reports'
import { authenticatedHeaders, bindings, failure, installDatabaseHooks, jsonRequest, request, setup, success } from './helpers'
import { reportFixture, reportVolume } from './report-fixtures'

installDatabaseHooks()
const dates = 'dateFrom=2026-04-08&dateTo=2026-04-09'
const options = { range: { dateFrom: '2026-04-08', dateTo: '2026-04-09' }, page: 1, pageSize: 20 }
describe('authoritative read-only real-D1 reports and CSV', () => {
  it('aggregates saved sales, exact discounts/current balances and page-independent totals', async () => {
    const f = await reportFixture()
    const headers = authenticatedHeaders(f.owner)
    const result = await success<ReportResult>(await request(`/api/reports/sales?${dates}&pageSize=1`, { headers }))
    expect(result.summary).toEqual({ purchase_count: 4, subtotal_paise: 35001, discount_paise: 3000, tax_paise: 0, total_paise: 32001, amount_paid_paise: 23001, outstanding_paise: 9000 })
    expect(result.rows).toHaveLength(1); expect(result.pagination).toEqual({ page: 1, pageSize: 1, total: 4, totalPages: 4 })
    const page = await success<ReportResult>(await request(`/api/reports/sales?${dates}&pageSize=1&page=2`, { headers }))
    expect(page.summary).toEqual(result.summary)
    expect(page.rows[0].purchase_uuid).not.toBe(result.rows[0].purchase_uuid)
    const single = await success<ReportResult>(await request('/api/reports/sales?dateFrom=2026-04-08&dateTo=2026-04-08', { headers }))
    expect(single.summary).toMatchObject({ purchase_count: 3, total_paise: 22000, amount_paid_paise: 13000, outstanding_paise: 9000 })
  })
  it('uses inclusive IST received days with exact millisecond boundaries and method/day breakdowns', async () => {
    const f = await reportFixture(), headers = authenticatedHeaders(f.owner)
    const result = await success<ReportResult>(await request('/api/reports/payments?dateFrom=2026-04-09&dateTo=2026-04-09', { headers }))
    expect(result.summary).toEqual({ payment_count: 3, total_paise: 15000, cash_paise: 0, upi_paise: 1999, card_paise: 13001, legacy_other_paise: 0 })
    expect(result.daily).toEqual([{ business_date: '2026-04-09', payment_count: 3, total_paise: 15000 }])
    expect(result.rows.map(row => row.received_at)).toContain('2026-04-08T18:30:00.000Z')
    expect(result.rows.map(row => row.received_at)).toContain('2026-04-09T18:29:59.999Z')
    expect(result.rows.map(row => row.received_at)).not.toContain('2026-04-09T18:30:00.000Z')
  })
  it('retains archived debts, excludes fully paid/zero purchases and orders exact customer debts descending', async () => {
    const f = await reportFixture()
    const result = await success<ReportResult>(await request('/api/reports/outstanding?pageSize=1', { headers: authenticatedHeaders(f.owner) }))
    expect(result.range).toBeNull()
    expect(result.summary).toEqual({ customer_count: 2, purchase_count: 2, outstanding_paise: 9000 })
    expect(result.rows[0]).toMatchObject({ customer_uuid: f.a.uuid, purchase_count: 1, outstanding_paise: 6000 })
    const next = await success<ReportResult>(await request('/api/reports/outstanding?pageSize=1&page=2', { headers: authenticatedHeaders(f.owner) }))
    expect(next.rows[0]).toMatchObject({ customer_uuid: f.b.uuid, customer_status: 'Archived', purchase_count: 1, outstanding_paise: 3000 })
    const profiles = await success<ReportResult>(await request('/api/reports/customers', { headers: authenticatedHeaders(f.owner) }))
    expect(profiles.summary).toEqual({ customer_count: 3, active_count: 2, archived_count: 1, with_purchases_count: 2, with_outstanding_count: 2 })
  })
  it('groups original category lines and quantities without allocating purchase discounts or inventing stock', async () => {
    const f = await reportFixture()
    const result = await success<ReportResult>(await request(`/api/reports/categories?${dates}`, { headers: authenticatedHeaders(f.owner) }))
    expect(result.rows).toHaveLength(7)
    expect(result.summary).toEqual({ line_count: 5, quantity: 6, sales_paise: 34001 })
    expect(result.rows).toContainEqual({ category: 'spectacle_frames', category_label: 'Spectacle frames', line_count: 1, quantity: 2, sales_paise: 9000 })
    expect(result.rows).toContainEqual({ category: 'contact_lenses', category_label: 'Contact lenses', line_count: 0, quantity: 0, sales_paise: 0 })
  })
  it('returns genuine zero/empty data and rejects arbitrary report names', async () => {
    const owner = await setup(), headers = authenticatedHeaders(owner)
    const result = await success<ReportResult>(await request(`/api/reports/sales?${dates}`, { headers }))
    expect(result.summary.total_paise).toBe(0); expect(result.rows).toEqual([])
    await failure(await request(`/api/reports/inventory?${dates}`, { headers }),400,'INVALID_INPUT')
  })
  it('reports today and current all-date positions in one four-statement real-D1 snapshot', async () => {
    const f = await reportFixture(), today = reportBusinessDate()
    await createPurchase(bindings.DB,f.a.uuid,{ client_request_id: crypto.randomUUID(),purchase_date: today,items: [{ description: 'Today',product_category: 'other',quantity: 1,unit_price: '0.01' }] },f.actor)
    const result = await success<DashboardResult>(await request('/api/reports/dashboard',{ headers: authenticatedHeaders(f.owner) }))
    expect(result).toMatchObject({ businessDate: today,timeZone: 'Asia/Kolkata',sales: { purchase_count: 1,total_paise: 1 },payments: { payment_count: 0,total_paise: 0 },outstanding: { outstanding_paise: 9001 },customers: { customer_count: 3 } })
  })
  it('provides authenticated UTF-8 accurate full-range CSV independent of the displayed page', async () => {
    const f = await reportFixture(), headers = authenticatedHeaders(f.owner)
    for (const name of ['sales','payments','outstanding','categories']) {
      const response = await request(`/api/reports/${name}/export.csv${name === 'outstanding' ? '' : `?${dates}`}`, { headers })
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
      expect(response.headers.get('Content-Disposition')).toContain(`attachment; filename="optidesk-${name}-`)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      const csv = await response.text()
      expect(csv).toContain('\r\n'); expect(csv).not.toMatch(/Private|password|csrf|right_sphere|notes|reference/iu)
      if (name === 'sales') { expect(csv).toContain('"Asha, ""देवी"""'); expect(csv).toContain("'+91 98765 43210"); expect(csv).toContain(',170.00,110.00,60.00,partially_paid') }
    }
    await updateCustomer(bindings.DB,f.a.uuid,{ name: '=HYPERLINK("x")' },f.actor)
    const csv = await (await request(`/api/reports/sales/export.csv?${dates}`,{ headers })).text()
    expect(csv).toContain('"\'=HYPERLINK(""x"")"')
  })
  it('requires existing sessions on every JSON/CSV endpoint and rejects expired sessions without data', async () => {
    for (const path of ['dashboard','sales','payments','outstanding','customers','categories','sales/export.csv','payments/export.csv','outstanding/export.csv','categories/export.csv']) await failure(await request(`/api/reports/${path}?${dates}`),401,'AUTH_REQUIRED')
    const f = await reportFixture()
    await bindings.DB.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z'").run()
    await failure(await request(`/api/reports/sales/export.csv?${dates}`,{ headers: authenticatedHeaders(f.owner) }),401,'AUTH_REQUIRED')
  })
  it.each(['','dateFrom=2026-02-30&dateTo=2026-03-01','dateFrom=2026-04-09&dateTo=2026-04-08','dateFrom=2025-01-01&dateTo=2026-04-01',`${dates}&page=0`,`${dates}&pageSize=51`,`${dates}&page=10001`,`${dates}&page=1&page=2`,`${dates}&extra=1`,`${dates}&dateFrom=%ZZ`])('rejects invalid/duplicate/unbounded query %s',async query => {
    const owner = await setup()
    const response = await request(`/api/reports/sales?${query}`,{ headers: authenticatedHeaders(owner) })
    expect(response.status).toBe(400)
    expect((await response.json() as { success: boolean }).success).toBe(false)
  })
  it('rejects dates for current-state reports, pagination in exports and unsafe methods through existing CSRF', async () => {
    const owner = await setup(), headers = authenticatedHeaders(owner)
    for (const path of [`outstanding?${dates}`,`customers?${dates}`,`dashboard?${dates}`,`sales/export.csv?${dates}&page=1`,'customers/export.csv']) await failure(await request(`/api/reports/${path}`,{ headers }),400,'INVALID_INPUT')
    await failure(await request('/api/reports/sales',{ method: 'POST',headers: { Cookie: owner.cookie } }),403,'CSRF_ORIGIN_INVALID')
    await failure(await jsonRequest('/api/reports/sales',{}, { headers: { Cookie: owner.cookie } }),403,'CSRF_TOKEN_INVALID')
    await failure(await jsonRequest('/api/reports/sales',{}, { headers }),404,'NOT_FOUND')
  })
  it('reads preserve every stored business/financial/audit row and timestamp', async () => {
    const f = await reportFixture(), headers = authenticatedHeaders(f.owner)
    const tables = ['customers','prescriptions','purchases','purchase_items','payments','invoices','invoice_number_reservations','audit_logs','shop_settings']
    const snapshot = () => Promise.all(tables.map(table => bindings.DB.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all().then(result => result.results)))
    const before = await snapshot()
    for (const name of ['sales','payments','categories']) { await success(await request(`/api/reports/${name}?${dates}`,{ headers })); expect((await request(`/api/reports/${name}/export.csv?${dates}`,{ headers })).status).toBe(200) }
    for (const name of ['dashboard','outstanding','customers']) await success(await request(`/api/reports/${name}`,{ headers }))
    expect(await snapshot()).toEqual(before)
  })
  it('returns maximum-safe money exactly and fails closed on aggregate overflow without rounding', async () => {
    const f = await reportFixture()
    await createPurchase(bindings.DB,f.c.uuid,{ client_request_id: crypto.randomUUID(),purchase_date: '2026-03-01',items: [{ description: 'Maximum',product_category: 'other',quantity: 1,unit_price: '90071992547409.91' }] },f.actor)
    const range = { dateFrom: '2026-03-01',dateTo: '2026-03-01' }
    const result = await getReport(bindings.DB,'sales',{ ...options,range })
    expect(result.summary.total_paise).toBe(Number.MAX_SAFE_INTEGER)
    const csv = await request('/api/reports/sales/export.csv?dateFrom=2026-03-01&dateTo=2026-03-01',{ headers: authenticatedHeaders(f.owner) })
    expect(await csv.text()).toContain('90071992547409.91')
    await failure(await request(`/api/reports/sales?dateFrom=2026-03-01&dateTo=2026-04-09`,{ headers: authenticatedHeaders(f.owner) }),409,'REPORT_TOTAL_OUT_OF_RANGE')
    await failure(await request('/api/reports/outstanding',{ headers: authenticatedHeaders(f.owner) }),409,'REPORT_TOTAL_OUT_OF_RANGE')
  })
  it('handles 5,001 complete audited sales with constant query count, bounded pages and exact export-limit behavior', async () => {
    const owner = await setup()
    const customer = crypto.randomUUID()
    await bindings.DB.prepare('INSERT INTO customers(uuid,name,phone,normalized_phone) VALUES (?,\'Volume customer\',\'+91 98765 43210\',\'+919876543210\')').bind(customer).run()
    await reportVolume(customer,owner.data.id,5000)
    const fullExport = await request(`/api/reports/sales/export.csv?${dates}`,{ headers: authenticatedHeaders(owner) })
    expect(fullExport.status).toBe(200)
    expect((await fullExport.text()).trim().split('\r\n')).toHaveLength(5001)
    await reportVolume(customer,owner.data.id,1)
    let statements = 0
    const tracked = new Proxy(bindings.DB,{ get(target,prop) { if (prop === 'batch') return (queries: D1PreparedStatement[]) => { statements += queries.length; return target.batch(queries) }; const value = Reflect.get(target,prop); return typeof value === 'function' ? value.bind(target) : value } })
    const result = await getReport(tracked,'sales',{ ...options,pageSize: 10,page: 2 })
    expect(statements).toBe(3); expect(result.rows).toHaveLength(10)
    expect(result.pagination.total).toBe(5001); expect(result.summary).toMatchObject({ purchase_count: 5001,total_paise: 505101,outstanding_paise: 505101 })
    await failure(await request(`/api/reports/sales/export.csv?${dates}`,{ headers: authenticatedHeaders(owner) }),413,'REPORT_EXPORT_TOO_LARGE')
    const plan = await bindings.DB.prepare("EXPLAIN QUERY PLAN SELECT p.id,b.amount_paid_paise,c.name FROM purchases AS p JOIN purchase_payment_balances AS b ON b.purchase_uuid=p.id LEFT JOIN customers AS c ON c.uuid=p.customer_id LEFT JOIN invoices AS v ON v.purchase_uuid=p.id WHERE p.deleted_at IS NULL AND p.status NOT IN ('void','refunded') AND p.currency_code='INR' AND COALESCE(p.purchase_date,date(p.created_at,'+330 minutes')) BETWEEN ? AND ? ORDER BY COALESCE(p.purchase_date,date(p.created_at,'+330 minutes')) DESC,p.id").bind('2026-04-08','2026-04-09').all<{ detail: string }>()
    expect(plan.results.some(row => row.detail.includes('SEARCH p USING INDEX idx_purchases_report_date'))).toBe(true)
    expect(plan.results.some(row => row.detail.includes('TEMP B-TREE'))).toBe(false)
  },120000)
})
