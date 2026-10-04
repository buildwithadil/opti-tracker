import { applyD1Migrations } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { bindings, count, installDatabaseHooks, seedCustomer, seedOwner, seedPurchase } from './helpers'

installDatabaseHooks()

async function insertAudit(id = 'audit-1', actor: string | null = null): Promise<void> {
  await bindings.DB.prepare(`INSERT INTO audit_logs(id,actor_admin_user_id,action,entity_type,entity_id,after_json)
    VALUES (?,?,'create','customer','customer-1','{"name":"Original"}')`).bind(id, actor).run()
}

describe('real D1 migration and relational integrity', () => {
  it('applies all five production migrations once, preserving their tables and triggers', async () => {
    expect(bindings.TEST_MIGRATIONS.map((migration) => migration.name)).toEqual([
      '0001_initial.sql', '0002_business_fields.sql', '0003_phase_one_integrity.sql', '0004_customer_management.sql', '0005_prescription_management.sql',
    ])
    const applied = await bindings.DB.prepare('SELECT name FROM d1_migrations ORDER BY name').all<{ name: string }>()
    expect(applied.results.map((row) => row.name)).toEqual(bindings.TEST_MIGRATIONS.map((migration) => migration.name))
    const tables = await bindings.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>()
    expect(tables.results.map((row) => row.name)).toEqual(expect.arrayContaining([
      'admin_users', 'sessions', 'auth_rate_limits', 'shop_settings', 'customers',
      'prescriptions', 'purchases', 'purchase_items', 'payments', 'payment_reversals', 'audit_logs',
    ]))
    const triggers = await bindings.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all<{ name: string }>()
    expect(triggers.results.map((row) => row.name)).toEqual(expect.arrayContaining([
      'admin_owner_only_insert', 'admin_owner_only_update', 'audit_logs_immutable_update',
      'audit_logs_immutable_delete', 'customers_phone_required_insert', 'customers_phone_required_update', 'customers_no_hard_delete',
      'purchases_invoice_number_immutable', 'purchases_no_hard_delete',
      'prescriptions_lineage_insert', 'prescriptions_immutable_update', 'prescriptions_immutable_delete',
      'payments_customer_matches_purchase_insert', 'payments_customer_matches_purchase_update',
    ]))
    // The installed helper must be idempotent against the persisted migration ledger.
    await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS)
    expect(await count('d1_migrations')).toBe(5)
    expect(await bindings.DB.prepare('PRAGMA foreign_keys').first()).toEqual({ foreign_keys: 1 })
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  })

  it('enforces foreign keys for sessions, prescriptions, purchases, items, and audits', async () => {
    const statements = [
      bindings.DB.prepare("INSERT INTO sessions(id,admin_user_id,token_hash,expires_at) VALUES ('orphan-session','missing','hash','2099-01-01T00:00:00.000Z')"),
      bindings.DB.prepare("INSERT INTO prescriptions(id,customer_id,root_id) VALUES ('orphan-prescription','missing','orphan-prescription')"),
      bindings.DB.prepare("INSERT INTO purchases(id,customer_id) VALUES ('orphan-purchase','missing')"),
      bindings.DB.prepare("INSERT INTO purchase_items(id,purchase_id,description,unit_price_paise,line_total_paise) VALUES ('orphan-item','missing','Frame',100,100)"),
      bindings.DB.prepare("INSERT INTO audit_logs(id,actor_admin_user_id,action,entity_type,entity_id) VALUES ('orphan-audit','missing','create','customer','missing')"),
    ]
    for (const statement of statements) await expect(statement.run()).rejects.toThrow(/FOREIGN KEY constraint failed/iu)
    for (const table of ['sessions', 'prescriptions', 'purchases', 'purchase_items', 'audit_logs']) expect(await count(table)).toBe(0)
  })

  it('rolls back every earlier insert and update when a later D1 batch statement fails', async () => {
    await seedCustomer('existing', '9876543210')
    await expect(bindings.DB.batch([
      bindings.DB.prepare("UPDATE customers SET name = 'Uncommitted change' WHERE uuid = 'existing'"),
      bindings.DB.prepare("INSERT INTO customers(uuid,name,phone,normalized_phone) VALUES ('new','New Customer','+91 91234 56780','+919123456780')"),
      bindings.DB.prepare("INSERT INTO prescriptions(id,customer_id,root_id) VALUES ('invalid-prescription','missing','invalid-prescription')"),
      bindings.DB.prepare("INSERT INTO application_metadata(id,metadata_key,metadata_value) VALUES ('later','later','must not commit')"),
    ])).rejects.toThrow(/FOREIGN KEY constraint failed/iu)
    expect(await bindings.DB.prepare("SELECT name FROM customers WHERE uuid = 'existing'").first()).toEqual({ name: 'Customer existing' })
    expect(await count('customers')).toBe(1)
    expect(await count('prescriptions')).toBe(0)
    expect(await count('application_metadata')).toBe(0)
  })

  it('cascades orphan-free session deletion but restricts deleting a customer with financial or prescription history', async () => {
    const owner = await seedOwner()
    await bindings.DB.prepare("INSERT INTO sessions(id,admin_user_id,token_hash,expires_at) VALUES ('session',?,'hash','2099-01-01T00:00:00.000Z')").bind(owner).run()
    await bindings.DB.prepare('DELETE FROM admin_users WHERE id = ?').bind(owner).run()
    expect(await count('sessions')).toBe(0)
    await seedCustomer()
    await bindings.DB.prepare("INSERT INTO prescriptions(id,customer_id,root_id) VALUES ('prescription','customer-1','prescription')").run()
    await expect(bindings.DB.prepare("DELETE FROM customers WHERE uuid = 'customer-1'").run()).rejects.toThrow(/customers cannot be permanently deleted/iu)
    // The new archive-only guard rejects deletion first; retain independent FK
    // enforcement assertions by trying to orphan the same referenced key.
    await expect(bindings.DB.prepare("UPDATE customers SET uuid = 'orphan-rx' WHERE uuid = 'customer-1'").run()).rejects.toThrow(/FOREIGN KEY constraint failed/iu)
    await seedPurchase()
    await expect(bindings.DB.prepare("DELETE FROM customers WHERE uuid = 'customer-1'").run()).rejects.toThrow(/customers cannot be permanently deleted/iu)
    await expect(bindings.DB.prepare("UPDATE customers SET uuid = 'orphan-purchase' WHERE uuid = 'customer-1'").run()).rejects.toThrow(/FOREIGN KEY constraint failed/iu)
    expect(await count('customers')).toBe(1)
  })
})

