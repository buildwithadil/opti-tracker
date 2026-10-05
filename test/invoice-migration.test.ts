import { applyD1Migrations, reset } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { bindings, seedCustomer, seedOwner, seedPurchase } from './helpers'

describe('0008 preserves the full original schema and populated financial history', () => {
  it('adds invoice tables/guards without changing any original field, rowid, counter, legacy number or financial snapshot', async () => {
    await reset(); await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS.slice(0, 7))
    await seedOwner(); await seedCustomer(); await seedPurchase()
    await bindings.DB.prepare("INSERT INTO shop_settings(uuid,shop_name,address,contact_number,next_invoice_number) VALUES ('legacy-shop','Original business','Original address','1234567890',37)").run()
    const tables = (await bindings.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' AND name<>'d1_migrations' ORDER BY name").all<{ name: string }>()).results.map(row => row.name)
    const rows = () => Promise.all(tables.map(table => bindings.DB.prepare(`SELECT rowid AS original_rowid,* FROM "${table}" ORDER BY rowid`).all().then(result => result.results)))
    const before = await rows()
    const pages = (await bindings.DB.prepare("SELECT name,rootpage FROM sqlite_master WHERE type='table' AND name IN ('purchases','purchase_items','payments','shop_settings') ORDER BY name").all()).results
    await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS.slice(0, 8))
    expect(await rows()).toEqual(before)
    expect((await bindings.DB.prepare("SELECT name,rootpage FROM sqlite_master WHERE type='table' AND name IN ('purchases','purchase_items','payments','shop_settings') ORDER BY name").all()).results).toEqual(pages)
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
    expect((await bindings.DB.prepare('PRAGMA quick_check').first())).toEqual({ quick_check: 'ok' })
    await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS.slice(0, 8))
    expect(await rows()).toEqual(before)
    expect((await bindings.DB.prepare('SELECT COUNT(*) AS total FROM d1_migrations').first())).toEqual({ total: 8 })
  })
})
