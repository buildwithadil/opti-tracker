import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Customer } from '../shared/customers'
import type { PurchaseDetail, PurchaseList } from '../shared/purchases'
import { authenticatedHeaders, bindings, count, failure, installDatabaseHooks, jsonRequest, ORIGIN, request, setup, success, type AuthSession } from './helpers'

installDatabaseHooks()
let owner: AuthSession
let customer: Customer
beforeEach(async () => {
  owner = await setup()
  customer = await success<Customer>(await jsonRequest('/api/customers', { name: 'Purchase Customer', phone: '9876543210' }, { headers: authenticatedHeaders(owner) }), 201)
})
function path(id = '') { return `/api/customers/${customer.uuid}/purchases${id ? `/${id}` : ''}` }
function create(body: unknown, headers = authenticatedHeaders(owner)) {
  return jsonRequest(path(), body, { headers })
}
const body = (client_request_id = crypto.randomUUID()) => ({ client_request_id, purchase_date: '2026-04-08', notes: '  fitting note  ', order_discount: '1.00', items: [
  { description: 'Frame snapshot', product_category: 'spectacle_frames', quantity: 2, unit_price: '125.50', discount: '0.50' },
  { description: 'Lens snapshot', product_category: 'prescription_lenses', quantity: 1, unit_price: '10.00', discount: '0' },
] })

