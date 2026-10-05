import { beforeEach, describe, expect, it } from 'vitest'
import { createPayment, listPayments } from '../worker/services/payments'
import { getPurchase } from '../worker/services/purchases'
import { archiveCustomer, createCustomer } from '../worker/services/customers'
import { customerCreditSummary } from '../worker/services/payment-balances'
import { bindings, count, installDatabaseHooks } from './helpers'
import { paymentFixture, paymentInput, paymentPurchaseFixture } from './payment-fixtures'

installDatabaseHooks()
let fixture: Awaited<ReturnType<typeof paymentFixture>>
beforeEach(async () => { fixture = await paymentFixture('1000.00') })
const save = (input = paymentInput(), db = bindings.DB) => createPayment(db, fixture.customer.uuid, fixture.purchase.uuid, input, fixture.actor)
function gateBatches(expected: number) {
  let arrived = 0, release!: () => void, markReady!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { markReady = resolve })
  // Scheduling only. All preliminary reads, prepared statements, constraints,
  // transaction results and rollback behavior come from actual Workerd/D1.
  const db = new Proxy(bindings.DB, { get(target, key) {
    if (key === 'batch') return async (statements: D1PreparedStatement[]) => { if (++arrived === expected) markReady(); await gate; return target.batch(statements) }
    const value = Reflect.get(target, key)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  return { db, ready, release }
}
function rawPayment({ amount = 100, method = 'cash', key = crypto.randomUUID(), audit = crypto.randomUUID(), paymentUuid = crypto.randomUUID(), customerUuid = fixture.customer.uuid, purchaseUuid = fixture.purchase.uuid, replace = false } = {}) {
  return { audit, paymentUuid, statements: [
    bindings.DB.prepare(`${replace ? 'INSERT OR REPLACE' : 'INSERT'} INTO payments(id,purchase_id,customer_id,amount_paise,payment_method,received_at,created_at,created_by_admin_id,client_request_id,creation_audit_id)
      VALUES (?,?,?,?,?,'2026-04-09T12:30:00.000Z','2026-04-10T00:00:00.000Z',?,?,?)`).bind(paymentUuid, purchaseUuid, customerUuid, amount, method, fixture.actor.adminId, key, audit),
    bindings.DB.prepare(`INSERT INTO audit_logs(id,actor_admin_user_id,action,entity_type,entity_id,created_at)
      VALUES (?,?,'create','payment',?,'2026-04-10T00:00:00.000Z')`).bind(audit, fixture.actor.adminId, paymentUuid),
  ] }
}
describe('real D1 concurrency, idempotency, atomicity and immutable financial integrity', () => {
  it.each([['700.00', '700.00'], ['1000.00', '1000.00']] as const)('serializes racing %s + %s payments after identical genuine balance reads', async (left, right) => {
    const gate = gateBatches(2)
    const pending = Promise.allSettled([save(paymentInput(left), gate.db), save(paymentInput(right, 'upi'), gate.db)])
    try { await gate.ready } finally { gate.release() }
    const results = await pending
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const loser = results.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(loser.reason).toMatchObject({ status: 409, code: 'PAYMENT_EXCEEDS_OUTSTANDING' })
    const purchase = await getPurchase(bindings.DB, fixture.customer.uuid, fixture.purchase.uuid)
    expect(purchase.amount_paid_paise).toBe(left === '700.00' ? 70000 : 100000)
    expect(purchase.outstanding_paise).toBe(left === '700.00' ? 30000 : 0)
    expect(await count('payments')).toBe(1)
    expect((await bindings.DB.prepare("SELECT * FROM audit_logs WHERE entity_type='payment'").all()).results).toHaveLength(1)
  })
  it('allows simultaneous complementary payments when their combined amount fits exactly', async () => {
    const gate = gateBatches(2)
    const pending = Promise.all([save(paymentInput('700.00'), gate.db), save(paymentInput('300.00', 'card'), gate.db)])
    try { await gate.ready } finally { gate.release() }
    await pending
    expect((await getPurchase(bindings.DB, fixture.customer.uuid, fixture.purchase.uuid))).toMatchObject({ amount_paid_paise: 100000, outstanding_paise: 0, payment_status: 'paid' })
    expect(await count('payments')).toBe(2)
  })
  it('has one winner and PAYMENT_DUPLICATE for concurrent identical final submissions, including a lost-response retry', async () => {
    const input = paymentInput('1000.00'), gate = gateBatches(2)
    const pending = Promise.allSettled([save(input, gate.db), save(input, gate.db)])
    try { await gate.ready } finally { gate.release() }
    const results = await pending
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409, code: 'PAYMENT_DUPLICATE' })
    await expect(save(input)).rejects.toMatchObject({ status: 409, code: 'PAYMENT_DUPLICATE' })
    expect(await count('payments')).toBe(1)
  })
  it('scopes submission keys to customers and rejects reuse for another purchase of that same customer', async () => {
    const input = paymentInput('100.00')
    await save(input)
    const another = await paymentPurchaseFixture(fixture.customer.uuid, '1000.00', fixture.actor)
    await expect(createPayment(bindings.DB, fixture.customer.uuid, another.uuid, input, fixture.actor)).rejects.toMatchObject({ code: 'PAYMENT_DUPLICATE' })
    const customer = await createCustomer(bindings.DB, { name: 'Other payer', phone: '+919123456780' }, fixture.actor)
    const purchase = await paymentPurchaseFixture(customer.uuid, '1000.00', fixture.actor)
    await createPayment(bindings.DB, customer.uuid, purchase.uuid, input, fixture.actor)
    expect(await count('payments')).toBe(2)
  })
  it('checks archive eligibility inside the INSERT after a genuine active pre-read', async () => {
    const gate = gateBatches(1)
    const pending = Promise.allSettled([save(paymentInput(), gate.db)])
    try { await gate.ready; await archiveCustomer(bindings.DB, fixture.customer.uuid, fixture.actor) } finally { gate.release() }
    const [result] = await pending
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 409, code: 'CUSTOMER_ARCHIVED' })
    expect(await count('payments')).toBe(0)
    expect((await bindings.DB.prepare("SELECT * FROM audit_logs WHERE entity_type='payment'").all()).results).toEqual([])
  })
  it('rejects every payment-column/no-op update, DELETE, primary-key and submission-key REPLACE, and keeps purchase guards active', async () => {
    const input = paymentInput(), created = await save(input)
    const original = await bindings.DB.prepare('SELECT * FROM payments').first()
    const columns = (await bindings.DB.prepare('PRAGMA table_info(payments)').all<{ name: string }>()).results
    for (const { name } of columns) await expect(bindings.DB.prepare(`UPDATE payments SET "${name}"="${name}"`).run()).rejects.toThrow(/payments are immutable/u)
    await expect(bindings.DB.prepare('DELETE FROM payments').run()).rejects.toThrow(/payments are immutable/u)
    for (const options of [{ paymentUuid: created.payment.uuid }, { key: input.client_request_id }]) await expect(bindings.DB.batch(rawPayment({ ...options, replace: true }).statements)).rejects.toThrow(/immutable|duplicate/u)
    await expect(bindings.DB.prepare('UPDATE purchases SET total_paise=total_paise').run()).rejects.toThrow(/purchases are immutable/u)
    await expect(bindings.DB.prepare('DELETE FROM purchase_items').run()).rejects.toThrow(/purchase items are immutable/u)
    expect(await bindings.DB.prepare('SELECT * FROM payments').first()).toEqual(original)
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  })
  it.each([{ amount: 0 }, { amount: -1 }, { amount: 1.1 }, { amount: Number.MAX_SAFE_INTEGER + 1 }, { amount: 100001 }, { method: 'other' }])('enforces monetary/method limits directly at SQL level: %j', async patch => {
    await expect(bindings.DB.batch(rawPayment(patch).statements)).rejects.toThrow(/invalid payment creation|exceeds outstanding/u)
    expect(await count('payments')).toBe(0)
  })
  it('requires a new, matching owner-associated creation audit, rejects skipped audit at commit, and preserves old rows on rollback', async () => {
    const raw = rawPayment()
    await expect(bindings.DB.batch([raw.statements[0]])).rejects.toThrow(/FOREIGN KEY/u)
    expect(await count('payments')).toBe(0)
    expect(await count('customers')).toBe(1)
    expect(await count('purchases')).toBe(1)
    expect(await count('audit_logs')).toBe(3)
    const wrong = rawPayment()
    await expect(bindings.DB.batch([wrong.statements[0], bindings.DB.prepare("INSERT INTO audit_logs(id,actor_admin_user_id,action,entity_type,entity_id) VALUES (?,?,'create','customer',?)").bind(wrong.audit, fixture.actor.adminId, wrong.paymentUuid)])).rejects.toThrow(/own creation audit/u)
    const oldAudit = (await bindings.DB.prepare('SELECT id FROM audit_logs LIMIT 1').first<{ id: string }>())!.id
    await expect(bindings.DB.batch(rawPayment({ audit: oldAudit }).statements)).rejects.toThrow(/invalid payment creation/u)
    expect(await count('payments')).toBe(0)
  })
  it('rolls payment and audit back on a later statement failure, allowing the same key to be retried', async () => {
    const key = crypto.randomUUID(), raw = rawPayment({ key })
    await expect(bindings.DB.batch([...raw.statements, bindings.DB.prepare("INSERT INTO sessions(id,admin_user_id,token_hash,expires_at) VALUES ('orphan','missing','hash','2099-01-01')")])).rejects.toThrow(/FOREIGN KEY/u)
    expect(await count('payments')).toBe(0)
    await save(paymentInput('1.00', 'cash', key))
    expect(await count('payments')).toBe(1)
  })
  it('keeps payment history/count/summary and customer aggregate consistent during real concurrent appends', async () => {
    await Promise.all([
      (async () => { for (let i = 0; i < 12; i++) await save(paymentInput('1.00')) })(),
      (async () => { for (let i = 0; i < 15; i++) { const history = await listPayments(bindings.DB, fixture.customer.uuid, fixture.purchase.uuid, { page: 1, pageSize: 50 }); expect(history.payments.length).toBe(history.pagination.total); expect(history.purchase_summary.amount_paid_paise).toBe(history.payments.length * 100) } })(),
    ])
    expect((await customerCreditSummary(bindings.DB, fixture.customer.uuid)).outstanding_paise).toBe(98800)
  })
  it('retains maximum safe-integer precision and rejects an unrepresentable customer aggregate without rounding', async () => {
    const huge = await paymentPurchaseFixture(fixture.customer.uuid, '90071992547409.91', fixture.actor)
    await expect(customerCreditSummary(bindings.DB, fixture.customer.uuid)).rejects.toMatchObject({ code: 'CREDIT_TOTAL_OUT_OF_RANGE' })
    const result = await createPayment(bindings.DB, fixture.customer.uuid, huge.uuid, paymentInput('90071992547409.90', 'upi'), fixture.actor)
    expect(result.purchase_summary).toMatchObject({ amount_paid_paise: Number.MAX_SAFE_INTEGER - 1, outstanding_paise: 1, payment_status: 'partially_paid' })
    await createPayment(bindings.DB, fixture.customer.uuid, huge.uuid, paymentInput('0.01', 'card'), fixture.actor)
    expect((await getPurchase(bindings.DB, fixture.customer.uuid, huge.uuid)).payment_status).toBe('paid')
    expect((await customerCreditSummary(bindings.DB, fixture.customer.uuid)).outstanding_paise).toBe(100000)
  })
  it('uses the indexed settled-payment lookup and ordered history; keeps refunds unavailable', async () => {
    const plan = await bindings.DB.prepare("EXPLAIN QUERY PLAN SELECT SUM(amount_paise) FROM payments WHERE purchase_id=? AND status='settled' AND deleted_at IS NULL").bind(fixture.purchase.uuid).all<{ detail: string }>()
    expect(plan.results.some(row => row.detail.includes('idx_payments_settled_purchase'))).toBe(true)
    const payment = await save()
    await expect(bindings.DB.prepare("INSERT INTO payment_reversals(id,payment_id,amount_paise,reason) VALUES (?,?,1,'No enabled refund workflow')").bind(crypto.randomUUID(), payment.payment.uuid).run()).rejects.toThrow(/not supported/u)
  })
})
