import { beforeEach, describe, expect, it } from 'vitest'
import { createPurchase, listPurchases } from '../worker/services/purchases'
import { archiveCustomer, createCustomer } from '../worker/services/customers'
import { bindings, count, installDatabaseHooks, setup } from './helpers'

installDatabaseHooks()
let customer: string
let actor: { adminId: string; requestId: string }
beforeEach(async () => {
  const owner = await setup()
  actor = { adminId: owner.data.id, requestId: crypto.randomUUID() }
  customer = (await createCustomer(bindings.DB, { name: 'Integrity customer', phone: '+919876543210' }, actor)).uuid
})
const input = () => ({ client_request_id: crypto.randomUUID(), purchase_date: '2026-04-08', items: [{ description: 'Snapshot', product_category: 'other' as const, quantity: 1, unit_price: '1.00' }] })
function sqlPurchase({ count = 1, subtotal = 100, position = 0, lineTotal = 100, auditEntity = 'purchase', includeItem = true, includeAudit = true } = {}) {
  const id = crypto.randomUUID(), audit = crypto.randomUUID()
  const statements = [bindings.DB.prepare(`INSERT INTO purchases(id,customer_id,item_count,creation_audit_id,subtotal_paise,total_paise,taxable_amount_paise)
    VALUES (?,?,?,?,?,?,?)`).bind(id, customer, count, audit, subtotal, subtotal, subtotal)]
  if (includeItem) statements.push(bindings.DB.prepare(`INSERT INTO purchase_items(id,purchase_id,description,unit_price_paise,line_total_paise,taxable_paise,snapshot_position,sort_order)
    VALUES (?,?,'SQL snapshot',100,?,100,?,?)`).bind(crypto.randomUUID(), id, lineTotal, position, position))
  if (includeAudit) statements.push(bindings.DB.prepare("INSERT INTO audit_logs(id,action,entity_type,entity_id) VALUES (?,'create',?,?)").bind(audit, auditEntity, id))
  return statements
}
describe('database-enforced complete immutable purchase snapshots', () => {
  it.each([
    { count: 0 }, { includeItem: false }, { includeItem: false, includeAudit: false }, { count: 2 }, { subtotal: 101 },
    { position: 1 }, { lineTotal: 99 }, { auditEntity: 'customer' }, { includeAudit: false },
  ])('rejects an empty, partial, inconsistent, or unaudited purchase at SQL commit: %j', async options => {
    await expect(bindings.DB.batch(sqlPurchase(options))).rejects.toThrow(/CHECK constraint|FOREIGN KEY|snapshot|complete item/iu)
    expect(await count('purchases')).toBe(0)
    expect(await count('purchase_items')).toBe(0)
    expect(await count('admin_users')).toBe(1)
    expect(await count('customers')).toBe(1)
    expect(await count('audit_logs')).toBe(2)
    expect((await bindings.DB.prepare("SELECT * FROM audit_logs WHERE entity_type = 'purchase'").all()).results).toEqual([])
  })
  it('rejects unanchored headers and pre-existing audit references; accepts a fully audited batch', async () => {
    await expect(bindings.DB.prepare('INSERT INTO purchases(id,customer_id) VALUES (?,?)').bind(crypto.randomUUID(), customer).run()).rejects.toThrow(/invalid purchase creation shape/u)
    const audit = (await bindings.DB.prepare('SELECT id FROM audit_logs LIMIT 1').first<{ id: string }>())!.id
    await expect(bindings.DB.prepare('INSERT INTO purchases(id,customer_id,item_count,creation_audit_id) VALUES (?,?,1,?)').bind(crypto.randomUUID(), customer, audit).run()).rejects.toThrow(/invalid purchase creation shape/u)
    await bindings.DB.batch(sqlPurchase())
    expect(await count('purchases')).toBe(1)
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  })
  it('blocks every column update, no-op changes, deletion, replacement and later item appends without changing the original rows', async () => {
    const purchase = await createPurchase(bindings.DB, customer, input(), actor)
    for (const table of ['purchases', 'purchase_items']) {
      const original = await bindings.DB.prepare(`SELECT * FROM ${table}`).first<Record<string, unknown>>()
      const columns = (await bindings.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()).results
      for (const { name } of columns) await expect(bindings.DB.prepare(`UPDATE ${table} SET "${name}" = "${name}"`).run()).rejects.toThrow(/immutable/u)
      await expect(bindings.DB.prepare(`DELETE FROM ${table}`).run()).rejects.toThrow(/immutable/u)
      expect(await bindings.DB.prepare(`SELECT * FROM ${table}`).first()).toEqual(original)
    }
    await expect(bindings.DB.prepare(`INSERT OR REPLACE INTO purchases(id,customer_id,item_count,creation_audit_id)
      VALUES (?,?,1,?)`).bind(purchase.uuid, customer, crypto.randomUUID()).run()).rejects.toThrow(/immutable|invalid purchase creation shape/u)
    await expect(bindings.DB.prepare(`INSERT INTO purchase_items(id,purchase_id,description,unit_price_paise,line_total_paise,snapshot_position)
      VALUES (?,?,'Later item',1,1,0)`).bind(crypto.randomUUID(), purchase.uuid).run()).rejects.toThrow(/sealed purchase item/u)
    await expect(bindings.DB.prepare(`INSERT OR REPLACE INTO purchase_items(id,purchase_id,description,unit_price_paise,line_total_paise,snapshot_position)
      VALUES (?,?,'Replacement item',1,1,0)`).bind(purchase.items[0].uuid, purchase.uuid).run()).rejects.toThrow(/immutable|sealed purchase item/u)
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  })
  it('uses the customer/date/tie-breaker history index', async () => {
    const plan = await bindings.DB.prepare(`EXPLAIN QUERY PLAN SELECT id FROM purchases
      WHERE customer_id = ? ORDER BY COALESCE(purchase_date,substr(created_at,1,10)) DESC,created_at DESC,id ASC LIMIT 20`).bind(customer).all<{ detail: string }>()
    expect(plan.results.some(row => row.detail.includes('idx_purchases_customer_history'))).toBe(true)
    expect(plan.results.some(row => row.detail.includes('TEMP B-TREE'))).toBe(false)
  })
  it('checks archive status inside the real write batch after its active pre-read', async () => {
    let release!: () => void, ready!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const reachedBatch = new Promise<void>(resolve => { ready = resolve })
    // Scheduling only: every read, SQL statement and result is genuine D1.
    const db = new Proxy(bindings.DB, { get(target, key) {
      if (key === 'batch') return async (statements: D1PreparedStatement[]) => { ready(); await gate; return target.batch(statements) }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    } })
    const pending = Promise.allSettled([createPurchase(db, customer, input(), actor)])
    try { await reachedBatch; await archiveCustomer(bindings.DB, customer, actor) } finally { release() }
    const [outcome] = await pending
    expect(outcome.status).toBe('rejected')
    if (outcome.status === 'rejected') expect(outcome.reason).toMatchObject({ status: 409, code: 'CUSTOMER_ARCHIVED' })
    expect(await count('purchases')).toBe(0)
    expect(await count('purchase_items')).toBe(0)
    expect((await bindings.DB.prepare("SELECT * FROM audit_logs WHERE entity_type = 'purchase'").all()).results).toEqual([])
  })
  it('keeps list/count in one database snapshot while real purchases append', async () => {
    await Promise.all([
      (async () => { for (let i = 0; i < 12; i++) await createPurchase(bindings.DB, customer, input(), actor) })(),
      (async () => { for (let i = 0; i < 15; i++) { const list = await listPurchases(bindings.DB, customer, { page: 1, pageSize: 50 }); expect(list.purchases.length).toBe(list.pagination.total) } })(),
    ])
    expect(await count('purchases')).toBe(12)
    expect(await count('purchase_items')).toBe(12)
  })
  it('creates 100 line snapshots in five genuine D1 batch statements, not one query per item', async () => {
    let statementCount = 0
    const db = new Proxy(bindings.DB, { get(target, key) {
      if (key === 'batch') return (statements: D1PreparedStatement[]) => { statementCount = statements.length; return target.batch(statements) }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    } })
    const purchase = await createPurchase(db, customer, { ...input(), items: Array.from({ length: 100 }, (_, index) => ({ description: `Item ${index}`, product_category: 'other', quantity: 3, unit_price: '0.10', discount: '0.01' })) }, actor)
    expect(statementCount).toBe(5)
    expect(purchase.items).toHaveLength(100)
    expect(purchase.total_paise).toBe(2900)
    expect(purchase.items.map(item => item.sort_order)).toEqual(Array.from({ length: 100 }, (_, index) => index))
    expect(purchase.items.every(item => item.line_total_paise === 29)).toBe(true)
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  })
})
