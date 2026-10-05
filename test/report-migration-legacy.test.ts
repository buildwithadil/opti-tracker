import { applyD1Migrations, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { bindings, seedCustomer, seedOwner } from './helpers'
import { getReport, reportPurchaseDateSql } from '../worker/services/reports'

beforeEach(async () => { await reset(); await applyD1Migrations(bindings.DB,bindings.TEST_MIGRATIONS.slice(0,5)) })
async function legacy(kind = 'normal') {
  const owner = await seedOwner(); await seedCustomer('legacy')
  await bindings.DB.prepare(`INSERT INTO purchases(id,customer_id,subtotal_paise,discount_paise,tax_paise,total_paise,purchase_date,created_at,notes)
    VALUES ('legacy-sale','legacy',10000,100,200,10100,NULL,?,'Private old note')`).bind(kind === 'undated' ? 'unusable-old-time' : '2026-04-08T18:30:00.000Z').run()
  await bindings.DB.prepare(`INSERT INTO purchase_items(id,purchase_id,description,product_category,quantity,unit_price_paise,discount_paise,tax_paise,line_total_paise,taxable_paise)
    VALUES ('legacy-item','legacy-sale','Private old description','unrecognized-old-category',2,5000,100,200,10100,9900)`).run()
  for (const [index,status,method,amount] of [[0,'settled','bank_transfer',kind === 'fractional' ? 0.5 : kind === 'overpaid' ? 10101 : 1000],[1,'pending','cash',1000],[2,'voided','card',1000],[3,'refunded','upi',1000]] as const) {
    await bindings.DB.prepare(`INSERT INTO payments(id,purchase_id,customer_id,amount_paise,payment_method,status,received_at,settled_at,reference,notes)
      VALUES (?,'legacy-sale','legacy',?,?,?,'2026-04-08T18:30:00.000Z','2026-04-08T18:30:00.000Z','Private ref','Private payment note')`).bind(`legacy-pay-${index}`,amount,method,status).run()
  }
  await bindings.DB.prepare(`INSERT INTO payments(id,purchase_id,customer_id,amount_paise,payment_method,received_at,deleted_at,deleted_by_admin_id)
    VALUES ('legacy-deleted','legacy-sale','legacy',1000,'cash','2026-04-08T18:30:00.000Z','2026-04-09T00:00:00.000Z',?)`).bind(owner).run()
  if (kind === 'reversed') await bindings.DB.prepare("INSERT INTO payment_reversals(id,payment_id,amount_paise,reason) VALUES ('old-reversal','legacy-pay-0',100,'Private old correction')").run()
  await applyD1Migrations(bindings.DB,bindings.TEST_MIGRATIONS.slice(0,8))
}
const options = { range: { dateFrom: '2026-04-09',dateTo: '2026-04-09' },page: 1,pageSize: 20 }
describe('index-only populated migration, retained tax and unsupported legacy finance', () => {
  it('preserves every original row/column/rowid/root page and changes only the index plus migration ledger',async () => {
    await legacy()
    const tables = (await bindings.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' AND name<>'d1_migrations' ORDER BY name").all<{ name: string }>()).results.map(row => row.name)
    const rows = () => Promise.all(tables.map(table => bindings.DB.prepare(`SELECT rowid AS preserved_rowid,* FROM "${table}" ORDER BY rowid`).all().then(result => result.results)))
    const before = await rows()
    const roots = (await bindings.DB.prepare("SELECT name,rootpage FROM sqlite_master WHERE type='table' ORDER BY name").all()).results
    await applyD1Migrations(bindings.DB,bindings.TEST_MIGRATIONS)
    expect(await rows()).toEqual(before)
    expect((await bindings.DB.prepare("SELECT name,rootpage FROM sqlite_master WHERE type='table' ORDER BY name").all()).results).toEqual(roots)
    await applyD1Migrations(bindings.DB,bindings.TEST_MIGRATIONS)
    expect(await rows()).toEqual(before)
    expect(await bindings.DB.prepare('SELECT COUNT(*) AS total FROM d1_migrations').first()).toEqual({ total: 9 })
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
    expect(await bindings.DB.prepare('PRAGMA quick_check').first()).toEqual({ quick_check: 'ok' })
  })
  it('uses the legacy created timestamp in IST, retains unknown categories/tax and segregates old methods',async () => {
    await legacy(); await applyD1Migrations(bindings.DB,bindings.TEST_MIGRATIONS)
    const sales = await getReport(bindings.DB,'sales',options)
    expect(sales.summary).toMatchObject({ purchase_count: 1,subtotal_paise: 10000,discount_paise: 100,tax_paise: 200,total_paise: 10100,amount_paid_paise: 1000,outstanding_paise: 9100 })
    expect(sales.rows[0].purchase_date).toBe('2026-04-09')
    const previous = await getReport(bindings.DB,'sales',{ ...options,range: { dateFrom: '2026-04-08',dateTo: '2026-04-08' } })
    expect(previous.summary.purchase_count).toBe(0)
    const categories = await getReport(bindings.DB,'categories',options)
    expect(categories.rows).toHaveLength(8)
    expect(categories.rows).toContainEqual({ category: 'unknown_legacy',category_label: 'Unknown legacy category',line_count: 1,quantity: 2,sales_paise: 10100 })
    const payments = await getReport(bindings.DB,'payments',options)
    expect(payments.summary).toEqual({ payment_count: 1,total_paise: 1000,cash_paise: 0,upi_paise: 0,card_paise: 0,legacy_other_paise: 1000 })
    expect(payments.rows[0].payment_method).toBe('bank_transfer')
    const plan = (await bindings.DB.prepare(`EXPLAIN QUERY PLAN SELECT p.id FROM purchases AS p WHERE p.deleted_at IS NULL AND p.status NOT IN ('void','refunded') AND p.currency_code='INR' AND ${reportPurchaseDateSql} BETWEEN ? AND ? ORDER BY ${reportPurchaseDateSql} DESC,p.id`).bind('2026-04-09','2026-04-09').all<{ detail: string }>()).results
    expect(plan.some(row => row.detail.includes('idx_purchases_report_date'))).toBe(true)
  })
  it.each(['fractional','overpaid','reversed'])('retains unsupported %s records and fails closed on every financial report',async kind => {
    await legacy(kind); await applyD1Migrations(bindings.DB,bindings.TEST_MIGRATIONS)
    for (const report of ['sales','payments','categories','outstanding','customers'] as const) await expect(getReport(bindings.DB,report,{ ...options,range: report === 'customers' || report === 'outstanding' ? null : options.range })).rejects.toMatchObject({ code: 'FINANCIAL_DATA_INVALID' })
  })
  it('fails closed on an unassignable legacy business date instead of silently dropping a sale',async () => {
    await legacy('undated'); await applyD1Migrations(bindings.DB,bindings.TEST_MIGRATIONS)
    for (const report of ['sales','categories'] as const) await expect(getReport(bindings.DB,report,options)).rejects.toMatchObject({ code: 'FINANCIAL_DATA_INVALID' })
  })
  it('excludes legacy void/refunded/deleted sales while current credit retains the established all-purchase debt semantics',async () => {
    await seedOwner(); await seedCustomer('legacy')
    for (const status of ['void','refunded','draft']) await bindings.DB.prepare(`INSERT INTO purchases(id,customer_id,invoice_number,status,subtotal_paise,total_paise,purchase_date,issued_at,deleted_at,deleted_by_admin_id)
      VALUES (?,'legacy',?,?,100,100,'2026-04-09','2026-04-09T00:00:00.000Z',?,?)`).bind(`old-${status}`,status === 'draft' ? null : `OLD-${status}`,status,status === 'draft' ? '2026-04-09T01:00:00.000Z' : null,status === 'draft' ? 'database-test-owner' : null).run()
    await applyD1Migrations(bindings.DB,bindings.TEST_MIGRATIONS)
    expect((await getReport(bindings.DB,'sales',options)).summary.purchase_count).toBe(0)
    expect((await getReport(bindings.DB,'outstanding',{ ...options,range: null })).summary).toEqual({ customer_count: 1,purchase_count: 3,outstanding_paise: 300 })
  })
})
