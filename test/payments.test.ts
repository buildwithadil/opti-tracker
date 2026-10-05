import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Payment, PaymentCreated, PaymentList, CustomerCreditSummary } from '../shared/payments'
import type { PurchaseDetail, PurchaseList } from '../shared/purchases'
import { createCustomer } from '../worker/services/customers'
import { authenticatedHeaders, bindings, count, failure, installDatabaseHooks, jsonRequest, ORIGIN, request, success } from './helpers'
import { paymentFixture, paymentInput, paymentPurchaseFixture } from './payment-fixtures'

installDatabaseHooks()
let fixture: Awaited<ReturnType<typeof paymentFixture>>
beforeEach(async () => { fixture = await paymentFixture() })
const purchasePath = () => `/api/customers/${fixture.customer.uuid}/purchases/${fixture.purchase.uuid}`
const path = (id = '') => `${purchasePath()}/payments${id ? `/${id}` : ''}`
const headers = () => authenticatedHeaders(fixture.owner)
const read = (url: string) => request(url, { headers: { Cookie: fixture.owner.cookie } })
const create = (input: unknown = paymentInput()) => jsonRequest(path(), input, { headers: headers() })

describe('real authenticated append-only payment API and authoritative credit', () => {
  it('starts unpaid, records Cash/UPI/Card partial payments and finishes paid without changing any purchase column/item/audit', async () => {
    const originalPurchase = await bindings.DB.prepare('SELECT * FROM purchases').first()
    const originalItems = (await bindings.DB.prepare('SELECT * FROM purchase_items').all()).results
    const originalAudit = (await bindings.DB.prepare("SELECT * FROM audit_logs WHERE entity_type='purchase'").all()).results
    expect(fixture.purchase).toMatchObject({ total_paise: 500000, amount_paid_paise: 0, outstanding_paise: 500000, payment_status: 'unpaid' })
    const records: Payment[] = []
    for (const [amount, method, paid, outstanding, status] of [
      ['2000.00', 'cash', 200000, 300000, 'partially_paid'], ['1000.00', 'upi', 300000, 200000, 'partially_paid'], ['2000.00', 'card', 500000, 0, 'paid'],
    ] as const) {
      const response = await create(paymentInput(amount, method))
      const created = await success<PaymentCreated>(response, 201)
      records.push(created.payment)
      expect(created.purchase_summary).toEqual({ total_paise: 500000, amount_paid_paise: paid, outstanding_paise: outstanding, payment_status: status })
      expect(created.payment).toMatchObject({ customer_uuid: fixture.customer.uuid, purchase_uuid: fixture.purchase.uuid, payment_method: method, status: 'settled', reference: 'Test ref', notes: 'Private payment note' })
      expect(created.payment.uuid).toMatch(/^[0-9a-f-]{36}$/u)
      expect(await success<Payment>(await read(path(created.payment.uuid)))).toEqual(created.payment)
      expect(await success<PurchaseDetail>(await read(purchasePath()))).toMatchObject(created.purchase_summary)
    }
    const history = await success<PaymentList>(await read(path()))
    expect(history.payments.map(row => row.uuid)).toEqual(records.map(row => row.uuid))
    expect(history.pagination.total).toBe(3)
    expect(await bindings.DB.prepare('SELECT * FROM purchases').first()).toEqual(originalPurchase)
    expect((await bindings.DB.prepare('SELECT * FROM purchase_items').all()).results).toEqual(originalItems)
    expect((await bindings.DB.prepare("SELECT * FROM audit_logs WHERE entity_type='purchase'").all()).results).toEqual(originalAudit)
  })
  it.each(['cash', 'upi', 'card'] as const)('accepts a full %s payment and optional blank metadata', async method => {
    const result = await success<PaymentCreated>(await create({ ...paymentInput('5000.00', method), notes: '', reference: '' }), 201)
    expect(result.payment).toMatchObject({ amount_paise: 500000, payment_method: method, notes: null, reference: null })
    expect(result.purchase_summary).toMatchObject({ payment_status: 'paid', outstanding_paise: 0 })
    await failure(await create(paymentInput('0.01')), 409, 'PAYMENT_EXCEEDS_OUTSTANDING')
  })
  it('handles one-paise arithmetic and zero-total purchases explicitly as paid', async () => {
    const tiny = await paymentPurchaseFixture(fixture.customer.uuid, '0.30', fixture.actor)
    const base = `/api/customers/${fixture.customer.uuid}/purchases/${tiny.uuid}/payments`
    for (const amount of ['0.10', '0.19', '0.01']) await success(await jsonRequest(base, paymentInput(amount), { headers: headers() }), 201)
    expect((await success<PaymentList>(await read(base))).purchase_summary).toEqual({ total_paise: 30, amount_paid_paise: 30, outstanding_paise: 0, payment_status: 'paid' })
    const zero = await paymentPurchaseFixture(fixture.customer.uuid, '0.00', fixture.actor)
    expect(zero).toMatchObject({ amount_paid_paise: 0, outstanding_paise: 0, payment_status: 'paid' })
    await failure(await jsonRequest(`/api/customers/${fixture.customer.uuid}/purchases/${zero.uuid}/payments`, paymentInput('0.01'), { headers: headers() }), 409, 'PAYMENT_EXCEEDS_OUTSTANDING')
  })
  it('calculates customer credit across all purchases and preserves archived outstanding visibility', async () => {
    const second = await paymentPurchaseFixture(fixture.customer.uuid, '2000.00', fixture.actor)
    const third = await paymentPurchaseFixture(fixture.customer.uuid, '1500.00', fixture.actor)
    await success(await create(paymentInput('3000.00')), 201)
    for (const [id, amount] of [[second.uuid, '2000.00'], [third.uuid, '500.00']]) await success(await jsonRequest(`/api/customers/${fixture.customer.uuid}/purchases/${id}/payments`, paymentInput(amount), { headers: headers() }), 201)
    expect(await success<CustomerCreditSummary>(await read(`/api/customers/${fixture.customer.uuid}/credit-summary`))).toEqual({ customer_uuid: fixture.customer.uuid, outstanding_paise: 300000 })
    const list = await success<PurchaseList>(await read(`/api/customers/${fixture.customer.uuid}/purchases`))
    expect(list.purchases.find(row => row.uuid === second.uuid)).toMatchObject({ payment_status: 'paid', amount_paid_paise: 200000, outstanding_paise: 0 })
    await success(await request(`/api/customers/${fixture.customer.uuid}`, { method: 'DELETE', headers: { ...headers(), Origin: ORIGIN } }))
    expect((await success<CustomerCreditSummary>(await read(`/api/customers/${fixture.customer.uuid}/credit-summary`))).outstanding_paise).toBe(300000)
    await failure(await create(paymentInput('1.00')), 409, 'CUSTOMER_ARCHIVED')
    expect((await success<PaymentList>(await read(path()))).payments).toHaveLength(1)
  })
  it.each([{ amount: '0' }, { amount: '-1' }, { amount: '1.001' }, { amount: '1e3' }, { amount: 1 }, { amount: '90071992547409.92' }, { payment_method: 'bank_transfer' }, { outstanding_paise: 1 }, { payment_status: 'paid' }, { amount_paid_paise: 1 }])('rejects invalid/forged input %j with no financial writes', async patch => {
    await failure(await create({ ...paymentInput(), ...patch }), 400, 'INVALID_INPUT')
    expect(await count('payments')).toBe(0)
    expect((await bindings.DB.prepare("SELECT * FROM audit_logs WHERE entity_type='payment'").all()).results).toEqual([])
  })
  it('rejects overpayment and invalid backdated/future times without partial state', async () => {
    await failure(await create(paymentInput('5000.01')), 409, 'PAYMENT_EXCEEDS_OUTSTANDING')
    for (const received_at of ['2026-04-07T23:59:59.999Z', '2099-01-01T00:00:00.000Z', '2026-02-30T12:00:00.000Z']) await failure(await create({ ...paymentInput(), received_at }), 400, 'INVALID_INPUT')
    expect(await count('payments')).toBe(0)
  })
  it('validates every UUID hierarchy, including a payment from another purchase/customer', async () => {
    for (const id of ['bad', crypto.randomUUID()]) {
      await failure(await jsonRequest(`/api/customers/${id}/purchases/${fixture.purchase.uuid}/payments`, paymentInput(), { headers: headers() }), id === 'bad' ? 400 : 404, id === 'bad' ? 'INVALID_INPUT' : 'CUSTOMER_NOT_FOUND')
      await failure(await read(`/api/customers/${fixture.customer.uuid}/purchases/${id}/payments`), id === 'bad' ? 400 : 404, id === 'bad' ? 'INVALID_INPUT' : 'PURCHASE_NOT_FOUND')
    }
    const other = await createCustomer(bindings.DB, { name: 'Other payment customer', phone: '+919123456780' }, fixture.actor)
    const otherPurchase = await paymentPurchaseFixture(other.uuid, '100.00', fixture.actor)
    await failure(await jsonRequest(`/api/customers/${other.uuid}/purchases/${fixture.purchase.uuid}/payments`, paymentInput(), { headers: headers() }), 404, 'PURCHASE_NOT_FOUND')
    const saved = await success<PaymentCreated>(await create(paymentInput()), 201)
    await failure(await read(`/api/customers/${other.uuid}/purchases/${otherPurchase.uuid}/payments/${saved.payment.uuid}`), 404, 'PAYMENT_NOT_FOUND')
    const sameCustomerPurchase = await paymentPurchaseFixture(fixture.customer.uuid, '100.00', fixture.actor)
    await failure(await read(`/api/customers/${fixture.customer.uuid}/purchases/${sameCustomerPurchase.uuid}/payments/${saved.payment.uuid}`), 404, 'PAYMENT_NOT_FOUND')
    await failure(await read(path('bad')), 400, 'INVALID_INPUT')
    await failure(await read(path(crypto.randomUUID())), 404, 'PAYMENT_NOT_FOUND')
  })
  it('rejects repeated valid UUIDs including changed bodies and retries after complete settlement', async () => {
    const input = paymentInput('5000.00')
    await success<PaymentCreated>(await create(input), 201)
    await failure(await create(input), 409, 'PAYMENT_DUPLICATE')
    await failure(await create({ ...input, amount: '1.00', payment_method: 'card' }), 409, 'PAYMENT_DUPLICATE')
    expect(await count('payments')).toBe(1)
    expect((await bindings.DB.prepare("SELECT * FROM audit_logs WHERE entity_type='payment'").all()).results).toHaveLength(1)
  })
  it('pages chronological history beyond twenty, rejects duplicate/unknown query params and returns a consistent summary', async () => {
    for (let day = 1; day <= 23; day++) await success(await create({ ...paymentInput('1.00'), received_at: `2026-05-${String(day).padStart(2, '0')}T12:00:00.000Z` }), 201)
    const first = await success<PaymentList>(await read(path()))
    expect(first.payments).toHaveLength(20); expect(first.pagination).toEqual({ page: 1, pageSize: 20, total: 23, totalPages: 2 })
    const second = await success<PaymentList>(await read(`${path()}?page=2`))
    expect(second.payments).toHaveLength(3)
    expect([...first.payments, ...second.payments].map(row => row.received_at)).toEqual(Array.from({ length: 23 }, (_, index) => `2026-05-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`))
    expect(first.purchase_summary).toMatchObject({ amount_paid_paise: 2300, outstanding_paise: 497700, payment_status: 'partially_paid' })
    for (const query of ['page=1&page=2', 'pageSize=51', 'unknown=1', 'page=%E0%A4%A', 'status=paid']) await failure(await read(`${path()}?${query}`), 400, 'INVALID_INPUT')
  })
  it('enforces auth/Origin/CSRF/media/byte limits and excludes destructive/refund routes', async () => {
    const saved = await success<PaymentCreated>(await create(), 201)
    for (const route of [path(), path(saved.payment.uuid), `/api/customers/${fixture.customer.uuid}/credit-summary`]) await failure(await request(route), 401, 'AUTH_REQUIRED')
    await failure(await jsonRequest(path(), paymentInput()), 401, 'AUTH_REQUIRED')
    await failure(await jsonRequest(path(), paymentInput(), { headers: { Cookie: fixture.owner.cookie } }), 403, 'CSRF_TOKEN_INVALID')
    await failure(await jsonRequest(path(), paymentInput(), { headers: { ...headers(), Origin: 'https://attacker.test' } }), 403, 'CSRF_ORIGIN_INVALID')
    await failure(await jsonRequest(path(), paymentInput(), { headers: { ...headers(), 'Content-Type': 'text/plain' } }), 415, 'JSON_REQUIRED')
    await failure(await create({ ...paymentInput(), notes: 'x'.repeat(16384) }), 413, 'BODY_TOO_LARGE')
    for (const method of ['PATCH', 'DELETE']) await failure(await jsonRequest(path(saved.payment.uuid), {}, { headers: headers(), method }), 404, 'NOT_FOUND')
    await failure(await jsonRequest(`${path(saved.payment.uuid)}/refund`, {}, { headers: headers() }), 404, 'NOT_FOUND')
    await success(await jsonRequest('/api/auth/logout', {}, { headers: headers() }))
    await failure(await read(path()), 401, 'AUTH_REQUIRED')
  })
  it('audits creation identity, amount/method/time without sensitive metadata and rolls payment back if audit fails', async () => {
    const response = await create()
    const saved = await success<PaymentCreated>(response, 201)
    const audit = await bindings.DB.prepare("SELECT * FROM audit_logs WHERE entity_type='payment'").first<{ actor_admin_user_id: string; request_id: string; after_json: string }>()
    expect(audit).toMatchObject({ actor_admin_user_id: fixture.owner.data.id, request_id: response.headers.get('X-Request-Id') })
    expect(JSON.parse(audit!.after_json)).toEqual({ uuid: saved.payment.uuid, purchase_uuid: fixture.purchase.uuid, customer_uuid: fixture.customer.uuid, amount_paise: 10000, payment_method: 'cash', received_at: saved.payment.received_at, created_at: saved.payment.created_at })
    for (const text of ['Test ref', 'Private payment note', fixture.customer.name, fixture.customer.phone, 'csrf', 'right_sphere']) expect(audit!.after_json).not.toContain(text)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await bindings.DB.prepare("CREATE TRIGGER test_reject_payment_audit BEFORE INSERT ON audit_logs WHEN NEW.entity_type='payment' BEGIN SELECT RAISE(ABORT,'private failing payment audit'); END").run()
    try {
      const failed = await failure(await create(paymentInput('50.00')), 500, 'INTERNAL_ERROR')
      expect(JSON.stringify(failed)).not.toContain('private failing')
      expect(await count('payments')).toBe(1)
      expect(log).toHaveBeenCalledOnce()
      expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({ event: 'request_failed', requestId: failed.meta.requestId, category: 'unexpected_error' })
      expect((await success<PurchaseDetail>(await read(purchasePath()))).amount_paid_paise).toBe(10000)
    } finally { await bindings.DB.prepare('DROP TRIGGER test_reject_payment_audit').run(); log.mockRestore() }
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  })
})
