import type { Sale, SalesList, SalesOptions, ShopCustomer, ShopCustomerList, ShopPayment, ShopPaymentList, ReceiptOptions } from '../../shared/shop.js'
import { asPaise } from '../../shared/money.js'
import { calendarDate } from '../../shared/purchaseValidation.js'
import { normalizeIndianMobile } from '../../shared/phone.js'
import { runD1Batch } from '../lib/db.js'
import { HttpError } from '../lib/errors.js'
import { customerListPlan } from './customers.js'
import { paymentBalanceColumns, paymentBalanceJoin, validPaymentSummary, type BalanceRow } from './payment-balances.js'
import { reportPurchaseDateSql } from './reports.js'
import type { CustomerListOptions } from '../validators/customers.js'

const eligible = "p.deleted_at IS NULL AND p.status NOT IN ('void','refunded') AND p.currency_code='INR'"
const pagination = (query: { page: number; pageSize: number }, total: number) => ({ ...query, total, totalPages: Math.max(1,Math.ceil(total/query.pageSize)) })
function search(search: string, clauses: string[], values: (string | number)[]) {
  if (!search) return
  const escaped = search.replace(/[\\%_]/gu,'\\$&')
  let canonical: string | null = null
  try { canonical = normalizeIndianMobile(search) } catch { /* Literal name/invoice or partial phone search. */ }
  clauses.push("(c.name LIKE ? ESCAPE '\\' COLLATE NOCASE OR c.normalized_phone LIKE ? ESCAPE '\\' OR COALESCE(v.invoice_number,p.invoice_number,'') LIKE ? ESCAPE '\\' COLLATE NOCASE)")
  values.push(`%${escaped}%`, canonical ?? `%${escaped}%`, `%${escaped}%`)
}

/** Bounded all-date activity; no ledger mutation or invoice-at-issue balance. */
export async function listSales(db: D1Database, query: SalesOptions): Promise<SalesList> {
  const clauses = [eligible], values: (string | number)[] = []
  if (query.customer_uuid) { clauses.push('p.customer_id=?'); values.push(query.customer_uuid) }
  if (query.submission_uuid) { clauses.push('p.client_request_id=?'); values.push(query.submission_uuid) }
  if (query.dateFrom) { clauses.push(`(${reportPurchaseDateSql}>=? OR ${reportPurchaseDateSql} IS NULL)`); values.push(query.dateFrom) }
  if (query.dateTo) { clauses.push(`(${reportPurchaseDateSql}<=? OR ${reportPurchaseDateSql} IS NULL)`); values.push(query.dateTo) }
  if (query.status === 'due') clauses.push('b.outstanding_paise>0 AND c.archived_at IS NULL')
  if (query.status === 'paid') clauses.push('b.outstanding_paise=0')
  search(query.search,clauses,values)
  const from = `FROM purchases p ${paymentBalanceJoin} JOIN customers c ON c.uuid=p.customer_id LEFT JOIN invoices v ON v.purchase_uuid=p.id WHERE ${clauses.join(' AND ')}`
  const results = await runD1Batch<Record<string,unknown>>(db,[
    db.prepare(`SELECT p.id AS uuid,p.customer_id AS customer_uuid,c.name AS customer_name,c.phone AS customer_phone,c.archived_at,
      COALESCE(v.invoice_number,p.invoice_number) AS invoice_number,p.prescription_id AS prescription_uuid,${reportPurchaseDateSql} AS purchase_date,
      p.created_at,p.status,p.total_paise,${paymentBalanceColumns} ${from}
      ORDER BY ${reportPurchaseDateSql} DESC,p.created_at DESC,p.id ASC LIMIT ? OFFSET ?`).bind(...values,query.pageSize,(query.page-1)*query.pageSize),
    db.prepare(`SELECT COUNT(*) AS total ${from}`).bind(...values),
  ])
  const sales = results[0].results.map(raw => {
    const row = raw as unknown as Sale & BalanceRow
    if (!calendarDate.safeParse(row.purchase_date).success) throw new HttpError(409,'FINANCIAL_DATA_INVALID','A sale date requires review before this history can be shown.')
    return { uuid: row.uuid,customer_uuid: row.customer_uuid,customer_name: row.customer_name,customer_phone: row.customer_phone,archived_at: row.archived_at,invoice_number: row.invoice_number,prescription_uuid: row.prescription_uuid,purchase_date: row.purchase_date,created_at: row.created_at,status: row.status,...validPaymentSummary(row) }
  })
  return { sales,pagination: pagination({ page: query.page,pageSize: query.pageSize },results[1].results[0].total as number) }
}

/** Credit/last-sale information for only the requested page, in one read batch.
 * Per-customer unsafe balances stay visibly unavailable, never invented as zero. */
