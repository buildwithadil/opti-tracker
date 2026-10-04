import { applyD1Migrations, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { acceptedMobileForms } from './customer-fixtures'
import { bindings, count, seedOwner } from './helpers'

// This file deliberately starts with the actual populated Phase 1 schema.
// Only the isolated cloudflare:test binding is reset, never a persisted DB.
beforeEach(async () => {
  await reset()
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS.slice(0, 3))
})

async function rows(table: string) {
  return (await bindings.DB.prepare(`SELECT rowid AS preserved_rowid,* FROM ${table} ORDER BY rowid`).all<Record<string, unknown>>()).results
}

async function assertUnchangedAfterFailure(original: Record<string, unknown>[]) {
  expect(await rows('customers')).toEqual(original)
  expect(await count('d1_migrations')).toBe(3)
  expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  const columns = (await bindings.DB.prepare('PRAGMA table_info(customers)').all<{ name: string }>()).results.map(row => row.name)
  expect(columns).toContain('id')
  expect(columns).toContain('full_name')
  expect(columns).not.toContain('normalized_phone')
  expect((await bindings.DB.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'customers_phase_two%'").all()).results).toEqual([])
}

describe('populated 0001..0003 to 0004 migration on real D1', () => {
  it('preserves every legacy field, rowid, timestamps, archive metadata and customer/history FK for all 39 accepted phone forms', async () => {
    const owner = await seedOwner()
    const created = '2024-01-02T03:04:05.006Z'
    const updated = '2025-02-03T04:05:06.007Z'
    const archived = '2025-03-04T05:06:07.008Z'
    const nationals = Array.from({ length: 39 }, (_, index) => `98765${String(43000 + index)}`)
    await bindings.DB.batch(nationals.map((national, index) => bindings.DB.prepare(`INSERT INTO customers(
      rowid,id,customer_number,full_name,phone,email,date_of_birth,address_line_1,address_line_2,city,state,postal_code,
      notes,created_at,updated_at,deleted_at,created_by_admin_id,updated_by_admin_id,deleted_by_admin_id,deletion_reason)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      index + 100, `legacy-${index}`, `C-${index}`, `Legacy नाम ${index}`, ` ${acceptedMobileForms(national)[index]} `,
      `customer${index}@example.test`, '1990-01-02', 'Old address', 'Second line', 'Pune', 'Maharashtra', '411001',
      `Untouched notes ${index}`, created, updated, index % 2 ? archived : null, owner, owner, index % 2 ? owner : null, index % 2 ? 'Legacy archive reason' : null,
    )))
    await bindings.DB.prepare(`INSERT INTO customers(id,full_name,phone,deleted_at,deleted_by_admin_id)
      VALUES ('archived-duplicate','Archived same phone',?,?,?)`).bind(nationals[0], archived, owner).run()
    await bindings.DB.prepare("INSERT INTO prescriptions(id,customer_id,prescriber_name) VALUES ('legacy-rx','legacy-0','Legacy doctor')").run()
    await bindings.DB.prepare(`INSERT INTO purchases(id,customer_id,invoice_number,status,issued_at,prescription_id)
      VALUES ('legacy-sale','legacy-0','INV-LEGACY','issued',?,'legacy-rx')`).bind(created).run()
    await bindings.DB.prepare(`INSERT INTO purchase_items(id,purchase_id,prescription_id,description,unit_price_paise,line_total_paise)
      VALUES ('legacy-item','legacy-sale','legacy-rx','Old frame',100,100)`).run()
    await bindings.DB.prepare(`INSERT INTO payments(id,purchase_id,customer_id,amount_paise,payment_method)
      VALUES ('legacy-payment','legacy-sale','legacy-0',100,'cash')`).run()
    await bindings.DB.prepare(`INSERT INTO audit_logs(id,actor_admin_user_id,action,entity_type,entity_id,after_json)
      VALUES ('legacy-audit',?,'create','customer','legacy-0','{"legacy":true}')`).bind(owner).run()
    const original = await rows('customers')
    const protectedTables = ['admin_users', 'prescriptions', 'purchases', 'purchase_items', 'payments', 'audit_logs']
    const protectedRows = await Promise.all(protectedTables.map(rows))

    await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS.slice(0, 4))
    const migrated = await rows('customers')
    expect(migrated).toHaveLength(40)
    migrated.forEach((row, index) => {
      const { id, full_name, deleted_at, ...otherFields } = original[index]
      const national = nationals[index] ?? nationals[0]
      expect(row).toEqual({ ...otherFields, uuid: id, name: full_name, archived_at: deleted_at,
        normalized_phone: `+91${national}`, phone: `+91 ${national.slice(0, 5)} ${national.slice(5)}`, revision: 0 })
    })
    expect(await Promise.all(protectedTables.map(rows))).toEqual(protectedRows)
    for (const table of ['prescriptions', 'purchases']) {
      const keys = (await bindings.DB.prepare(`PRAGMA foreign_key_list(${table})`).all<{ table: string; from: string; to: string }>()).results
      expect(keys).toContainEqual(expect.objectContaining({ table: 'customers', from: 'customer_id', to: 'uuid' }))
      await expect(bindings.DB.prepare(`UPDATE ${table} SET customer_id = 'missing'`).run()).rejects.toThrow(/FOREIGN KEY constraint failed/iu)
    }
    const columns = (await bindings.DB.prepare('PRAGMA table_info(customers)').all<{ name: string; notnull: number }>()).results
    for (const column of ['uuid', 'name', 'phone', 'normalized_phone', 'created_at', 'updated_at']) {
      expect(columns.find(row => row.name === column)?.notnull).toBe(1)
    }
    expect(await count('d1_migrations')).toBe(4)
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
    await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS.slice(0, 4))
    expect(await rows('customers')).toEqual(migrated)
  })

  it.each(['not a mobile', '+19876543210', '5123456789', '987654321', '(98765) 43210', '98765  43210', '+91--9876543210', '9 876543210', '98765\t43210', '９８７６５４３２１０', '98765\u00a043210', '9'.repeat(33)])('fails atomically rather than discarding invalid legacy phone %j', async phone => {
    await bindings.DB.prepare("INSERT INTO customers(id,full_name,phone) VALUES ('valid','Valid','9876543210')").run()
    await bindings.DB.prepare("INSERT INTO customers(id,full_name,phone) VALUES ('invalid','Must preserve',?)").bind(phone).run()
    await bindings.DB.prepare("INSERT INTO prescriptions(id,customer_id) VALUES ('rx','invalid')").run()
    const original = await rows('customers')
    await expect(applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS.slice(0, 4))).rejects.toThrow(/NOT NULL|CHECK constraint failed/iu)
    await assertUnchangedAfterFailure(original)
    expect(await bindings.DB.prepare('SELECT customer_id FROM prescriptions').first()).toEqual({ customer_id: 'invalid' })
  })

  it('also fails an invalid archived legacy phone instead of silently dropping an archived record', async () => {
    const owner = await seedOwner()
    await bindings.DB.prepare(`INSERT INTO customers(id,full_name,phone,deleted_at,deleted_by_admin_id)
      VALUES ('archived-invalid','Archived must survive','+1 9876543210','2025-01-01T00:00:00.000Z',?)`).bind(owner).run()
    const original = await rows('customers')
    await expect(applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS.slice(0, 4))).rejects.toThrow(/NOT NULL|CHECK constraint failed/iu)
    await assertUnchangedAfterFailure(original)
  })

  it('fails canonical active collisions without merging, deleting or partially renaming legacy records', async () => {
    await bindings.DB.prepare("INSERT INTO customers(id,full_name,phone) VALUES ('national','National','9876543210')").run()
    await bindings.DB.prepare("INSERT INTO customers(id,full_name,phone) VALUES ('prefixed','Prefixed','+91 98765 43210')").run()
    await bindings.DB.prepare("INSERT INTO purchases(id,customer_id) VALUES ('sale','prefixed')").run()
    const original = await rows('customers')
    await expect(applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS.slice(0, 4))).rejects.toThrow(/UNIQUE constraint failed: customers.normalized_phone/iu)
    await assertUnchangedAfterFailure(original)
    expect(await bindings.DB.prepare('SELECT customer_id FROM purchases').first()).toEqual({ customer_id: 'prefixed' })
  })
})
