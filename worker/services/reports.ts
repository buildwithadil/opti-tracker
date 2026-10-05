import { asPaise, formatPaise } from '../../shared/money.js'
import { purchaseCategories, purchaseCategoryLabels } from '../../shared/purchases.js'
import { REPORT_OFFSET_MINUTES, REPORT_TIME_ZONE, reportBusinessDate, reportUtcBounds, type ReportRange } from '../../shared/reportDates.js'
import { REPORT_EXPORT_ROWS, type DashboardResult, type ExportReportName, type ReportName, type ReportResult, type ReportRow } from '../../shared/reports.js'
import { runD1Batch } from '../lib/db.js'
import { HttpError } from '../lib/errors.js'
import { createCsv } from '../lib/csv.js'
import type { ReportOptions } from '../validators/reports.js'

const BASE = 1000000000n
const MAX = BigInt(Number.MAX_SAFE_INTEGER)
// Literal SQL only: identifiers/expressions below are never taken from a request.
const businessDateSql = (timestamp: string) => `date(${timestamp},'+${REPORT_OFFSET_MINUTES} minutes')`
export const reportPurchaseDateSql = `COALESCE(p.purchase_date,${businessDateSql('p.created_at')})`
const eligible = "p.deleted_at IS NULL AND p.status NOT IN ('void','refunded') AND p.currency_code='INR'"
// An indexed NULL lookup prevents undated history from disappearing, while the
// actual range scan stays sargable (no OR forcing a full ordered index scan).
const missingSaleDate = `EXISTS(SELECT 1 FROM purchases AS p WHERE ${eligible} AND ${reportPurchaseDateSql} IS NULL)`
const badMoney = (column: string) => `(typeof(${column})<>'integer' OR ${column}<0 OR ${column}>9007199254740991)`
const invalidBalance = `b.invalid_payment OR b.legacy_reversal OR ${badMoney('p.total_paise')}
  OR ${badMoney('b.amount_paid_paise')} OR ${badMoney('b.outstanding_paise')}
  OR b.amount_paid_paise+b.outstanding_paise<>p.total_paise OR c.uuid IS NULL`
const sums = (columns: Record<string, string>) => Object.entries(columns).map(([name, expression]) => `
  CAST(COALESCE(SUM((${expression})/1000000000),0) AS TEXT) AS ${name}_whole,
  CAST(COALESCE(SUM((${expression})%1000000000),0) AS TEXT) AS ${name}_remainder`).join(',')
const invalidAggregate = 'COALESCE(MAX(CASE WHEN invalid THEN 1 ELSE 0 END),0) AS invalid'
const salesMoney = { subtotal_paise: 'subtotal_paise', discount_paise: 'discount_paise', tax_paise: 'tax_paise', total_paise: 'total_paise', amount_paid_paise: 'amount_paid_paise', outstanding_paise: 'outstanding_paise' }
const paymentMoney = { total_paise: 'amount_paise', cash_paise: "CASE WHEN payment_method='cash' THEN amount_paise ELSE 0 END", upi_paise: "CASE WHEN payment_method='upi' THEN amount_paise ELSE 0 END", card_paise: "CASE WHEN payment_method='card' THEN amount_paise ELSE 0 END", legacy_other_paise: "CASE WHEN payment_method NOT IN ('cash','upi','card') THEN amount_paise ELSE 0 END" }
function financialError(): never { throw new HttpError(409, 'FINANCIAL_DATA_INVALID', 'Existing financial records require review before this report can be shown. No records have been changed.') }
function exactAggregate(whole: string | number | null, remainder: string | number | null): number {
  const value = BigInt(whole ?? 0) * BASE + BigInt(remainder ?? 0)
  if (value < 0n || value > MAX) throw new HttpError(409, 'REPORT_TOTAL_OUT_OF_RANGE', 'This report total exceeds the supported integer-paise/count range. Choose a smaller date range where available.')
  return Number(value)
}
/** SQL does the aggregation; BigInt reconstructs only its constant-size results. */
function publicRow(row: ReportRow): ReportRow {
  if (row.invalid) financialError()
  const result: ReportRow = {}
  for (const [key, value] of Object.entries(row)) {
    if (key === 'invalid' || key.endsWith('_remainder')) continue
    if (key.endsWith('_whole')) result[key.slice(0, -6)] = exactAggregate(value, row[`${key.slice(0, -6)}_remainder`])
    else {
      if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) financialError()
      result[key] = value
    }
  }
  return result
}
const numericSummary = (row: ReportRow) => publicRow(row) as Record<string, number>