describe('owner and shop singletons', () => {
  it('allows only one administrator, including when the owner is disabled or archived', async () => {
    const owner = await seedOwner()
    const second = () => bindings.DB.prepare("INSERT INTO admin_users(id,email,display_name,password_hash) VALUES ('second','second@optidesk.test','Second','hash')").run()
    await expect(second()).rejects.toThrow(/UNIQUE constraint failed: admin_users.singleton_slot/iu)
    await bindings.DB.prepare("UPDATE admin_users SET status = 'disabled', deleted_at = ? WHERE id = ?").bind(new Date().toISOString(), owner).run()
    await expect(second()).rejects.toThrow(/UNIQUE constraint failed: admin_users.singleton_slot/iu)
    await expect(bindings.DB.prepare('UPDATE admin_users SET singleton_slot = 2 WHERE id = ?').bind(owner).run()).rejects.toThrow(/CHECK constraint failed/iu)
    expect(await count('admin_users')).toBe(1)
  })

  it('rejects staff on insert and role escalation on update', async () => {
    await expect(bindings.DB.prepare("INSERT INTO admin_users(id,email,display_name,password_hash,role) VALUES ('staff','staff@optidesk.test','Staff','hash','staff')").run()).rejects.toThrow(/only the shop owner account is supported/iu)
    const owner = await seedOwner()
    await expect(bindings.DB.prepare("UPDATE admin_users SET role = 'staff' WHERE id = ?").bind(owner).run()).rejects.toThrow(/only the shop owner account is supported/iu)
    expect(await bindings.DB.prepare('SELECT role FROM admin_users').first()).toEqual({ role: 'owner' })
  })

  it('persists an explicit singleton shop identity with valid invoice and tax defaults', async () => {
    await bindings.DB.prepare("INSERT INTO shop_settings(uuid) VALUES ('shop')").run()
    expect(await bindings.DB.prepare('SELECT shop_name,currency,invoice_prefix,next_invoice_number,invoice_number_padding,invoice_reset_policy,default_tax_type,default_tax_rate_basis_points FROM shop_settings').first())
      .toEqual({ shop_name: '', currency: 'INR', invoice_prefix: 'INV', next_invoice_number: 1, invoice_number_padding: 4, invoice_reset_policy: 'never', default_tax_type: 'none', default_tax_rate_basis_points: 0 })
    await expect(bindings.DB.prepare("INSERT INTO shop_settings(uuid) VALUES ('second')").run()).rejects.toThrow(/UNIQUE constraint failed/iu)
    for (const assignment of ["singleton_slot = 2", "currency = 'USD'", 'next_invoice_number = 0', 'invoice_number_padding = 9', 'default_tax_rate_basis_points = 10001', "invoice_reset_policy = 'daily'"]) {
      await expect(bindings.DB.prepare(`UPDATE shop_settings SET ${assignment}`).run()).rejects.toThrow(/CHECK constraint failed/iu)
    }
    expect(await count('shop_settings')).toBe(1)
  })
})

