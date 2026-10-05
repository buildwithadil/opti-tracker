import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Invoice, InvoiceIdentity } from '../shared/invoices'
import { generateInvoice, getInvoice } from '../worker/services/invoices'
import { getInvoiceIdentity, updateInvoiceIdentity } from '../worker/services/invoice-identity'
import { createPurchase } from '../worker/services/purchases'
import { createPayment } from '../worker/services/payments'
import { archiveCustomer, createCustomer, updateCustomer } from '../worker/services/customers'
import { authenticatedHeaders, bindings, count, failure, installDatabaseHooks, jsonRequest, request, seedPurchase, success } from './helpers'
import { invoiceFixture } from './invoice-fixtures'
import { paymentInput, paymentPurchaseFixture } from './payment-fixtures'

installDatabaseHooks()
let fixture: Awaited<ReturnType<typeof invoiceFixture>>
beforeEach(async () => { fixture = await invoiceFixture() })
const path = () => `/api/customers/${fixture.customer.uuid}/purchases/${fixture.purchase.uuid}/invoice`
const key = () => ({ client_request_id: crypto.randomUUID() })
const issue = (input = key(), db = bindings.DB) => generateInvoice(db, fixture.customer.uuid, fixture.purchase.uuid, input, fixture.actor)

describe('authoritative immutable invoice API and historical representation', () => {
  it.each(['unpaid', 'partially_paid', 'paid'] as const)('issues a correctly numbered %s invoice with actual payment methods, customer and item snapshots', async status => {
    if (status !== 'unpaid') {
      await createPayment(bindings.DB, fixture.customer.uuid, fixture.purchase.uuid, paymentInput('1000.00', 'cash'), fixture.actor)
      await createPayment(bindings.DB, fixture.customer.uuid, fixture.purchase.uuid, paymentInput(status === 'paid' ? '4000.00' : '500.00', 'upi'), fixture.actor)
    }
    expect(await success(await request(path(), { headers: authenticatedHeaders(fixture.owner) }))).toBeNull()
    const invoice = await success<Invoice>(await jsonRequest(path(), key(), { headers: authenticatedHeaders(fixture.owner) }), 201)
    expect(invoice.invoice_number).toBe('INV-0001')
    expect(invoice.snapshot.customer).toEqual({ name: fixture.customer.name, phone: fixture.customer.phone })
    expect(invoice.snapshot.shop).toMatchObject({ shop_name: 'Original Optical Shop', address: '42 Market Road\nPune 411001', gstin: '27ABCDE1234F1Z5' })
    expect(invoice.snapshot.items[0]).toMatchObject({ description: 'Original financial snapshot', quantity: 1, unit_price_paise: 500000, line_total_paise: 500000 })
    expect(invoice.snapshot.payment_summary).toEqual({ total_paise: 500000, amount_paid_paise: status === 'paid' ? 500000 : status === 'partially_paid' ? 150000 : 0, outstanding_paise: status === 'paid' ? 0 : status === 'partially_paid' ? 350000 : 500000, payment_status: status })
    expect(invoice.snapshot.payment_count).toBe(status === 'unpaid' ? 0 : 2)
    expect(invoice.snapshot.payment_methods).toEqual(status === 'unpaid' ? [] : [{ payment_method: 'cash', amount_paise: 100000 }, { payment_method: 'upi', amount_paise: status === 'paid' ? 400000 : 50000 }])
    expect(await success(await request(path(), { headers: authenticatedHeaders(fixture.owner) }))).toEqual(invoice)
    const requestId = fixture.actor.requestId
    const audits = (await bindings.DB.prepare("SELECT * FROM audit_logs WHERE entity_type IN ('invoice','invoice_number') ORDER BY action").all<{ actor_admin_user_id: string; request_id: string; after_json: string }>()).results
    expect(audits).toHaveLength(2)
    expect(audits.every(row => row.actor_admin_user_id === fixture.actor.adminId)).toBe(true)
    expect(audits.every(row => row.request_id !== requestId)).toBe(true) // Real HTTP request identity, not the fixture's service request.
    const auditText = JSON.stringify(audits)
    for (const privateValue of ['Original Optical Shop', 'Market Road', fixture.customer.phone, 'Private payment note', 'Test ref']) expect(auditText).not.toContain(privateValue)
    expect(await count('invoices')).toBe(1)
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  })
  it('copies multiple discounted items and stored totals/taxes, retaining zero-total paid semantics', async () => {
    const purchase = await createPurchase(bindings.DB, fixture.customer.uuid, { client_request_id: crypto.randomUUID(), purchase_date: '2026-04-08', order_discount: '1.00', items: [
      { description: 'Frame', product_category: 'spectacle_frames', quantity: 2, unit_price: '125.50', discount: '0.50' },
      { description: 'Lenses', product_category: 'prescription_lenses', quantity: 3, unit_price: '0.10', discount: '0.01' },
    ] }, fixture.actor)
    const { invoice } = await generateInvoice(bindings.DB, fixture.customer.uuid, purchase.uuid, key(), fixture.actor)
    expect(invoice.snapshot.purchase).toMatchObject({ subtotal_paise: 25130, discount_paise: 151, total_paise: 24979, tax_paise: 0 })
    expect(invoice.snapshot.items.map(item => item.line_total_paise)).toEqual([25050, 29])
    const zero = await paymentPurchaseFixture(fixture.customer.uuid, '0.00', fixture.actor)
    expect((await generateInvoice(bindings.DB, fixture.customer.uuid, zero.uuid, key(), fixture.actor)).invoice.snapshot.payment_summary.payment_status).toBe('paid')
  })
  it('never changes the invoice after customer/shop/new payment changes, or the source purchase/payment records during generation', async () => {
    await createPayment(bindings.DB, fixture.customer.uuid, fixture.purchase.uuid, paymentInput(), fixture.actor)
    const originalPurchase = await bindings.DB.prepare('SELECT * FROM purchases WHERE id=?').bind(fixture.purchase.uuid).first()
    const originalItems = (await bindings.DB.prepare('SELECT * FROM purchase_items').all()).results
    const originalPayments = (await bindings.DB.prepare('SELECT * FROM payments').all()).results
    const issued = (await issue()).invoice
    expect(await bindings.DB.prepare('SELECT * FROM purchases WHERE id=?').bind(fixture.purchase.uuid).first()).toEqual(originalPurchase)
    expect((await bindings.DB.prepare('SELECT * FROM purchase_items').all()).results).toEqual(originalItems)
    expect((await bindings.DB.prepare('SELECT * FROM payments').all()).results).toEqual(originalPayments)
    await updateCustomer(bindings.DB, fixture.customer.uuid, { name: 'Changed customer', phone: '+919123456780' }, fixture.actor)
    await updateInvoiceIdentity(bindings.DB, { ...(await getInvoiceIdentity(bindings.DB)), shop_name: 'Changed business' }, fixture.actor)
    await createPayment(bindings.DB, fixture.customer.uuid, fixture.purchase.uuid, paymentInput('4900.00', 'card'), fixture.actor)
    expect(await getInvoice(bindings.DB, fixture.customer.uuid, fixture.purchase.uuid)).toEqual(issued)
    expect((await issue()).invoice).toEqual(issued)
    await archiveCustomer(bindings.DB, fixture.customer.uuid, fixture.actor)
    expect(await getInvoice(bindings.DB, fixture.customer.uuid, fixture.purchase.uuid)).toEqual(issued)
  })
  it('retrieves and reuses a historical invoice independently of later financial read-model changes', async () => {
    const issued = (await issue()).invoice
    const view = (await bindings.DB.prepare("SELECT sql FROM sqlite_master WHERE type='view' AND name='purchase_payment_balances'").first<{ sql: string }>())!.sql
    await bindings.DB.prepare('DROP VIEW purchase_payment_balances').run()
    try {
      expect(await getInvoice(bindings.DB, fixture.customer.uuid, fixture.purchase.uuid)).toEqual(issued)
      expect((await issue()).invoice).toEqual(issued)
    } finally { await bindings.DB.prepare(view).run() }
  })
  it('returns the same permanent invoice for identical, independent and lost-response retries without reserving more numbers', async () => {
    const input = key(), first = await issue(input)
    for (const submission of [input, input, key()]) expect(await issue(submission)).toEqual({ invoice: first.invoice, created: false })
    expect(await count('invoices')).toBe(1)
    expect(await count('invoice_number_reservations')).toBe(1)
    expect(await bindings.DB.prepare('SELECT next_invoice_number FROM shop_settings').first()).toEqual({ next_invoice_number: 2 })
  })
  it('rejects missing customer/purchase and cross-customer reads/generation without consuming a number', async () => {
    await issue()
    const other = await createCustomer(bindings.DB, { name: 'Other', phone: '+919123456780' }, fixture.actor)
    for (const [customer, purchase, code] of [[crypto.randomUUID(), fixture.purchase.uuid, 'CUSTOMER_NOT_FOUND'], [fixture.customer.uuid, crypto.randomUUID(), 'PURCHASE_NOT_FOUND'], [other.uuid, fixture.purchase.uuid, 'PURCHASE_NOT_FOUND']]) {
      const endpoint = `/api/customers/${customer}/purchases/${purchase}/invoice`
      await failure(await request(endpoint, { headers: authenticatedHeaders(fixture.owner) }), 404, code)
      await failure(await jsonRequest(endpoint, key(), { headers: authenticatedHeaders(fixture.owner) }), 404, code)
    }
    expect(await count('invoice_number_reservations')).toBe(1)
  })
  it('requires active generation and actual shop configuration, preserves legacy numbered purchases', async () => {
    await bindings.DB.prepare("UPDATE shop_settings SET shop_name='' ").run()
    await expect(issue()).rejects.toMatchObject({ code: 'INVOICE_CONFIGURATION_REQUIRED' })
    expect(await count('invoice_number_reservations')).toBe(0)
    await bindings.DB.prepare("UPDATE shop_settings SET shop_name='Configured' ").run()
    await seedPurchase('legacy', fixture.customer.uuid, 'INV-0001')
    await expect(issue()).rejects.toMatchObject({ code: 'INVOICE_SEQUENCE_REVIEW' })
    await bindings.DB.prepare('UPDATE shop_settings SET next_invoice_number=2').run()
    await expect(generateInvoice(bindings.DB, fixture.customer.uuid, 'legacy', key(), fixture.actor)).rejects.toMatchObject({ code: 'PURCHASE_NOT_INVOICEABLE' })
    await archiveCustomer(bindings.DB, fixture.customer.uuid, fixture.actor)
    await expect(issue()).rejects.toMatchObject({ code: 'CUSTOMER_ARCHIVED' })
  })
  it('handles one hundred original item snapshots with constant statement count', async () => {
    const purchase = await createPurchase(bindings.DB, fixture.customer.uuid, { client_request_id: crypto.randomUUID(), purchase_date: '2026-04-08', items: Array.from({ length: 100 }, (_, index) => ({ description: `Original line ${index + 1}`, product_category: 'other' as const, quantity: 1, unit_price: '0.01' })) }, fixture.actor)
    const batchSizes: number[] = []
    const db = new Proxy(bindings.DB, { get(target, prop) { if (prop === 'batch') return (statements: D1PreparedStatement[]) => { batchSizes.push(statements.length); return target.batch(statements) }; const value = Reflect.get(target, prop); return typeof value === 'function' ? value.bind(target) : value } })
    const result = await generateInvoice(db, fixture.customer.uuid, purchase.uuid, key(), fixture.actor)
    expect(result.invoice.snapshot.items).toHaveLength(100)
    expect(result.invoice.snapshot.purchase.total_paise).toBe(100)
    expect(batchSizes).toEqual([3, 3])
  })
  it('protects all endpoints with the established authentication, Origin, CSRF, strict body and media boundary', async () => {
    await failure(await request(path()), 401, 'AUTH_REQUIRED')
    await failure(await jsonRequest(path(), key(), { headers: { Cookie: fixture.owner.cookie } }), 403, 'CSRF_TOKEN_INVALID')
    const badOrigin = await jsonRequest(path(), key(), { headers: { ...authenticatedHeaders(fixture.owner), Origin: 'https://other.test' } })
    expect(badOrigin.status).toBe(403)
    for (const patch of [{ invoice_number: 'CLIENT-1' }, { total_paise: 0 }, { customer_uuid: fixture.customer.uuid }, { items: [] }, { paid: 0 }]) await failure(await jsonRequest(path(), { ...key(), ...patch }, { headers: authenticatedHeaders(fixture.owner) }), 400, 'INVALID_INPUT')
    await failure(await jsonRequest(path(), key(), { headers: { ...authenticatedHeaders(fixture.owner), 'Content-Type': 'text/plain' } }), 415, 'JSON_REQUIRED')
    for (const method of ['PATCH', 'DELETE']) expect((await jsonRequest(path(), {}, { method, headers: authenticatedHeaders(fixture.owner) })).status).toBe(404)
    expect(await count('invoices')).toBe(0)
  })
  it('allows only the minimal existing shop fields, detects stale edits, and rolls configuration back if auditing fails', async () => {
    const identity = await success<InvoiceIdentity>(await request('/api/shop/invoice-identity', { headers: authenticatedHeaders(fixture.owner) }))
    const change = { ...identity, shop_name: 'New business', gstin: null }
    const response = await jsonRequest('/api/shop/invoice-identity', change, { method: 'PATCH', headers: authenticatedHeaders(fixture.owner) })
    const updated = await success<InvoiceIdentity>(response)
    await failure(await jsonRequest('/api/shop/invoice-identity', change, { method: 'PATCH', headers: authenticatedHeaders(fixture.owner) }), 409, 'SHOP_CHANGED')
    for (const patch of [{ next_invoice_number: 0 }, { default_tax_rate_basis_points: 1800 }, { invoice_prefix: 'CLIENT' }, { gstin: 'fake' }, { address: '' }]) await failure(await jsonRequest('/api/shop/invoice-identity', { ...updated, ...patch }, { method: 'PATCH', headers: authenticatedHeaders(fixture.owner) }), 400, 'INVALID_INPUT')
    await bindings.DB.prepare("CREATE TRIGGER test_identity_audit BEFORE INSERT ON audit_logs WHEN NEW.action='update_invoice_identity' BEGIN SELECT RAISE(ABORT,'test rollback'); END").run()
    try { await expect(updateInvoiceIdentity(bindings.DB, { ...updated, shop_name: 'Must roll back' }, fixture.actor)).rejects.toThrow('test rollback') } finally { await bindings.DB.prepare('DROP TRIGGER test_identity_audit').run() }
    expect(await getInvoiceIdentity(bindings.DB)).toEqual(updated)
  })
  it('copies actual legacy tax instead of applying the current shop default to a historical transaction', async () => {
    await bindings.DB.prepare("UPDATE shop_settings SET default_tax_rate_basis_points=1800,default_tax_type='cgst_sgst'").run()
    await seedPurchase('taxed', fixture.customer.uuid, null, { subtotal: 10000, discount: 500, tax: 700 })
    const invoice = (await generateInvoice(bindings.DB, fixture.customer.uuid, 'taxed', key(), fixture.actor)).invoice
    expect(invoice.snapshot.purchase).toMatchObject({ subtotal_paise: 10000, discount_paise: 500, tax_paise: 700, total_paise: 10200, cgst_paise: 0, sgst_paise: 0, igst_paise: 0 })
    expect(invoice.snapshot.items[0]).toMatchObject({ tax_rate_basis_points: 0, tax_paise: 700, line_total_paise: 10200 })
  })
  it('includes only the fixed prescription reference, never clinical measurements, customer address or notes', async () => {
    const prescription = crypto.randomUUID()
    await bindings.DB.prepare("INSERT INTO prescriptions(id,root_id,customer_id,right_sphere,notes) VALUES (?,?,?,'-0.375','Private clinical text')").bind(prescription, prescription, fixture.customer.uuid).run()
    await bindings.DB.prepare("UPDATE customers SET address_line_1='Private optional address' WHERE uuid=?").bind(fixture.customer.uuid).run()
    const purchase = await createPurchase(bindings.DB, fixture.customer.uuid, { client_request_id: crypto.randomUUID(), purchase_date: '2026-04-08', prescription_uuid: prescription, notes: 'Private purchase note', items: [{ description: 'Prescription lens', product_category: 'prescription_lenses', quantity: 1, unit_price: '1.00' }] }, fixture.actor)
    const invoice = (await generateInvoice(bindings.DB, fixture.customer.uuid, purchase.uuid, key(), fixture.actor)).invoice
    expect(invoice.snapshot.purchase.prescription_uuid).toBe(prescription)
    for (const privateText of ['-0.375', 'Private clinical text', 'Private optional address', 'Private purchase note']) expect(JSON.stringify(invoice)).not.toContain(privateText)
  })
  it('does not leak configuration/audit database errors through HTTP', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await bindings.DB.prepare("CREATE TRIGGER test_invoice_failure BEFORE INSERT ON invoices BEGIN SELECT RAISE(ABORT,'private database text'); END").run()
    try { const error = await failure(await jsonRequest(path(), key(), { headers: authenticatedHeaders(fixture.owner) }), 500, 'INTERNAL_ERROR'); expect(JSON.stringify(error)).not.toContain('private database text'); expect(JSON.stringify(log.mock.calls)).not.toContain('private database text') } finally { await bindings.DB.prepare('DROP TRIGGER test_invoice_failure').run(); log.mockRestore() }
    expect(await count('invoices')).toBe(0)
    expect(await count('invoice_number_reservations')).toBe(1)
  })
})