interface Plan { cte: string; values: (string | number)[]; summary: string; detail: string; daily?: string }
function salesScope() {
  return `sales AS (SELECT p.id AS purchase_uuid,p.customer_id AS customer_uuid,c.name AS customer_name,
    c.phone AS customer_phone,CASE WHEN c.archived_at IS NULL THEN 'Active' ELSE 'Archived' END AS customer_status,
    ${reportPurchaseDateSql} AS purchase_date,COALESCE(v.invoice_number,p.invoice_number) AS invoice_number,
    p.subtotal_paise,p.discount_paise,p.tax_paise,p.total_paise,b.amount_paid_paise,b.outstanding_paise,b.payment_status,
    (${invalidBalance} OR ${badMoney('p.subtotal_paise')} OR ${badMoney('p.discount_paise')}
      OR ${badMoney('p.tax_paise')} OR p.total_paise<>p.subtotal_paise-p.discount_paise+p.tax_paise
      OR date(${reportPurchaseDateSql},'+0 days') IS NOT ${reportPurchaseDateSql}) AS invalid
    FROM purchases AS p JOIN purchase_payment_balances AS b ON b.purchase_uuid=p.id
    LEFT JOIN customers AS c ON c.uuid=p.customer_id LEFT JOIN invoices AS v ON v.purchase_uuid=p.id
    WHERE ${eligible} AND ${reportPurchaseDateSql} BETWEEN ? AND ?)`
}
// Same all-purchase debt semantics as customerCreditSummary, including archived
// customers and retained legacy purchases. A date filter must not hide old debt.
const creditScope = `balances AS (SELECT p.id AS purchase_uuid,p.customer_id AS customer_uuid,
  b.outstanding_paise,(${invalidBalance} OR p.currency_code<>'INR') AS invalid
  FROM purchases AS p JOIN purchase_payment_balances AS b ON b.purchase_uuid=p.id
  LEFT JOIN customers AS c ON c.uuid=p.customer_id),
  debts AS (SELECT customer_uuid,COUNT(*) AS purchase_count,
    SUM(outstanding_paise/1000000000) AS outstanding_paise_whole,
    SUM(outstanding_paise%1000000000) AS outstanding_paise_remainder
    FROM balances WHERE outstanding_paise>0 GROUP BY customer_uuid)`