describe('active customer phone integrity', () => {
  it('rejects duplicate active phones on insert and update', async () => {
    await seedCustomer()
    await expect(seedCustomer('duplicate', '9876543210')).rejects.toThrow(/UNIQUE constraint failed: customers.normalized_phone/iu)
    await seedCustomer('other', '9123456780')
    await expect(bindings.DB.prepare("UPDATE customers SET phone = '+91 98765 43210', normalized_phone = '+919876543210' WHERE uuid = 'other'").run()).rejects.toThrow(/UNIQUE constraint failed: customers.normalized_phone/iu)
    expect(await bindings.DB.prepare("SELECT phone FROM customers WHERE uuid = 'other'").first()).toEqual({ phone: '+91 91234 56780' })
    expect(await count('customers')).toBe(2)
  })

  it.each([null, '', '   '])('rejects missing or blank required phones on insert and update: %j', async (phone) => {
    await expect(bindings.DB.prepare("INSERT INTO customers(uuid,name,phone,normalized_phone) VALUES ('invalid','Customer',?,'+919876543210')").bind(phone).run()).rejects.toThrow(/customer phone is required/iu)
    await seedCustomer()
    await expect(bindings.DB.prepare("UPDATE customers SET phone = ? WHERE uuid = 'customer-1'").bind(phone).run()).rejects.toThrow(/customer phone is required/iu)
    expect(await bindings.DB.prepare("SELECT phone FROM customers WHERE uuid = 'customer-1'").first()).toEqual({ phone: '+91 98765 43210' })
  })

  it('allows archived-phone reuse but prevents restoring an archived duplicate', async () => {
    const owner = await seedOwner()
    await seedCustomer()
    const archivedAt = new Date().toISOString()
    await bindings.DB.prepare("UPDATE customers SET archived_at = ?, deleted_by_admin_id = ? WHERE uuid = 'customer-1'").bind(archivedAt, owner).run()
    await seedCustomer('replacement', '9876543210')
    await expect(bindings.DB.prepare("UPDATE customers SET archived_at = NULL, deleted_by_admin_id = NULL WHERE uuid = 'customer-1'").run()).rejects.toThrow(/UNIQUE constraint failed: customers.normalized_phone/iu)
    expect(await bindings.DB.prepare("SELECT archived_at FROM customers WHERE uuid = 'customer-1'").first()).toEqual({ archived_at: archivedAt })
    expect(await count('customers')).toBe(2)
  })
})

