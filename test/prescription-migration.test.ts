import { applyD1Migrations, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { bindings, count, seedCustomer, seedOwner, seedPurchase } from './helpers'

// Always an isolated workerd D1 binding. Populate the real 0001..0004 schema
// before running 0005; no user's local/remote database is opened or reset.
beforeEach(async () => {
  await reset()
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS.slice(0, 4))
})
async function rows(table: string) {
  return (await bindings.DB.prepare(`SELECT rowid AS preserved_rowid,* FROM ${table} ORDER BY rowid`).all<Record<string, unknown>>()).results
}

describe('0005 migration: byte-for-byte legacy clinical/history preservation on actual D1', () => {
  it('adds lineage without rebuilding, normalizing, dropping or modifying any old field, stable ID, rowid or downstream reference', async () => {
    const owner = await seedOwner()
    await seedCustomer('legacy-customer')
    for (const [index, type, status, deleted] of [[0, 'spectacle', 'active', false], [1, 'contact_lens', 'active', false],
      [2, 'other', 'archived', false], [3, 'spectacle', 'active', true]] as const) {
      await bindings.DB.prepare(`INSERT INTO prescriptions(rowid,id,customer_id,prescription_type,prescribed_on,expires_on,prescriber_name,
        right_sphere,right_cylinder,right_axis,right_addition,left_sphere,left_cylinder,left_axis,left_addition,
        pupillary_distance,right_pd,left_pd,notes,status,created_at,updated_at,deleted_at,
        created_by_admin_id,updated_by_admin_id,deleted_by_admin_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(100 + index, `legacy-rx-${index}`, 'legacy-customer', type, index ? null : 'not a calendar date',
          index ? 'unknown expiry' : null, '  Legacy डॉ.  ', '+01.0', '-0.375', 0, '0', 'old -2.5', null, 180, '',
          'not supplied', '030.1', null, '  Untouched notes\r\nLegacy line  ', status,
          '2020-01-02T03:04:05.006Z', '2021-02-03T04:05:06.007Z', deleted ? '2022-03-04T05:06:07.008Z' : null,
          owner, owner, deleted ? owner : null).run()
    }
    await seedPurchase('legacy-sale', 'legacy-customer', 'INV-LEGACY')
    await bindings.DB.prepare("UPDATE purchases SET prescription_id = 'legacy-rx-0' WHERE id = 'legacy-sale'").run()
    await bindings.DB.prepare(`INSERT INTO purchase_items(id,purchase_id,prescription_id,description,unit_price_paise,line_total_paise)
      VALUES ('legacy-item','legacy-sale','legacy-rx-0','Untouched frame',100,100)`).run()
    await bindings.DB.prepare(`INSERT INTO audit_logs(id,actor_admin_user_id,action,entity_type,entity_id,after_json)
      VALUES ('legacy-audit',?,'create','prescription','legacy-rx-0','{"old":"must survive"}')`).bind(owner).run()
    const original = await rows('prescriptions')
    const protectedTables = ['admin_users', 'customers', 'purchases', 'purchase_items', 'audit_logs']
    const protectedRows = await Promise.all(protectedTables.map(rows))
    const originalTable = (await bindings.DB.prepare("SELECT sql,rootpage FROM sqlite_master WHERE type = 'table' AND name = 'prescriptions'").first<{ sql: string; rootpage: number }>())!
    const originalColumns = (await bindings.DB.prepare('PRAGMA table_info(prescriptions)').all<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>()).results

    await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS)
    const migrated = await rows('prescriptions')
    expect(migrated).toHaveLength(original.length)
    migrated.forEach((row, index) => {
      expect(row).toEqual({ ...original[index], root_id: original[index].id, supersedes_id: null,
        revision_number: 1, revision_reason: null, near_pd: null })
    })
    const columns = (await bindings.DB.prepare('PRAGMA table_info(prescriptions)').all<typeof originalColumns[number]>()).results
    expect(columns.slice(0, originalColumns.length)).toEqual(originalColumns)
    const migratedTable = (await bindings.DB.prepare("SELECT sql,rootpage FROM sqlite_master WHERE type = 'table' AND name = 'prescriptions'").first<{ sql: string; rootpage: number }>())!
    expect(migratedTable.rootpage).toBe(originalTable.rootpage)
    // SQLite ALTER inserts columns before table constraints, not at the end of
    // the CREATE SQL. Existing columns and each original CHECK/FK stay intact.
    for (const constraint of originalTable.sql.match(/(?:CHECK|FOREIGN KEY)[^\n]+/gu) ?? []) {
      expect(migratedTable.sql).toContain(constraint.replace(/,\s*$/u, ''))
    }
    expect(await Promise.all(protectedTables.map(rows))).toEqual(protectedRows)
    expect(await count('d1_migrations')).toBe(5)
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
    const keys = (await bindings.DB.prepare('PRAGMA foreign_key_list(prescriptions)').all<{ table: string; from: string; to: string }>()).results
    for (const from of ['root_id', 'supersedes_id']) expect(keys).toContainEqual(expect.objectContaining({ table: 'prescriptions', from, to: 'id' }))
    expect(keys).toContainEqual(expect.objectContaining({ table: 'customers', from: 'customer_id', to: 'uuid' }))
    for (const table of ['purchases', 'purchase_items']) {
      const downstream = (await bindings.DB.prepare(`PRAGMA foreign_key_list(${table})`).all<{ table: string; from: string; to: string }>()).results
      expect(downstream).toContainEqual(expect.objectContaining({ table: 'prescriptions', from: 'prescription_id', to: 'id' }))
    }
    await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS)
    expect(await rows('prescriptions')).toEqual(migrated)
    expect(await Promise.all(protectedTables.map(rows))).toEqual(protectedRows)
    expect(await count('d1_migrations')).toBe(5)
    await expect(bindings.DB.prepare("UPDATE prescriptions SET notes = 'must not mutate' WHERE id = 'legacy-rx-0'").run()).rejects.toThrow(/prescriptions are immutable/u)
    await expect(bindings.DB.prepare("DELETE FROM prescriptions WHERE id = 'legacy-rx-0'").run()).rejects.toThrow(/prescriptions are immutable/u)
    expect(await rows('prescriptions')).toEqual(migrated)
  })

  it('applies cleanly to an empty Phase 2 database and installs all exact original append-only guards', async () => {
    await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS)
    expect(await count('prescriptions')).toBe(0)
    const triggers = (await bindings.DB.prepare("SELECT name,sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'prescriptions_%' ORDER BY name")
      .all<{ name: string; sql: string }>()).results
    expect(triggers.map(row => row.name)).toEqual(['prescriptions_immutable_delete', 'prescriptions_immutable_update', 'prescriptions_lineage_insert'])
    expect(triggers.every(row => row.sql.includes('RAISE(ABORT'))).toBe(true)
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  })
})