describe('customer-scoped append-only purchase API', () => {
  it('recomputes exact paise totals, persists snapshots and writes one audit event', async () => {
    const response = await create(body())
    const purchase = await success<PurchaseDetail>(response, 201)
    expect(purchase).toMatchObject({ customer_uuid: customer.uuid, purchase_date: '2026-04-08', notes: 'fitting note', status: 'draft', subtotal_paise: 26100, discount_paise: 150, taxable_amount_paise: 25950, tax_paise: 0, total_paise: 25950 })
    expect(purchase.items).toHaveLength(2)
    expect(purchase.items[0]).toMatchObject({ description: 'Frame snapshot', unit_price_paise: 12550, discount_paise: 50, taxable_paise: 25050, tax_paise: 0, line_total_paise: 25050, sort_order: 0 })
    expect(purchase.items[0].uuid).toMatch(/^[0-9a-f-]{36}$/u)
    expect((await bindings.DB.prepare("SELECT action,entity_type,entity_id,request_id FROM audit_logs WHERE entity_type = 'purchase'").first())).toMatchObject({ action: 'create', entity_type: 'purchase', entity_id: purchase.uuid, request_id: response.headers.get('X-Request-Id') })
    const detail = await success<PurchaseDetail>(await request(path(purchase.uuid), { headers: { Cookie: owner.cookie } }))
    expect(detail).toEqual(purchase)
    const list = await success<PurchaseList>(await request(`${path()}?page=1&pageSize=1`, { headers: { Cookie: owner.cookie } }))
    expect(list.pagination).toEqual({ page: 1, pageSize: 1, total: 1, totalPages: 1 })
    expect(list.purchases[0]).toEqual(expect.objectContaining({ uuid: purchase.uuid, total_paise: 25950 }))
  })

  it('rejects empty/unknown/forged totals and duplicate submission keys without another row', async () => {
    await failure(await create({ ...body(), items: [] }), 400, 'INVALID_INPUT')
    await failure(await create({ ...body(), total_paise: 1 }), 400, 'INVALID_INPUT')
    const key = crypto.randomUUID()
    await success(await create(body(key)), 201)
    await failure(await create(body(key)), 409, 'PURCHASE_DUPLICATE')
    expect(await count('purchases')).toBe(1)
    expect(await count('purchase_items')).toBe(2)
  })

  it('validates same-customer immutable prescriptions and blocks wrong-customer references', async () => {
    const prescription = await success<{ uuid: string }>(await jsonRequest(`/api/customers/${customer.uuid}/prescriptions`, { prescribed_on: '2026-01-01' }, { headers: authenticatedHeaders(owner) }), 201)
    const linked = await success<PurchaseDetail>(await create({ ...body(), prescription_uuid: prescription.uuid }), 201)
    expect(linked.prescription_uuid).toBe(prescription.uuid)
    await success(await jsonRequest(`/api/customers/${customer.uuid}/prescriptions/${prescription.uuid}`, { prescribed_on: '2026-05-01', revision_reason: 'New supplied version' }, { method: 'PATCH', headers: authenticatedHeaders(owner) }), 201)
    expect((await success<PurchaseDetail>(await request(path(linked.uuid), { headers: { Cookie: owner.cookie } }))).prescription_uuid).toBe(prescription.uuid)
    const other = await success<Customer>(await jsonRequest('/api/customers', { name: 'Prescription Owner', phone: '9123456780' }, { headers: authenticatedHeaders(owner) }), 201)
    await failure(await jsonRequest(`/api/customers/${other.uuid}/purchases`, { ...body(), prescription_uuid: prescription.uuid }, { headers: authenticatedHeaders(owner) }), 404, 'PRESCRIPTION_NOT_FOUND')
    await failure(await create({ ...body(), prescription_uuid: crypto.randomUUID() }), 404, 'PRESCRIPTION_NOT_FOUND')
  })

  it('rejects archived and wrong-customer access without leaking records', async () => {
    const created = await success<PurchaseDetail>(await create(body()), 201)
    const second = await success<Customer>(await jsonRequest('/api/customers', { name: 'Other Customer', phone: '9123456780' }, { headers: authenticatedHeaders(owner) }), 201)
    await success(await request(`/api/customers/${customer.uuid}`, { method: 'DELETE', headers: { ...authenticatedHeaders(owner), Origin: ORIGIN } }))
    await failure(await create(body()), 409, 'CUSTOMER_ARCHIVED')
    expect((await success<PurchaseList>(await request(path(), { headers: { Cookie: owner.cookie } }))).purchases[0].uuid).toBe(created.uuid)
    await failure(await request(`/api/customers/${second.uuid}/purchases/${created.uuid}`, { headers: { Cookie: owner.cookie } }), 404, 'PURCHASE_NOT_FOUND')
  })

  it('allows only one winner for racing duplicate submission keys', async () => {
    const key = crypto.randomUUID()
    const results = await Promise.all([create(body(key)), create(body(key))])
    expect(results.filter(result => result.status === 201)).toHaveLength(1)
    expect(results.filter(result => result.status === 409)).toHaveLength(1)
    expect(await count('purchases')).toBe(1)
    expect(await count('purchase_items')).toBe(2)
  })

  it('keeps API-created header/items immutable and rolls back when audit insert fails', async () => {
    const created = await success<PurchaseDetail>(await create(body()), 201)
    await expect(bindings.DB.prepare("UPDATE purchases SET notes = 'changed' WHERE id = ?").bind(created.uuid).run()).rejects.toThrow(/purchases are immutable/iu)
    await expect(bindings.DB.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').bind(created.uuid).run()).rejects.toThrow(/purchase items are immutable/iu)
    await bindings.DB.prepare(`CREATE TRIGGER test_reject_purchase_audit BEFORE INSERT ON audit_logs
      WHEN NEW.entity_type = 'purchase' BEGIN SELECT RAISE(ABORT, 'test purchase audit failure'); END`).run()
    try {
      await failure(await create(body()), 500, 'INTERNAL_ERROR')
    } finally {
      await bindings.DB.prepare('DROP TRIGGER test_reject_purchase_audit').run()
    }
    expect(await count('purchases')).toBe(1)
    expect(await count('purchase_items')).toBe(2)
    expect(await count('audit_logs')).toBe(3)
  })

  it('rejects invalid/missing customers and invalid paths without writing or disclosing details', async () => {
    for (const id of ['bad', crypto.randomUUID()]) {
      const code = id === 'bad' ? 'INVALID_INPUT' : 'CUSTOMER_NOT_FOUND'
      const status = id === 'bad' ? 400 : 404
      await failure(await jsonRequest(`/api/customers/${id}/purchases`, body(), { headers: authenticatedHeaders(owner) }), status, code)
      await failure(await request(`/api/customers/${id}/purchases`, { headers: { Cookie: owner.cookie } }), status, code)
    }
    await failure(await request(path('bad'), { headers: { Cookie: owner.cookie } }), 400, 'INVALID_INPUT')
    await failure(await request(path(crypto.randomUUID()), { headers: { Cookie: owner.cookie } }), 404, 'PURCHASE_NOT_FOUND')
    expect(await count('purchases')).toBe(0)
  })

  it('enforces authentication, Origin, CSRF, bounded JSON and unsupported mutation routes', async () => {
    const created = await success<PurchaseDetail>(await create(body()), 201)
    for (const route of [path(), path(created.uuid)]) await failure(await request(route), 401, 'AUTH_REQUIRED')
    await failure(await create(body(), {}), 401, 'AUTH_REQUIRED')
    await failure(await create(body(), { Cookie: owner.cookie }), 403, 'CSRF_TOKEN_INVALID')
    await failure(await create(body(), { ...authenticatedHeaders(owner), Origin: 'https://attacker.test' }), 403, 'CSRF_ORIGIN_INVALID')
    await failure(await create(body(), { ...authenticatedHeaders(owner), 'Content-Type': 'text/plain' }), 415, 'JSON_REQUIRED')
    await failure(await create({ ...body(), notes: 'x'.repeat(16384) }), 413, 'BODY_TOO_LARGE')
    for (const method of ['PATCH', 'DELETE']) await failure(await jsonRequest(path(created.uuid), {}, { method, headers: authenticatedHeaders(owner) }), 404, 'NOT_FOUND')
    await success(await jsonRequest('/api/auth/logout', {}, { headers: authenticatedHeaders(owner) }))
    await failure(await request(path(created.uuid), { headers: { Cookie: owner.cookie } }), 401, 'AUTH_REQUIRED')
    expect(await count('purchases')).toBe(1)
  })

  it('returns a stable customer-only history with pagination, inclusive dates and matching item category', async () => {
    const records: PurchaseDetail[] = []
    for (let day = 1; day <= 23; day++) records.push(await success<PurchaseDetail>(await create({ ...body(), purchase_date: `2026-04-${String(day).padStart(2, '0')}` }), 201))
    const first = await success<PurchaseList>(await request(path(), { headers: { Cookie: owner.cookie } }))
    expect(first.pagination).toEqual({ page: 1, pageSize: 20, total: 23, totalPages: 2 })
    expect(first.purchases.map(row => row.uuid)).toEqual(records.slice().reverse().slice(0, 20).map(row => row.uuid))
    const second = await success<PurchaseList>(await request(`${path()}?page=2`, { headers: { Cookie: owner.cookie } }))
    expect(second.purchases.map(row => row.uuid)).toEqual(records.slice().reverse().slice(20).map(row => row.uuid))
    const filtered = await success<PurchaseList>(await request(`${path()}?dateFrom=2026-04-02&dateTo=2026-04-04&category=spectacle_frames`, { headers: { Cookie: owner.cookie } }))
    expect(filtered.pagination.total).toBe(3)
    expect(filtered.purchases.map(row => row.purchase_date)).toEqual(['2026-04-04', '2026-04-03', '2026-04-02'])
    expect((await success<PurchaseList>(await request(`${path()}?category=other`, { headers: { Cookie: owner.cookie } }))).pagination.total).toBe(0)
    for (const query of ['page=1&page=2', 'unknown=yes', 'pageSize=51', 'dateFrom=2026-02-30', 'dateFrom=2026-04-10&dateTo=2026-04-01', 'category=%E0%A4%A']) await failure(await request(`${path()}?${query}`, { headers: { Cookie: owner.cookie } }), 400, 'INVALID_INPUT')
    const other = await success<Customer>(await jsonRequest('/api/customers', { name: 'Empty history', phone: '9123456780' }, { headers: authenticatedHeaders(owner) }), 201)
    expect((await success<PurchaseList>(await request(`/api/customers/${other.uuid}/purchases`, { headers: { Cookie: owner.cookie } }))).pagination.total).toBe(0)
  })

  it('audits item creation snapshots and financial totals with actor/request identity while omitting private notes and clinical/contact data', async () => {
    const response = await create(body())
    const created = await success<PurchaseDetail>(response, 201)
    const audit = await bindings.DB.prepare("SELECT * FROM audit_logs WHERE entity_type = 'purchase'").first<{ actor_admin_user_id: string; request_id: string; after_json: string; before_json: string | null }>()
    expect(audit).toMatchObject({ actor_admin_user_id: owner.data.id, request_id: response.headers.get('X-Request-Id'), before_json: null })
    const snapshot = JSON.parse(audit!.after_json)
    expect(snapshot).toMatchObject({ uuid: created.uuid, customer_uuid: customer.uuid, total_paise: 25950, item_count: 2 })
    expect(snapshot.items).toEqual(created.items.map(item => ({ uuid: item.uuid, description: item.description, product_category: item.product_category, quantity: item.quantity, unit_price_paise: item.unit_price_paise, discount_paise: item.discount_paise, line_total_paise: item.line_total_paise, sort_order: item.sort_order })))
    for (const value of ['fitting note', customer.name, customer.normalized_phone, 'csrf', 'password', 'right_sphere']) expect(audit!.after_json).not.toContain(value)
    expect(created.updated_at).toBe(created.created_at)
    expect(created.items.every(item => item.created_at === created.created_at && item.updated_at === created.created_at)).toBe(true)
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  })

  it('rolls back the header and earlier items on a later item failure and logs only safe error metadata', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await bindings.DB.prepare(`CREATE TRIGGER test_reject_second_item BEFORE INSERT ON purchase_items
      WHEN NEW.sort_order = 1 BEGIN SELECT RAISE(ABORT, 'private database failure'); END`).run()
    try {
      const result = await failure(await create(body()), 500, 'INTERNAL_ERROR')
      expect(JSON.stringify(result)).not.toContain('private database')
      expect(await count('purchases')).toBe(0)
      expect(await count('purchase_items')).toBe(0)
      expect(log).toHaveBeenCalledOnce()
      expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({ event: 'request_failed', requestId: result.meta.requestId, category: 'unexpected_error' })
    } finally { await bindings.DB.prepare('DROP TRIGGER test_reject_second_item').run(); log.mockRestore() }
  })

  it('rejects invalid quantities/prices/discounts at HTTP boundary and persists exact decimal totals including zero', async () => {
    for (const patch of [{ quantity: 0 }, { quantity: 1.1 }, { quantity: '2' }, { unit_price: '0.001' }, { unit_price: -1 }, { discount: '251.01' }]) await failure(await create({ ...body(), items: [{ ...body().items[0], ...patch }] }), 400, 'INVALID_INPUT')
    await failure(await create({ ...body(), order_discount: '1000.00' }), 400, 'INVALID_INPUT')
    const exact = await success<PurchaseDetail>(await create({ ...body(), order_discount: '0.01', items: [{ description: 'Small amount', product_category: 'other', quantity: 3, unit_price: '0.10', discount: '0.01' }] }), 201)
    expect(exact).toMatchObject({ subtotal_paise: 30, discount_paise: 2, total_paise: 28 })
    expect(exact.items[0].line_total_paise).toBe(29)
    const zero = await success<PurchaseDetail>(await create({ ...body(), order_discount: '0', items: [{ description: 'Zero-priced accessory', product_category: 'optical_accessories', quantity: 1, unit_price: '0.00' }] }), 201)
    expect(zero.total_paise).toBe(0)
  })
})