describe('issued invoice integrity', () => {
  it('makes issued invoice numbers immutable, non-null, and undeletable', async () => {
    await seedCustomer()
    await seedPurchase()
    for (const invoiceNumber of ['INV-9999', null]) {
      await expect(bindings.DB.prepare("UPDATE purchases SET invoice_number = ? WHERE id = 'purchase-1'").bind(invoiceNumber).run()).rejects.toThrow(/issued invoice numbers are immutable/iu)
    }
    await expect(bindings.DB.prepare("DELETE FROM purchases WHERE id = 'purchase-1'").run()).rejects.toThrow(/issued invoices cannot be permanently deleted/iu)
    await bindings.DB.prepare("UPDATE purchases SET invoice_number = 'INV-0001', notes = 'Allowed non-number change' WHERE id = 'purchase-1'").run()
    expect(await bindings.DB.prepare("SELECT invoice_number,notes FROM purchases WHERE id = 'purchase-1'").first()).toEqual({ invoice_number: 'INV-0001', notes: 'Allowed non-number change' })
  })

  it('retains invoice number uniqueness globally even after archival', async () => {
    const owner = await seedOwner()
    await seedCustomer()
    await seedPurchase()
    await bindings.DB.prepare("UPDATE purchases SET deleted_at = ?, deleted_by_admin_id = ? WHERE id = 'purchase-1'").bind(new Date().toISOString(), owner).run()
    await expect(seedPurchase('reuse', 'customer-1', 'INV-0001')).rejects.toThrow(/UNIQUE constraint failed: purchases.invoice_number/iu)
    await expect(bindings.DB.prepare("DELETE FROM purchases WHERE id = 'purchase-1'").run()).rejects.toThrow(/issued invoices cannot be permanently deleted/iu)
    expect(await count('purchases')).toBe(1)
  })

  it('allows unnumbered drafts, then locks the number at its first assignment', async () => {
    await seedCustomer()
    await seedPurchase('draft-1', 'customer-1', null)
    await seedPurchase('draft-2', 'customer-1', null)
    await bindings.DB.prepare("DELETE FROM purchases WHERE id = 'draft-2'").run()
    await bindings.DB.prepare("UPDATE purchases SET invoice_number = 'INV-0042' WHERE id = 'draft-1'").run()
    await expect(bindings.DB.prepare("UPDATE purchases SET invoice_number = 'INV-0043' WHERE id = 'draft-1'").run()).rejects.toThrow(/issued invoice numbers are immutable/iu)
    await expect(bindings.DB.prepare("DELETE FROM purchases WHERE id = 'draft-1'").run()).rejects.toThrow(/issued invoices cannot be permanently deleted/iu)
    expect(await count('purchases')).toBe(1)
  })

  it('enforces the added purchase-prescription foreign key and restricts referenced prescription deletion', async () => {
    await seedCustomer()
    await seedPurchase()
    await expect(bindings.DB.prepare("UPDATE purchases SET prescription_id = 'missing'").run()).rejects.toThrow(/FOREIGN KEY constraint failed/iu)
    await bindings.DB.prepare("INSERT INTO prescriptions(id,customer_id,root_id) VALUES ('rx','customer-1','rx')").run()
    await bindings.DB.prepare("UPDATE purchases SET prescription_id = 'rx'").run()
    await expect(bindings.DB.prepare("DELETE FROM prescriptions WHERE id = 'rx'").run()).rejects.toThrow(/prescriptions are immutable/iu)
    // The append-only guard fires first in Phase 3; retain the original, actual
    // downstream FK assertion with that guard temporarily removed in test D1.
    const trigger = await bindings.DB.prepare("SELECT sql FROM sqlite_master WHERE name = 'prescriptions_immutable_delete'").first<{ sql: string }>()
    await bindings.DB.prepare('DROP TRIGGER prescriptions_immutable_delete').run()
    try {
      await expect(bindings.DB.prepare("DELETE FROM prescriptions WHERE id = 'rx'").run()).rejects.toThrow(/FOREIGN KEY constraint failed/iu)
    } finally {
      await bindings.DB.prepare(trigger!.sql).run()
    }
    expect(await bindings.DB.prepare('SELECT prescription_id FROM purchases').first()).toEqual({ prescription_id: 'rx' })
  })

  it('rejects inconsistent financial totals and preserves a valid integer-paise purchase', async () => {
    await seedCustomer()
    await seedPurchase()
    await expect(bindings.DB.prepare('UPDATE purchases SET subtotal_paise = 10000, discount_paise = 500, tax_paise = 450, total_paise = 9999').run()).rejects.toThrow(/CHECK constraint failed/iu)
    await bindings.DB.prepare('UPDATE purchases SET subtotal_paise = 10000, discount_paise = 500, tax_paise = 450, total_paise = 9950, taxable_amount_paise = 9500').run()
    await expect(bindings.DB.prepare('UPDATE purchases SET taxable_amount_paise = -1').run()).rejects.toThrow(/CHECK constraint failed/iu)
    expect(await bindings.DB.prepare('SELECT subtotal_paise,discount_paise,tax_paise,total_paise,taxable_amount_paise FROM purchases').first()).toEqual({ subtotal_paise: 10000, discount_paise: 500, tax_paise: 450, total_paise: 9950, taxable_amount_paise: 9500 })
  })
})