export async function listShopCustomers(db: D1Database, query: CustomerListOptions): Promise<ShopCustomerList> {
  const { where,parameters,order } = customerListPlan(query)
  const result = await runD1Batch<Record<string,unknown>>(db,[
    db.prepare(`WITH profiles AS (SELECT uuid,name,phone,normalized_phone,created_at,updated_at,archived_at FROM customers ${where} ORDER BY ${order} LIMIT ? OFFSET ?),
      credit AS (SELECT b.customer_uuid,CAST(SUM(b.outstanding_paise/1000000000) AS TEXT) AS whole,CAST(SUM(b.outstanding_paise%1000000000) AS TEXT) AS remainder,
        MAX(CASE WHEN b.invalid_payment OR b.legacy_reversal OR typeof(b.total_paise)<>'integer' OR b.total_paise>9007199254740991 OR b.outstanding_paise<0 THEN 1 ELSE 0 END) AS invalid
        FROM purchase_payment_balances b JOIN profiles c ON c.uuid=b.customer_uuid GROUP BY b.customer_uuid)
      SELECT c.*,COALESCE(d.whole,'0') AS whole,COALESCE(d.remainder,'0') AS remainder,COALESCE(d.invalid,0) AS invalid,
        (SELECT json_object('uuid',p.id,'purchase_date',${reportPurchaseDateSql},'total_paise',p.total_paise)
          FROM purchases p WHERE p.customer_id=c.uuid AND ${eligible}
          ORDER BY ${reportPurchaseDateSql} DESC,p.created_at DESC,p.id ASC LIMIT 1) AS last_sale_json
        FROM profiles c LEFT JOIN credit d ON d.customer_uuid=c.uuid ORDER BY ${order}`)
      .bind(...parameters,query.pageSize,(query.page-1)*query.pageSize),
    db.prepare(`SELECT COUNT(*) AS total FROM customers ${where}`).bind(...parameters),
  ])
  const customers = result[0].results.map(raw => {
    const { whole,remainder,invalid,last_sale_json,...fields } = raw
    let amount: number | null = null, last: ShopCustomer['last_sale'] = null
    try { const sum = BigInt(String(whole))*1000000000n+BigInt(String(remainder)); if (invalid || sum<0n || sum>BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(); amount=asPaise(Number(sum)) } catch { /* Review rather than a false balance. */ }
    if (last_sale_json) { try { last=JSON.parse(String(last_sale_json)) as ShopCustomer['last_sale']; asPaise(last!.total_paise); calendarDate.parse(last!.purchase_date) } catch { last=null } }
    return { ...fields,outstanding_paise: amount,balance_review_required: amount === null,last_sale: last } as unknown as ShopCustomer
  })
  return { customers,pagination: pagination({ page: query.page,pageSize: query.pageSize },result[1].results[0].total as number) }
}

export async function listShopPayments(db: D1Database, query: ReceiptOptions): Promise<ShopPaymentList> {
  const clauses = ['m.customer_id=p.customer_id'], values: (string | number)[] = []
  if (query.customer_uuid) { clauses.push('p.customer_id=?'); values.push(query.customer_uuid) }
  if (query.sale_uuid) { clauses.push('p.id=?'); values.push(query.sale_uuid) }
  if (query.submission_uuid) { clauses.push('m.client_request_id=?'); values.push(query.submission_uuid) }
  search(query.search,clauses,values)
  const from = `FROM payments m JOIN purchases p ON p.id=m.purchase_id JOIN customers c ON c.uuid=p.customer_id LEFT JOIN invoices v ON v.purchase_uuid=p.id WHERE ${clauses.join(' AND ')}`
  const result = await runD1Batch<Record<string,unknown>>(db,[
    db.prepare(`SELECT m.id AS uuid,m.purchase_id AS purchase_uuid,m.customer_id AS customer_uuid,m.amount_paise,m.payment_method,m.status,m.received_at,m.reference,m.notes,m.created_at,c.name AS customer_name,COALESCE(v.invoice_number,p.invoice_number) AS invoice_number ${from} ORDER BY m.received_at DESC,m.created_at DESC,m.id LIMIT ? OFFSET ?`).bind(...values,query.pageSize,(query.page-1)*query.pageSize),
    db.prepare(`SELECT COUNT(*) AS total ${from}`).bind(...values),
  ])
  const payments = result[0].results as unknown as ShopPayment[]
  for (const payment of payments) { try { asPaise(payment.amount_paise) } catch { throw new HttpError(409,'FINANCIAL_DATA_INVALID','A payment record requires review before its amount can be shown.') } }
  return { payments,pagination: pagination({ page: query.page,pageSize: query.pageSize },result[1].results[0].total as number) }
}
