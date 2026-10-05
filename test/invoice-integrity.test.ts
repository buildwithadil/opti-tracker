import { beforeEach, describe, expect, it } from 'vitest'
import { bindings, count, installDatabaseHooks } from './helpers'
import { invoiceFixture } from './invoice-fixtures'
import { generateInvoice, getInvoice } from '../worker/services/invoices'
import { archiveCustomer } from '../worker/services/customers'
import { createPayment } from '../worker/services/payments'
import { paymentInput, paymentPurchaseFixture } from './payment-fixtures'
import { invoiceNumber } from '../worker/lib/settings'

installDatabaseHooks()
let fixture: Awaited<ReturnType<typeof invoiceFixture>>
beforeEach(async () => { fixture = await invoiceFixture() })
const key = () => ({ client_request_id: crypto.randomUUID() })
const issue = (input = key(), db = bindings.DB, purchase = fixture.purchase.uuid) => generateInvoice(db, fixture.customer.uuid, purchase, input, fixture.actor)
function gateBatches(number: number, match: (statements: D1PreparedStatement[]) => boolean = () => true) {
  let arrived = 0, release!: () => void, markReady!: () => void
  const wait = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { markReady = resolve })
  // Scheduling only: genuine D1 statements, results, commits and constraints.
  const db = new Proxy(bindings.DB, { get(target, prop) {
    if (prop === 'batch') return async (statements: D1PreparedStatement[]) => { if (match(statements) && arrived < number) { if (++arrived === number) markReady(); await wait }; return target.batch(statements) }
    const value = Reflect.get(target, prop); return typeof value === 'function' ? value.bind(target) : value
  } })
  return { db, ready, release }
}
function invoiceTransaction(reservation: { uuid: string; invoice_number: string }, overrides: { customer?: string; snapshot?: string; audit?: string } = {}) {
  const uuid = crypto.randomUUID(), audit = overrides.audit ?? crypto.randomUUID(), now = new Date().toISOString()
  return [
    bindings.DB.prepare(`INSERT INTO invoices(uuid,purchase_uuid,customer_uuid,reservation_uuid,invoice_number,issued_at,snapshot_json,created_by_admin_id,creation_audit_id)
      SELECT ?,purchase_uuid,?, ?,?, ?,${overrides.snapshot ? '?' : 'snapshot_json'},?,? FROM invoice_source_snapshots WHERE purchase_uuid=?`)
      .bind(uuid, overrides.customer ?? fixture.customer.uuid, reservation.uuid, reservation.invoice_number, now, ...(overrides.snapshot ? [overrides.snapshot] : []), fixture.actor.adminId, audit, fixture.purchase.uuid),
    bindings.DB.prepare("INSERT INTO audit_logs(id,actor_admin_user_id,action,entity_type,entity_id,created_at) VALUES (?,?,'create','invoice',?,?)").bind(audit, fixture.actor.adminId, uuid, now),
  ]
}
describe('real D1 numbering, race, immutability and rollback integrity', () => {
  it.each([true, false])('concurrent same-purchase requests (same key: %s) create one invoice; all committed reservations stay permanent', async same => {
    const input = key(), gate = gateBatches(2)
    const pending = Promise.allSettled([issue(input, gate.db), issue(same ? input : key(), gate.db)])
    try { await gate.ready } finally { gate.release() }
    const outcomes = await pending
    const winners = outcomes.filter(result => result.status === 'fulfilled')
    expect(winners.length).toBeGreaterThanOrEqual(1)
    for (const result of outcomes) {
      if (result.status === 'fulfilled') expect(result.value.invoice).toEqual((winners[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof issue>>>).value.invoice)
      else expect(result.reason).toMatchObject({ code: 'INVOICE_GENERATION_INCOMPLETE' })
    }
    expect(await count('invoices')).toBe(1)
    const reservations = await count('invoice_number_reservations')
    expect(reservations).toBeGreaterThanOrEqual(1)
    expect((await bindings.DB.prepare('SELECT next_invoice_number FROM shop_settings').first<{ next_invoice_number: number }>())!.next_invoice_number).toBe(reservations + 1)
    expect((await bindings.DB.prepare("SELECT * FROM audit_logs WHERE entity_type='invoice'").all()).results).toHaveLength(1)
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  })
  it('numbers separate purchases sequentially under concurrent generation using the existing prefix/padding formatter', async () => {
    await bindings.DB.prepare("UPDATE shop_settings SET invoice_prefix='OPT',invoice_number_padding=6,next_invoice_number=41").run()
    const other = await paymentPurchaseFixture(fixture.customer.uuid, '100.00', fixture.actor)
    const gate = gateBatches(2), pending = Promise.all([issue(key(), gate.db), issue(key(), gate.db, other.uuid)])
    try { await gate.ready } finally { gate.release() }
    const results = await pending
    expect(results.map(result => result.invoice.invoice_number).sort()).toEqual([invoiceNumber('OPT', 41, 6), invoiceNumber('OPT', 42, 6)])
    expect(await count('invoices')).toBe(2)
  })
  it('retains an allocated number and its audit after invoice audit failure, never silently reusing it on retry', async () => {
    const input = key()
    await bindings.DB.prepare("CREATE TRIGGER test_invoice_audit BEFORE INSERT ON audit_logs WHEN NEW.entity_type='invoice' BEGIN SELECT RAISE(ABORT,'invoice audit rollback'); END").run()
    try { await expect(issue(input)).rejects.toThrow('invoice audit rollback') } finally { await bindings.DB.prepare('DROP TRIGGER test_invoice_audit').run() }
    expect(await count('invoices')).toBe(0)
    expect(await count('invoice_number_reservations')).toBe(1)
    expect((await bindings.DB.prepare("SELECT * FROM audit_logs WHERE entity_type='invoice'").all()).results).toEqual([])
    await expect(issue(input)).rejects.toMatchObject({ code: 'INVOICE_GENERATION_INCOMPLETE' })
    expect((await issue()).invoice.invoice_number).toBe('INV-0002')
    expect(await count('invoice_number_reservations')).toBe(2)
  })
  it('requires the reservation audit at commit and rolls back counter allocation if reservation commit itself fails', async () => {
    const uuid = crypto.randomUUID()
    await expect(bindings.DB.batch([bindings.DB.prepare(`INSERT INTO invoice_number_reservations(uuid,purchase_uuid,customer_uuid,shop_uuid,client_request_id,sequence_number,invoice_number,created_at,created_by_admin_id,creation_audit_id)
      SELECT ?,?,?,uuid,?,next_invoice_number,invoice_prefix || '-' || printf('%0*d',invoice_number_padding,next_invoice_number),?,?,? FROM shop_settings`)
      .bind(uuid, fixture.purchase.uuid, fixture.customer.uuid, crypto.randomUUID(), new Date().toISOString(), fixture.actor.adminId, crypto.randomUUID())])).rejects.toThrow(/FOREIGN KEY/u)
    expect(await count('invoice_number_reservations')).toBe(0)
    expect(await bindings.DB.prepare('SELECT next_invoice_number FROM shop_settings').first()).toEqual({ next_invoice_number: 1 })
    expect(await count('customers')).toBe(1)
    expect(await count('purchases')).toBe(1)
  })
  it('rejects skipped/wrong/pre-existing invoice audit, forged snapshots/hierarchy, and later transaction failure without losing reserved numbers', async () => {
    await bindings.DB.prepare("CREATE TRIGGER test_issue_failure BEFORE INSERT ON invoices BEGIN SELECT RAISE(ABORT,'stop after reserve'); END").run()
    try { await expect(issue()).rejects.toThrow('stop after reserve') } finally { await bindings.DB.prepare('DROP TRIGGER test_issue_failure').run() }
    const reservation = (await bindings.DB.prepare('SELECT uuid,invoice_number FROM invoice_number_reservations').first<{ uuid: string; invoice_number: string }>())!
    await expect(bindings.DB.batch([invoiceTransaction(reservation)[0]])).rejects.toThrow(/FOREIGN KEY/u)
    await expect(bindings.DB.batch(invoiceTransaction(reservation, { snapshot: '{}' }))).rejects.toThrow(/snapshot/u)
    await expect(bindings.DB.batch(invoiceTransaction(reservation, { customer: crypto.randomUUID() }))).rejects.toThrow(/reservation/u)
    const oldAudit = (await bindings.DB.prepare('SELECT id FROM audit_logs LIMIT 1').first<{ id: string }>())!.id
    await expect(bindings.DB.batch(invoiceTransaction(reservation, { audit: oldAudit }))).rejects.toThrow(/snapshot|audit/u)
    const bad = invoiceTransaction(reservation)
    await expect(bindings.DB.batch([bad[0], bindings.DB.prepare("INSERT INTO audit_logs(id,entity_type,entity_id,action) SELECT creation_audit_id,'customer',uuid,'create' FROM invoices")])).rejects.toThrow(/own creation audit/u)
    await expect(bindings.DB.batch([...invoiceTransaction(reservation), bindings.DB.prepare("INSERT INTO sessions(id,admin_user_id,token_hash,expires_at) VALUES ('bad','missing','hash','2099-01-01')")])).rejects.toThrow(/FOREIGN KEY/u)
    expect(await count('invoices')).toBe(0)
    expect(await count('invoice_number_reservations')).toBe(1)
    expect(await bindings.DB.prepare('SELECT next_invoice_number FROM shop_settings').first()).toEqual({ next_invoice_number: 2 })
  })
  it('blocks every invoice/reservation column update, no-op, DELETE, REPLACE and backward sequence change', async () => {
    const issued = (await issue()).invoice
    for (const table of ['invoices', 'invoice_number_reservations']) {
      const original = await bindings.DB.prepare(`SELECT * FROM ${table}`).first()
      const columns = (await bindings.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()).results
      for (const { name } of columns) await expect(bindings.DB.prepare(`UPDATE ${table} SET "${name}"="${name}"`).run()).rejects.toThrow(/immutable/u)
      await expect(bindings.DB.prepare(`DELETE FROM ${table}`).run()).rejects.toThrow(/immutable/u)
      await expect(bindings.DB.prepare(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`).run()).rejects.toThrow(/already exists/u)
      expect(await bindings.DB.prepare(`SELECT * FROM ${table}`).first()).toEqual(original)
    }
    await expect(bindings.DB.prepare('UPDATE shop_settings SET next_invoice_number=1').run()).rejects.toThrow(/cannot go backwards/u)
    expect(await getInvoice(bindings.DB, fixture.customer.uuid, fixture.purchase.uuid)).toEqual(issued)
  })
  it('copies the current persisted payment state inside the issue transaction, not a stale preliminary read', async () => {
    let batches = 0
    const gate = gateBatches(1, () => ++batches === 2)
    const pending = issue(key(), gate.db)
    let paymentCreatedAt!: string
    try { await gate.ready; paymentCreatedAt = (await createPayment(bindings.DB, fixture.customer.uuid, fixture.purchase.uuid, paymentInput('1250.00', 'card'), fixture.actor)).payment.created_at } finally { gate.release() }
    const invoice = (await pending).invoice
    expect(invoice.issued_at >= paymentCreatedAt).toBe(true)
    expect(invoice.snapshot.payment_summary).toMatchObject({ amount_paid_paise: 125000, outstanding_paise: 375000 })
    expect(invoice.snapshot.payment_methods).toEqual([{ payment_method: 'card', amount_paise: 125000 }])
  })
  it('detects an archive after reservation, keeps the number, and issues nothing', async () => {
    let batches = 0
    const gate = gateBatches(1, () => ++batches === 2)
    const pending = Promise.allSettled([issue(key(), gate.db)])
    try { await gate.ready; await archiveCustomer(bindings.DB, fixture.customer.uuid, fixture.actor) } finally { gate.release() }
    const [outcome] = await pending
    expect(outcome.status).toBe('rejected')
    expect(await count('invoices')).toBe(0)
    expect(await count('invoice_number_reservations')).toBe(1)
  })
  it.each(["invoice_reset_policy='financial_year'", 'next_invoice_number=9007199254740991'])('fails closed for unsupported/reset/exhausted numbering: %s', async assignment => {
    await bindings.DB.prepare(`UPDATE shop_settings SET ${assignment}`).run()
    await expect(issue()).rejects.toMatchObject({ code: 'INVOICE_CONFIGURATION_REQUIRED' })
    expect(await count('invoices')).toBe(0)
  })
})