function planFor(report: ReportName, range: ReportRange | null): Plan {
  if (report === 'sales') return {
    cte: salesScope(), values: [range!.dateFrom, range!.dateTo],
    summary: `SELECT COUNT(*) AS purchase_count,${sums(salesMoney)},MAX(${invalidAggregate.replace(' AS invalid','')},${missingSaleDate}) AS invalid FROM sales`,
    detail: `SELECT purchase_uuid,customer_uuid,customer_name,customer_phone,customer_status,purchase_date,invoice_number,
      subtotal_paise,discount_paise,tax_paise,total_paise,amount_paid_paise,outstanding_paise,payment_status,invalid
      FROM sales ORDER BY purchase_date DESC,purchase_uuid ASC`,
  }
  if (report === 'payments') {
    const bounds = reportUtcBounds(range!)
    return {
      cte: `receipts AS (SELECT m.id AS payment_uuid,p.id AS purchase_uuid,p.customer_id AS customer_uuid,
        c.name AS customer_name,c.phone AS customer_phone,m.received_at,${businessDateSql('m.received_at')} AS business_date,
        m.payment_method,m.amount_paise,(${invalidBalance} OR ${badMoney('m.amount_paise')}
          OR m.amount_paise=0 OR strftime('%Y-%m-%dT%H:%M:%fZ',m.received_at,'+0 seconds') IS NOT m.received_at) AS invalid
        FROM payments AS m JOIN purchases AS p ON p.id=m.purchase_id
        JOIN purchase_payment_balances AS b ON b.purchase_uuid=p.id LEFT JOIN customers AS c ON c.uuid=p.customer_id
        WHERE m.status='settled' AND m.deleted_at IS NULL AND p.currency_code='INR'
          AND m.received_at>=? AND m.received_at<?)`, values: [bounds.startUtc, bounds.endUtcExclusive],
      summary: `SELECT COUNT(*) AS payment_count,${sums(paymentMoney)},${invalidAggregate} FROM receipts`,
      detail: 'SELECT payment_uuid,purchase_uuid,customer_uuid,customer_name,customer_phone,received_at,business_date,payment_method,amount_paise,invalid FROM receipts ORDER BY received_at DESC,payment_uuid ASC',
      daily: `SELECT business_date,COUNT(*) AS payment_count,${sums({ total_paise: 'amount_paise' })},${invalidAggregate} FROM receipts GROUP BY business_date ORDER BY business_date DESC`,
    }
  }
  if (report === 'categories') {
    const categories = purchaseCategories.map(category => `'${category}'`).join(',')
    return {
      cte: `${salesScope()},lines AS (SELECT CASE WHEN i.product_category IN (${categories}) THEN i.product_category ELSE 'unknown_legacy' END AS category,
        i.quantity,i.line_total_paise,(s.invalid OR ${badMoney('i.quantity')} OR i.quantity=0 OR ${badMoney('i.line_total_paise')}) AS invalid
        FROM sales AS s JOIN purchase_items AS i ON i.purchase_id=s.purchase_uuid),
        category_totals AS (SELECT category,COUNT(*) AS line_count,${sums({ quantity: 'quantity', sales_paise: 'line_total_paise' })},${invalidAggregate}
          FROM lines GROUP BY category),category_keys AS (SELECT value AS category FROM json_each(?)
          UNION ALL SELECT 'unknown_legacy' WHERE EXISTS(SELECT 1 FROM lines WHERE category='unknown_legacy'))`,
      values: [range!.dateFrom, range!.dateTo, JSON.stringify(purchaseCategories)],
      summary: `SELECT COUNT(*) AS line_count,${sums({ quantity: 'quantity', sales_paise: 'line_total_paise' })},
        MAX(${invalidAggregate.replace(' AS invalid', '')},COALESCE((SELECT MAX(invalid) FROM sales),0),${missingSaleDate}) AS invalid FROM lines`,
      detail: `SELECT k.category,COALESCE(t.line_count,0) AS line_count,COALESCE(t.quantity_whole,'0') AS quantity_whole,
        COALESCE(t.quantity_remainder,'0') AS quantity_remainder,COALESCE(t.sales_paise_whole,'0') AS sales_paise_whole,
        COALESCE(t.sales_paise_remainder,'0') AS sales_paise_remainder,COALESCE(t.invalid,0) AS invalid
        FROM category_keys AS k LEFT JOIN category_totals AS t ON t.category=k.category ORDER BY k.category ASC`,
    }
  }
  if (report === 'outstanding') return {
    cte: creditScope, values: [],
    summary: `SELECT COUNT(DISTINCT CASE WHEN outstanding_paise>0 THEN customer_uuid END) AS customer_count,
      COALESCE(SUM(CASE WHEN outstanding_paise>0 THEN 1 ELSE 0 END),0) AS purchase_count,
      ${sums({ outstanding_paise: 'outstanding_paise' })},${invalidAggregate} FROM balances`,
    detail: `SELECT d.customer_uuid,c.name AS customer_name,c.phone AS customer_phone,
      CASE WHEN c.archived_at IS NULL THEN 'Active' ELSE 'Archived' END AS customer_status,d.purchase_count,
      CAST(d.outstanding_paise_whole AS TEXT) AS outstanding_paise_whole,
      CAST(d.outstanding_paise_remainder AS TEXT) AS outstanding_paise_remainder
      FROM debts AS d JOIN customers AS c ON c.uuid=d.customer_uuid
      ORDER BY (d.outstanding_paise_whole+d.outstanding_paise_remainder/1000000000) DESC,
        (d.outstanding_paise_remainder%1000000000) DESC,d.customer_uuid ASC`,
  }
  return {
    cte: `${creditScope},profiles AS (SELECT c.uuid AS customer_uuid,c.name AS customer_name,c.phone AS customer_phone,
      CASE WHEN c.archived_at IS NULL THEN 'Active' ELSE 'Archived' END AS customer_status,
      EXISTS(SELECT 1 FROM purchases AS p WHERE p.customer_id=c.uuid) AS has_purchase,
      COALESCE(d.outstanding_paise_whole,0) AS outstanding_paise_whole,COALESCE(d.outstanding_paise_remainder,0) AS outstanding_paise_remainder,
      CASE WHEN d.customer_uuid IS NULL THEN 0 ELSE 1 END AS has_outstanding
      FROM customers AS c LEFT JOIN debts AS d ON d.customer_uuid=c.uuid)`, values: [],
    summary: `SELECT COUNT(*) AS customer_count,COALESCE(SUM(customer_status='Active'),0) AS active_count,
      COALESCE(SUM(customer_status='Archived'),0) AS archived_count,COALESCE(SUM(has_purchase),0) AS with_purchases_count,
      COALESCE(SUM(has_outstanding),0) AS with_outstanding_count,COALESCE((SELECT MAX(invalid) FROM balances),0) AS invalid FROM profiles`,
    detail: 'SELECT customer_uuid,customer_name,customer_phone,customer_status,has_purchase,CAST(outstanding_paise_whole AS TEXT) AS outstanding_paise_whole,CAST(outstanding_paise_remainder AS TEXT) AS outstanding_paise_remainder FROM profiles ORDER BY customer_name COLLATE NOCASE ASC,customer_uuid ASC',
  }
}
function countSql(report: ReportName) {
  return { sales: 'SELECT COUNT(*) AS total FROM sales', payments: 'SELECT COUNT(*) AS total FROM receipts', outstanding: 'SELECT COUNT(*) AS total FROM debts', categories: 'SELECT COUNT(*) AS total FROM category_keys', customers: 'SELECT COUNT(*) AS total FROM profiles' }[report]
}
function statements(db: D1Database, report: ReportName, options: ReportOptions, exporting = false) {
  const plan = planFor(report, options.range)
  const query = (sql: string, extra: number[] = []) => db.prepare(`WITH ${plan.cte} ${sql}`).bind(...plan.values, ...extra)
  return [query(plan.summary), query(countSql(report)), query(`${plan.detail} LIMIT ? OFFSET ?`, [exporting ? REPORT_EXPORT_ROWS + 1 : options.pageSize, exporting ? 0 : (options.page - 1) * options.pageSize]), ...(plan.daily ? [query(plan.daily)] : [])]
}
async function readBatch(db: D1Database, queries: D1PreparedStatement[]) {
  try { return await runD1Batch<ReportRow>(db, queries) }
  catch (error) { if (error instanceof Error && /integer overflow/u.test(error.message)) financialError(); throw error }
}
export async function getReport(db: D1Database, report: ReportName, options: ReportOptions, exporting = false): Promise<ReportResult> {
  const results = await readBatch(db, statements(db, report, options, exporting))
  const summary = numericSummary(results[0].results[0]), total = results[1].results[0].total as number
  if (exporting && total > REPORT_EXPORT_ROWS) throw new HttpError(413, 'REPORT_EXPORT_TOO_LARGE', `A CSV may contain at most ${REPORT_EXPORT_ROWS} rows. Choose a smaller date range or use the paginated report.`)
  const rows = results[2].results.map(publicRow)
  if (report === 'categories') rows.forEach(row => { row.category_label = row.category === 'unknown_legacy' ? 'Unknown legacy category' : purchaseCategoryLabels[row.category as keyof typeof purchaseCategoryLabels] })
  return { report, timeZone: REPORT_TIME_ZONE, range: options.range, generatedAt: new Date().toISOString(), summary, rows,
    ...(results[3] ? { daily: results[3].results.map(publicRow) } : {}),
    pagination: { page: exporting ? 1 : options.page, pageSize: exporting ? REPORT_EXPORT_ROWS : options.pageSize, total, totalPages: Math.max(1, Math.ceil(total / (exporting ? REPORT_EXPORT_ROWS : options.pageSize))) } }
}
export async function getDashboard(db: D1Database): Promise<DashboardResult> {
  const businessDate = reportBusinessDate(), range = { dateFrom: businessDate, dateTo: businessDate }
  const names = ['sales', 'payments', 'outstanding', 'customers'] as const
  const queries = names.map(name => { const p = planFor(name, name === 'sales' || name === 'payments' ? range : null); return db.prepare(`WITH ${p.cte} ${p.summary}`).bind(...p.values) })
  const results = await readBatch(db, queries)
  return { businessDate, timeZone: REPORT_TIME_ZONE, generatedAt: new Date().toISOString(), sales: numericSummary(results[0].results[0]), payments: numericSummary(results[1].results[0]), outstanding: numericSummary(results[2].results[0]), customers: numericSummary(results[3].results[0]) }
}