describe('payment-customer consistency', () => {
  it('requires the payment customer to match the purchase on insert and either-field update', async () => {
    await seedCustomer()
    await seedCustomer('other-customer', '9123456780')
    await seedPurchase()
    await seedPurchase('other-purchase', 'other-customer', 'INV-0002')
    for (const customerId of [null, 'missing', 'other-customer']) {
      await expect(bindings.DB.prepare("INSERT INTO payments(id,purchase_id,customer_id,amount_paise,payment_method) VALUES ('invalid','purchase-1',?,100,'cash')").bind(customerId).run()).rejects.toThrow(/payment customer must match the purchase/iu)
    }
    await expect(bindings.DB.prepare("INSERT INTO payments(id,purchase_id,customer_id,amount_paise,payment_method) VALUES ('orphan','missing','customer-1',100,'cash')").run()).rejects.toThrow(/payment customer must match the purchase/iu)
    await bindings.DB.prepare("INSERT INTO payments(id,purchase_id,customer_id,amount_paise,payment_method) VALUES ('payment','purchase-1','customer-1',100,'cash')").run()
    await expect(bindings.DB.prepare("UPDATE payments SET customer_id = 'other-customer' WHERE id = 'payment'").run()).rejects.toThrow(/payment customer must match the purchase/iu)
    await expect(bindings.DB.prepare("UPDATE payments SET purchase_id = 'other-purchase' WHERE id = 'payment'").run()).rejects.toThrow(/payment customer must match the purchase/iu)
    expect(await bindings.DB.prepare('SELECT purchase_id,customer_id FROM payments').first()).toEqual({ purchase_id: 'purchase-1', customer_id: 'customer-1' })
    await bindings.DB.prepare("UPDATE payments SET purchase_id = 'other-purchase', customer_id = 'other-customer' WHERE id = 'payment'").run()
    expect(await bindings.DB.prepare('SELECT purchase_id,customer_id FROM payments').first()).toEqual({ purchase_id: 'other-purchase', customer_id: 'other-customer' })
  })
})

describe('append-only audit ledger', () => {
  it('allows new events but rejects every update and hard deletion, including no-op updates', async () => {
    const owner = await seedOwner()
    await insertAudit('audit-1', owner)
    const original = await bindings.DB.prepare("SELECT * FROM audit_logs WHERE id = 'audit-1'").first()
    for (const sql of [
      "UPDATE audit_logs SET after_json = '{}' WHERE id = 'audit-1'",
      "UPDATE audit_logs SET action = action WHERE id = 'audit-1'",
      "UPDATE audit_logs SET actor_admin_user_id = NULL WHERE id = 'audit-1'",
      "DELETE FROM audit_logs WHERE id = 'audit-1'",
    ]) await expect(bindings.DB.prepare(sql).run()).rejects.toThrow(/audit_logs are immutable/iu)
    expect(await bindings.DB.prepare("SELECT * FROM audit_logs WHERE id = 'audit-1'").first()).toEqual(original)
    await insertAudit('audit-2', owner)
    expect(await count('audit_logs')).toBe(2)
    // The FK's SET NULL must not indirectly mutate an immutable audit actor.
    await expect(bindings.DB.prepare('DELETE FROM admin_users WHERE id = ?').bind(owner).run()).rejects.toThrow(/audit_logs are immutable/iu)
    expect(await count('admin_users')).toBe(1)
  })

  it('rolls back the business mutation in the same batch as a forbidden audit edit', async () => {
    await seedCustomer()
    await insertAudit()
    await expect(bindings.DB.batch([
      bindings.DB.prepare("UPDATE customers SET name = 'Must roll back' WHERE uuid = 'customer-1'"),
      bindings.DB.prepare("DELETE FROM audit_logs WHERE id = 'audit-1'"),
    ])).rejects.toThrow(/audit_logs are immutable/iu)
    expect(await bindings.DB.prepare('SELECT name FROM customers').first()).toEqual({ name: 'Customer customer-1' })
    expect(await count('audit_logs')).toBe(1)
  })
})
