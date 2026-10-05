import { describe, expect, it } from 'vitest'
import type { SalesList, ShopCustomerList, ShopPaymentList } from '../shared/shop'
import { salesQuerySchema, receiptsQuerySchema } from '../shared/shop'
import { createPurchase } from '../worker/services/purchases'
import { createPayment } from '../worker/services/payments'
import { updateCustomer } from '../worker/services/customers'
import { listShopCustomers } from '../worker/services/shop'
import { authenticatedHeaders, bindings, failure, installDatabaseHooks, jsonRequest, request, success } from './helpers'
import { reportFixture } from './report-fixtures'

installDatabaseHooks()
describe('owner-only bounded shop views, real Worker and D1', () => {
  it('lists exact current balances across all dates, with paid/due and archived collection eligibility', async () => {
    const f=await reportFixture(), headers=authenticatedHeaders(f.owner)
    const all=await success<SalesList>(await request('/api/sales?pageSize=1',{ headers }))
    expect(all.pagination).toEqual({ page: 1,pageSize: 1,total: 4,totalPages: 4 })
    const next=await success<SalesList>(await request('/api/sales?pageSize=1&page=2',{ headers }))
    expect(next.sales[0].uuid).not.toBe(all.sales[0].uuid)
    const due=await success<SalesList>(await request('/api/sales?status=due',{ headers }))
    expect(due.sales).toHaveLength(1)
    expect(due.sales[0]).toMatchObject({ uuid: f.first.uuid,total_paise: 17000,amount_paid_paise: 11000,outstanding_paise: 6000,payment_status: 'partially_paid' })
    const paid=await success<SalesList>(await request('/api/sales?status=paid',{ headers }))
    expect(paid.sales.map(row=>row.uuid).sort()).toEqual([f.full.uuid,f.zero.uuid].sort())
    const date=await success<SalesList>(await request('/api/sales?dateFrom=2026-04-09&dateTo=2026-04-09',{ headers }))
    expect(date.sales.map(row=>row.uuid)).toEqual([f.full.uuid])
    expect(JSON.stringify(all)).not.toMatch(/Private|invalid_payment|legacy_reversal|client_request_id|creation_audit|password|csrf/iu)
  })
  it('uses literal wildcard/name/normalized phone search and strict customer-scoped sale recovery', async () => {
    const f=await reportFixture(), headers=authenticatedHeaders(f.owner)
    await updateCustomer(bindings.DB,f.a.uuid,{ name: 'Rahul %_\\ literal' },f.actor)
    for (const search of ['%_\\','rahul','0-98765-43210','65432']) {
      const result=await success<SalesList>(await request(`/api/sales?${new URLSearchParams({ search })}`,{ headers }))
      expect(result.sales).toHaveLength(3); expect(result.sales.every(row=>row.customer_uuid===f.a.uuid)).toBe(true)
    }
    const key=crypto.randomUUID()
    const saved=await createPurchase(bindings.DB,f.c.uuid,{ client_request_id: key,purchase_date: '2020-01-01',items: [{ description: 'Recovered',product_category: 'other',quantity: 1,unit_price: '0.01' }] },f.actor)
    for (const [customer,total] of [[f.c.uuid,1],[f.a.uuid,0]] as const) {
      const result=await success<SalesList>(await request(`/api/sales?customer_uuid=${customer}&submission_uuid=${key}`,{ headers }))
      expect(result.pagination.total).toBe(total)
      if (total) expect(result.sales[0].uuid).toBe(saved.uuid)
    }
  })
  it('matches legacy customer search/order/pagination and includes all-date archived credit and latest eligible sale', async () => {
    const f=await reportFixture(), headers=authenticatedHeaders(f.owner)
    const result=await success<ShopCustomerList>(await request('/api/shop/customers?status=all&sort=name&order=asc',{ headers }))
    expect(result.customers).toHaveLength(3)
    expect(result.customers.find(row=>row.uuid===f.a.uuid)).toMatchObject({ outstanding_paise: 6000,balance_review_required: false,last_sale: { uuid: f.full.uuid,purchase_date: '2026-04-09',total_paise: 10001 } })
    expect(result.customers.find(row=>row.uuid===f.b.uuid)).toMatchObject({ outstanding_paise: 3000,last_sale: { uuid: f.debt.uuid } })
    expect(result.customers.find(row=>row.uuid===f.c.uuid)).toMatchObject({ outstanding_paise: 0,last_sale: null })
    for (const sort of ['name','phone','created_at','updated_at']) for (const order of ['asc','desc']) {
      const query=`status=all&sort=${sort}&order=${order}&pageSize=1&page=2`
      const legacy=await success<{ customers: { uuid: string }[]; pagination: unknown }>(await request(`/api/customers?${query}`,{ headers }))
      const shop=await success<ShopCustomerList>(await request(`/api/shop/customers?${query}`,{ headers }))
      expect(shop.customers.map(row=>row.uuid)).toEqual(legacy.customers.map(row=>row.uuid)); expect(shop.pagination).toEqual(legacy.pagination)
    }
    const phone=await success<ShopCustomerList>(await request('/api/shop/customers?search=0091-98765-43210',{ headers }))
    expect(phone.customers.map(row=>row.uuid)).toEqual([f.a.uuid])
  })
  it('returns maximum-safe customer money exactly and marks aggregate overflow unavailable per customer', async () => {
    const f=await reportFixture(), headers=authenticatedHeaders(f.owner)
    const sale=(price: string)=>createPurchase(bindings.DB,f.c.uuid,{ client_request_id: crypto.randomUUID(),purchase_date: '2020-01-01',items: [{ description: 'Exact safe money',product_category: 'other',quantity: 1,unit_price: price }] },f.actor)
    await sale('90071992547409.91')
    const before=await success<ShopCustomerList>(await request(`/api/shop/customers?search=${encodeURIComponent(f.c.name)}`,{ headers }))
    expect(before.customers[0].outstanding_paise).toBe(Number.MAX_SAFE_INTEGER)
    await sale('0.01')
    const after=await success<ShopCustomerList>(await request('/api/shop/customers?status=all',{ headers }))
    expect(after.customers.find(row=>row.uuid===f.c.uuid)).toMatchObject({ outstanding_paise: null,balance_review_required: true })
    expect(after.customers.find(row=>row.uuid===f.a.uuid)?.outstanding_paise).toBe(6000)
  })
  it('lists retained receipts, exact values and scope-bound same-submission recovery', async () => {
    const f=await reportFixture(), headers=authenticatedHeaders(f.owner), key=crypto.randomUUID()
    const saved=await createPayment(bindings.DB,f.a.uuid,f.first.uuid,{ client_request_id: key,amount: '0.01',payment_method: 'upi',received_at: '2026-04-10T12:00:00.000Z',reference: 'Receipt reference',notes: 'Owner-readable note' },f.actor)
    const all=await success<ShopPaymentList>(await request('/api/shop/payments?pageSize=2',{ headers }))
    expect(all.pagination).toMatchObject({ total: 7,totalPages: 4 }); expect(all.payments).toHaveLength(2)
    const found=await success<ShopPaymentList>(await request(`/api/shop/payments?customer_uuid=${f.a.uuid}&sale_uuid=${f.first.uuid}&submission_uuid=${key}`,{ headers }))
    expect(found.payments).toHaveLength(1)
    expect(found.payments[0]).toMatchObject({ uuid: saved.payment.uuid,amount_paise: 1,payment_method: 'upi',reference: 'Receipt reference',notes: 'Owner-readable note' })
    const other=await success<ShopPaymentList>(await request(`/api/shop/payments?customer_uuid=${f.b.uuid}&sale_uuid=${f.first.uuid}&submission_uuid=${key}`,{ headers }))
    expect(other.payments).toEqual([])
    expect(JSON.stringify(found)).not.toMatch(/client_request_id|creation_audit|password|csrf|normalized_phone/iu)
  })
  it('requires sessions, rejects expired sessions and protects unsupported writes through existing CSRF', async () => {
    for (const path of ['/api/sales','/api/shop/customers','/api/shop/payments']) await failure(await request(path),401,'AUTH_REQUIRED')
    const f=await reportFixture(), headers=authenticatedHeaders(f.owner)
    await failure(await request('/api/sales',{ method: 'POST',headers: { Cookie: f.owner.cookie } }),403,'CSRF_ORIGIN_INVALID')
    await failure(await jsonRequest('/api/sales',{}, { headers }),404,'NOT_FOUND')
    await bindings.DB.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z'").run()
    for (const path of ['/api/sales','/api/shop/customers','/api/shop/payments']) await failure(await request(path,{ headers }),401,'AUTH_REQUIRED')
  })
  it.each(['page=0','page=10001','pageSize=51','page=1&page=2','extra=1','search=%ZZ','search=%00','search='+ 'a'.repeat(101),'customer_uuid=no','submission_uuid='+crypto.randomUUID(),'dateFrom=2026-02-30','dateFrom=2026-04-09&dateTo=2026-04-08','status=void'])('rejects invalid/duplicate sales query %s',async query=>{
    const f=await reportFixture()
    await failure(await request(`/api/sales?${query}`,{ headers: authenticatedHeaders(f.owner) }),400,'INVALID_INPUT')
  })
  it('validates receipt/customer queries and preserves every stored business field and physical row', async () => {
    const f=await reportFixture(), headers=authenticatedHeaders(f.owner)
    for (const path of ['/api/shop/payments?status=paid','/api/shop/payments?sale_uuid=bad','/api/shop/payments?search=%FF','/api/shop/payments?page=1&page=2','/api/shop/payments?submission_uuid='+crypto.randomUUID(),'/api/shop/customers?sort=sql','/api/shop/customers?search=x&search=y','/api/shop/customers?pageSize=51']) await failure(await request(path,{ headers }),400,'INVALID_INPUT')
    const tables=['customers','prescriptions','purchases','purchase_items','payments','invoices','invoice_number_reservations','audit_logs','shop_settings','d1_migrations']
    const snapshot=()=>Promise.all(tables.map(table=>bindings.DB.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all().then(result=>result.results)))
    const before=await snapshot()
    for (const path of ['/api/sales','/api/shop/customers?status=all','/api/shop/payments']) {
      const response=await request(path,{ headers }); expect(response.headers.get('Cache-Control')).toBe('no-store'); expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff'); await success(response)
    }
    expect(await snapshot()).toEqual(before)
    let statements=0
    const tracked=new Proxy(bindings.DB,{ get(target,prop) { if (prop==='batch') return (queries: D1PreparedStatement[])=>{ statements+=queries.length; return target.batch(queries) }; const value=Reflect.get(target,prop); return typeof value==='function' ? value.bind(target) : value } })
    await listShopCustomers(tracked,{ search: '',status: 'all',sort: 'name',order: 'asc',page: 1,pageSize: 50 })
    expect(statements).toBe(2)
    expect(salesQuerySchema.safeParse({ page: '1',pageSize: '50' }).success).toBe(true)
    expect(receiptsQuerySchema.safeParse({ customer_uuid: f.a.uuid,sale_uuid: f.first.uuid,submission_uuid: crypto.randomUUID() }).success).toBe(true)
  })
})
