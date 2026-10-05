import { applyD1Migrations, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { bindings, count, seedCustomer, seedOwner, seedPurchase } from './helpers'
import { getPurchase } from '../worker/services/purchases'
import { customerCreditSummary } from '../worker/services/payment-balances'

beforeEach(async () => { await reset(); await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS.slice(0, 6)) })
async function rows(table: string) { return (await bindings.DB.prepare(`SELECT rowid AS preserved_rowid,* FROM ${table} ORDER BY rowid`).all<Record<string, unknown>>()).results }
describe('0007 real-D1 populated migration preserves all historical data', () => {
  it('preserves original rows, rowids, fields, owner/customer/Rx/purchase/item/audits and legacy payment/reversal metadata; adds only NULL payment columns', async () => {
    const owner = await seedOwner()
    await seedCustomer('legacy')
    await bindings.DB.prepare("INSERT INTO prescriptions(id,customer_id,root_id,right_sphere,notes) VALUES ('legacy-rx','legacy','legacy-rx','-0.375','Original clinical note')").run()
    await seedPurchase('legacy-sale', 'legacy', 'INV-LEGACY', { subtotal: 10000, prescriptionId: 'legacy-rx' })
    for (const [index, method, status] of [[0, 'bank_transfer', 'settled'], [1, 'other', 'pending'], [2, 'card', 'voided'], [3, 'upi', 'refunded']] as const) {
      await bindings.DB.prepare(`INSERT INTO payments(rowid,id,purchase_id,customer_id,amount_paise,payment_method,status,reference,received_at,settled_at,notes,created_at,updated_at,created_by_admin_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(100 + index, `legacy-payment-${index}`, 'legacy-sale', 'legacy', 1000, method, status, 'Original ref', '2020-01-01T12:30:00.000Z', '2020-01-01T12:30:00.000Z', 'Original private note', '2020-01-02T00:00:00.000Z', '2021-01-02T00:00:00.000Z', owner).run()
    }
    await bindings.DB.prepare("INSERT INTO payment_reversals(id,payment_id,amount_paise,reason,status,voided_at) VALUES ('legacy-reversal','legacy-payment-2',100,'Original correction','voided','2021-01-01T00:00:00.000Z')").run()
    await bindings.DB.prepare("INSERT INTO audit_logs(id,actor_admin_user_id,action,entity_type,entity_id,after_json) VALUES ('legacy-payment-audit',?,'create','payment','legacy-payment-0','{\"original\":true}')").bind(owner).run()
    const tables = ['admin_users','customers','prescriptions','purchases','purchase_items','payments','payment_reversals','audit_logs']
    const baseline = await Promise.all(tables.map(rows))
    const rootPages = (await bindings.DB.prepare("SELECT name,rootpage FROM sqlite_master WHERE type='table' AND name IN ('payments','purchases','purchase_items') ORDER BY name").all()).results
    await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS)
    const expected = baseline.map((records, index) => tables[index] === 'payments' ? records.map(row => ({ ...row, client_request_id: null, creation_audit_id: null })) : records)
    expect(await Promise.all(tables.map(rows))).toEqual(expected)
    expect((await bindings.DB.prepare("SELECT name,rootpage FROM sqlite_master WHERE type='table' AND name IN ('payments','purchases','purchase_items') ORDER BY name").all()).results).toEqual(rootPages)
    expect(await count('d1_migrations')).toBe(7)
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
    expect((await bindings.DB.prepare('PRAGMA foreign_key_list(payments)').all()).results).toContainEqual(expect.objectContaining({ table: 'audit_logs', from: 'creation_audit_id', to: 'id' }))
    expect(await getPurchase(bindings.DB, 'legacy', 'legacy-sale')).toMatchObject({ total_paise: 10000, amount_paid_paise: 1000, outstanding_paise: 9000, payment_status: 'partially_paid' })
    await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS)
    expect(await Promise.all(tables.map(rows))).toEqual(expected)
    for (const table of ['payments','payment_reversals','purchases','purchase_items']) {
      await expect(bindings.DB.prepare(`UPDATE ${table} SET id=id`).run()).rejects.toThrow(/immutable/u)
      await expect(bindings.DB.prepare(`DELETE FROM ${table}`).run()).rejects.toThrow(/immutable/u)
    }
  })
  it.each(['overpaid', 'fractional', 'reversed'])('preserves unsupported legacy %s records and fails closed instead of inventing a balance', async kind => {
    await seedOwner(); await seedCustomer('legacy'); await seedPurchase('sale', 'legacy', null, { subtotal: 10000 })
    await bindings.DB.prepare("INSERT INTO payments(id,purchase_id,customer_id,amount_paise,payment_method) VALUES ('old-payment','sale','legacy',?,'cash')").bind(kind === 'overpaid' ? 10001 : kind === 'fractional' ? 0.5 : 1000).run()
    if (kind === 'reversed') await bindings.DB.prepare("INSERT INTO payment_reversals(id,payment_id,amount_paise,reason) VALUES ('old-reversal','old-payment',100,'Legacy posted correction')").run()
    const baseline = await rows('payments')
    await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS)
    expect(await rows('payments')).toEqual(baseline.map(row => ({ ...row, client_request_id: null, creation_audit_id: null })))
    await expect(getPurchase(bindings.DB, 'legacy', 'sale')).rejects.toMatchObject({ code: 'FINANCIAL_DATA_INVALID' })
    await expect(customerCreditSummary(bindings.DB, 'legacy')).rejects.toMatchObject({ code: 'FINANCIAL_DATA_INVALID' })
  })
})