const csvColumns: Record<ExportReportName, [string, string][]> = {
  sales: [['purchase_date','Purchase date (Asia/Kolkata calendar)'],['purchase_uuid','Purchase ID'],['invoice_number','Invoice number'],['customer_name','Customer name'],['customer_phone','Phone'],['customer_status','Customer status'],['subtotal_paise','Gross sales INR'],['discount_paise','Discounts INR'],['tax_paise','Persisted tax INR'],['total_paise','Grand total INR'],['amount_paid_paise','Paid to date INR'],['outstanding_paise','Outstanding to date INR'],['payment_status','Payment status']],
  payments: [['received_at','Received at UTC'],['business_date','Business date Asia/Kolkata'],['payment_uuid','Payment ID'],['purchase_uuid','Purchase ID'],['customer_name','Customer name'],['customer_phone','Phone'],['payment_method','Method'],['amount_paise','Amount INR']],
  outstanding: [['customer_name','Customer name'],['customer_phone','Phone'],['customer_status','Customer status'],['purchase_count','Outstanding purchases'],['outstanding_paise','Current outstanding INR']],
  categories: [['category_label','Category snapshot'],['line_count','Line items'],['quantity','Quantity'],['sales_paise','Line sales INR']],
}
export async function exportReport(db: D1Database, report: ExportReportName, options: ReportOptions) {
  const result = await getReport(db, report, options, true), columns = csvColumns[report]
  const csv = createCsv(columns.map(([, header]) => header), result.rows.map(row => columns.map(([key]) => key.endsWith('_paise') ? formatPaise(asPaise(row[key] as number)) : row[key])))
  const dates = result.range ? `${result.range.dateFrom}_${result.range.dateTo}` : `current_${reportBusinessDate()}`
  return { csv, filename: `optidesk-${report}-${dates}.csv` }
}
