import { applyD1Migrations, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { bindings, count, seedCustomer, seedOwner, seedPurchase } from './helpers'

beforeEach(async () => { await reset(); await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS.slice(0, 5)) })
async function rows(table: string) { return (await bindings.DB.prepare(`SELECT rowid AS preserved_rowid,* FROM ${table} ORDER BY rowid`).all<Record<string, unknown>>()).results }
describe('append-only 0006 populated real-D1 migration', () => {
  it('preserves all existing fields, UUIDs, rowids, timestamps, owners, customers, clinical versions, financial rows and audits', async () => {
    const owner = await seedOwner()
    await seedCustomer('legacy')
    await bindings.DB.prepare("INSERT INTO prescriptions(id,customer_id,root_id,right_sphere,notes) VALUES ('legacy-rx','legacy','legacy-rx','-0.375','Private original')").run()
    await seedPurchase('legacy-purchase', 'legacy')
    await bindings.DB.prepare("UPDATE purchases SET prescription_id = 'legacy-rx',purchase_date = '2020-01-01',notes = 'Legacy snapshot' WHERE id = 'legacy-purchase'").run()
    await bindings.DB.prepare("INSERT INTO purchase_items(id,purchase_id,prescription_id,description,product_category,unit_price_paise,line_total_paise) VALUES ('legacy-item','legacy-purchase','legacy-rx','Original legacy frame','Old custom category',100,100)").run()
    await bindings.DB.prepare("INSERT INTO purchases(id) VALUES ('legacy-unbound')").run()
    await bindings.DB.prepare("INSERT INTO payments(id,purchase_id,customer_id,amount_paise,payment_method) VALUES ('legacy-payment','legacy-purchase','legacy',100,'cash')").run()
    await bindings.DB.prepare("INSERT INTO audit_logs(id,actor_admin_user_id,action,entity_type,entity_id) VALUES ('legacy-audit',?,'create','purchase','legacy-purchase')").bind(owner).run()
    const tables = ['admin_users', 'customers', 'prescriptions', 'purchases', 'purchase_items', 'payments', 'audit_logs']
    const baseline = await Promise.all(tables.map(rows))
    const rootPages = (await bindings.DB.prepare("SELECT name,rootpage FROM sqlite_master WHERE type='table' AND name IN ('purchases','purchase_items') ORDER BY name").all()).results
    await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS.slice(0, 6))
    const expected = baseline.map((records, index) => tables[index] === 'purchases' ? records.map(row => ({ ...row, client_request_id: null, creation_audit_id: null, item_count: null })) : tables[index] === 'purchase_items' ? records.map(row => ({ ...row, snapshot_position: null })) : records)
    expect(await Promise.all(tables.map(rows))).toEqual(expected)
    expect((await bindings.DB.prepare("SELECT name,rootpage FROM sqlite_master WHERE type='table' AND name IN ('purchases','purchase_items') ORDER BY name").all()).results).toEqual(rootPages)
    expect(await count('d1_migrations')).toBe(6)
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
    for (const [table, column, parent, key] of [['purchases', 'customer_id', 'customers', 'uuid'], ['purchases', 'prescription_id', 'prescriptions', 'id'], ['purchases', 'creation_audit_id', 'audit_logs', 'id'], ['purchase_items', 'purchase_id', 'purchases', 'id']]) {
      expect((await bindings.DB.prepare(`PRAGMA foreign_key_list(${table})`).all()).results).toContainEqual(expect.objectContaining({ table: parent, from: column, to: key }))
    }
    await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS.slice(0, 6))
    expect(await Promise.all(tables.map(rows))).toEqual(expected)
    await expect(bindings.DB.prepare("UPDATE purchases SET notes = 'changed'").run()).rejects.toThrow(/immutable/u)
    await expect(bindings.DB.prepare("DELETE FROM purchase_items").run()).rejects.toThrow(/immutable/u)
    await expect(bindings.DB.prepare("INSERT INTO purchase_items(id,purchase_id,description,unit_price_paise,line_total_paise) VALUES ('append','legacy-purchase','Later',1,1)").run()).rejects.toThrow(/sealed/u)
  })
})
