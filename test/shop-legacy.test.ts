import { applyD1Migrations, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { bindings, seedCustomer, seedOwner } from './helpers'
import { salesQuerySchema, receiptsQuerySchema } from '../shared/shop'
import { listSales, listShopCustomers, listShopPayments } from '../worker/services/shop'

beforeEach(async()=>{ await reset(); await applyD1Migrations(bindings.DB,bindings.TEST_MIGRATIONS.slice(0,5)); await seedOwner(); await seedCustomer('legacy') })
const customers={ search: '',status: 'all' as const,sort: 'name' as const,order: 'asc' as const,page: 1,pageSize: 20 }
async function sale(kind='normal') {
  await bindings.DB.prepare("INSERT INTO purchases(id,customer_id,invoice_number,subtotal_paise,total_paise,created_at) VALUES ('legacy-sale','legacy','OLD-001',100,100,?)").bind(kind==='undated' ? 'unknown-old-date' : '2026-04-08T18:30:00.000Z').run()
  await bindings.DB.prepare("INSERT INTO payments(id,purchase_id,customer_id,amount_paise,payment_method,status,received_at,settled_at) VALUES ('legacy-receipt','legacy-sale','legacy',?,'bank_transfer','settled','2026-04-09T00:00:00.000Z','2026-04-09T00:00:00.000Z')").bind(kind==='fractional' ? 0.5 : kind==='overpaid' ? 101 : 25).run()
  if (kind==='reversed') await bindings.DB.prepare("INSERT INTO payment_reversals(id,payment_id,amount_paise,reason) VALUES ('reversal','legacy-receipt',1,'Retained old correction')").run()
  await applyD1Migrations(bindings.DB,bindings.TEST_MIGRATIONS)
}
describe('shop views preserve legacy contracts',()=>{
  it('uses the same IST fallback for sales and customer last-sale dates and searches retained invoice numbers',async()=>{
    await sale()
    const sales=await listSales(bindings.DB,salesQuerySchema.parse({ search: 'OLD-001',dateFrom: '2026-04-09',dateTo: '2026-04-09' }))
    expect(sales.sales[0]).toMatchObject({ purchase_date: '2026-04-09',amount_paid_paise: 25,outstanding_paise: 75 })
    expect((await listShopCustomers(bindings.DB,customers)).customers[0]).toMatchObject({ outstanding_paise: 75,last_sale: { purchase_date: '2026-04-09' } })
    expect((await listShopPayments(bindings.DB,receiptsQuerySchema.parse({}))).payments[0]).toMatchObject({ amount_paise: 25,payment_method: 'bank_transfer',invoice_number: 'OLD-001' })
  })
  it.each(['fractional','overpaid','reversed'])('marks unsupported %s credit for review and fails closed on sales',async kind=>{
    await sale(kind)
    await expect(listSales(bindings.DB,salesQuerySchema.parse({}))).rejects.toMatchObject({ code: 'FINANCIAL_DATA_INVALID' })
    expect((await listShopCustomers(bindings.DB,customers)).customers[0]).toMatchObject({ outstanding_paise: null,balance_review_required: true })
    if (kind==='fractional') await expect(listShopPayments(bindings.DB,receiptsQuerySchema.parse({}))).rejects.toMatchObject({ code: 'FINANCIAL_DATA_INVALID' })
  })
  it('retains void/refunded/deleted debts in customer credit while excluding them from sale activity',async()=>{
    for (const status of ['void','refunded','draft']) await bindings.DB.prepare("INSERT INTO purchases(id,customer_id,invoice_number,status,subtotal_paise,total_paise,purchase_date,issued_at,deleted_at,deleted_by_admin_id) VALUES (?,'legacy',?,?,100,100,'2026-04-09','2026-04-09T00:00:00.000Z',?,?)").bind(`old-${status}`,status==='draft' ? null : `OLD-${status}`,status,status==='draft' ? '2026-04-09T01:00:00.000Z' : null,status==='draft' ? 'database-test-owner' : null).run()
    await applyD1Migrations(bindings.DB,bindings.TEST_MIGRATIONS)
    expect((await listSales(bindings.DB,salesQuerySchema.parse({}))).sales).toEqual([])
    expect((await listShopCustomers(bindings.DB,customers)).customers[0]).toMatchObject({ outstanding_paise: 300,last_sale: null })
  })
  it('does not silently hide an unassignable legacy date behind date filters',async()=>{
    await sale('undated')
    for (const query of [{},{ dateFrom: '2026-04-09',dateTo: '2026-04-09' }]) await expect(listSales(bindings.DB,salesQuerySchema.parse(query))).rejects.toMatchObject({ code: 'FINANCIAL_DATA_INVALID' })
    expect((await listShopCustomers(bindings.DB,customers)).customers[0]).toMatchObject({ outstanding_paise: 75,last_sale: null })
  })
})
