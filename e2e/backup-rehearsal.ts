import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import type { D1Database } from '@cloudflare/workers-types'
import type { Invoice } from '../shared/invoices'
import { prepareRecoverySql } from '../maintenance/prepare-recovery'

type Row = Record<string, unknown>
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const root = process.cwd()
const cli = join(root,'node_modules/wrangler/bin/wrangler.js')
const environment = { ...process.env,CI: 'true',WRANGLER_SEND_METRICS: 'false' }
async function snapshot(db: D1Database) {
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' ORDER BY name").all<{ name: string }>()).results.map(row => row.name)
  const results = await db.batch<Row>(tables.map(table => db.prepare(`SELECT * FROM "${table}"`)))
  const data = Object.fromEntries(tables.map((table,index) => [table,results[index].results.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]))
  const schema = (await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' ORDER BY type,name").all()).results
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[])
  assert.deepEqual(await db.prepare('PRAGMA quick_check').first(),{ quick_check: 'ok' })
  return { data,schema }
}
function command(args: string[], logPath: string) {
  // Every command is explicitly LOCAL. Never accept an arbitrary database/config.
  assert(args.includes('--local'))
  const result = spawnSync(process.execPath,[cli,...args],{ cwd: root,env: environment,encoding: 'utf8',timeout: 60000 })
  writeFileSync(logPath,`${result.stdout ?? ''}\n${result.stderr ?? ''}`,{ mode: 0o600 })
  assert.equal(result.status,0,`Local recovery command failed; inspect ignored fixture log ${basename(logPath)}`)
  return result.stdout
}
async function freePort() {
  const socket = createServer()
  await new Promise<void>(resolve => socket.listen(0,'127.0.0.1',resolve))
  const address = socket.address()
  assert(address && typeof address !== 'string')
  await new Promise<void>((resolve,reject) => socket.close(error => error ? reject(error) : resolve()))
  return address.port
}

/** Full trusted Wrangler SQL round-trip into an empty local target, using only
 * disposable browser fixtures. Source records and production bindings stay out. */
export async function rehearseBackup(options: { outputDirectory: string; owner: { email: string; password: string }; invoice: Invoice; sourceCookie: string }) {
  const source = JSON.parse(readFileSync('.wrangler/browser-test-backend.json','utf8')) as { directory: string; persistencePath: string; pid: number }
  assert(basename(source.directory).startsWith('optidesk-browser-tests-'))
  assert(resolve(source.directory).startsWith(resolve(tmpdir())+'/'))
  assert.equal(source.persistencePath,join(source.directory,'.wrangler/state'))
  process.kill(source.pid,0) // Verify the owning disposable server is still alive.
  const sourceOptions = { configPath: join(root,'e2e/wrangler.jsonc'),remoteBindings: false,persist: { path: join(source.persistencePath,'v3') } }
  const original = await getPlatformProxy<{ DB: D1Database }>(sourceOptions)
  let before: Awaited<ReturnType<typeof snapshot>>
  try { before = await snapshot(original.env.DB) } finally { await original.dispose() }
  assert(before.data.invoices.length > 0 && before.data.prescriptions.length > 0)
  assert.equal(before.data.d1_migrations.length,9)
  const backupPath = join(options.outputDirectory,'rehearsal.sql')
  // This Wrangler's export command has no --persist-to. Its config-relative
  // default state directory must explicitly match the disposable source.
  const exportConfig = join(source.directory,'export-wrangler.json')
  writeFileSync(exportConfig,JSON.stringify({ name: 'optidesk-local-export-test',main: join(root,'worker/index.ts'),compatibility_date: '2026-10-01',d1_databases: [{ binding: 'DB',database_name: 'optidesk-browser-test-db',database_id: '11111111-1111-4111-8111-111111111111' }] }),{ mode: 0o600 })
  command(['d1','export','optidesk-browser-test-db','--local','--config',exportConfig,'--output',backupPath],join(options.outputDirectory,'export.log'))
  chmodSync(backupPath,0o600)
  const checksum = createHash('sha256').update(readFileSync(backupPath)).digest('hex')
  writeFileSync(`${backupPath}.sha256`,checksum+'\n',{ mode: 0o600 })
  assert.equal(createHash('sha256').update(readFileSync(backupPath)).digest('hex'),checksum)
  const preparedPath = join(options.outputDirectory,'rehearsal-prepared.sql')
  writeFileSync(preparedPath,prepareRecoverySql(readFileSync(backupPath,'utf8')),{ mode: 0o600 })

  const recovery = mkdtempSync(join(tmpdir(),'optidesk-restore-rehearsal-'))
  chmodSync(recovery,0o700)
  const config = join(recovery,'wrangler.json')
  writeFileSync(config,JSON.stringify({ name: 'optidesk-local-recovery-test',main: join(root,'worker/index.ts'),compatibility_date: '2026-10-01',assets: { directory: join(root,'dist/client'),not_found_handling: 'single-page-application',run_worker_first: ['/api','/api/*'] },d1_databases: [{ binding: 'DB',database_name: 'optidesk-recovery-test-db',database_id: '22222222-2222-4222-8222-222222222222',migrations_dir: join(root,'migrations') }] }),{ mode: 0o600 })
  const recoveryPersistence = join(recovery,'.wrangler/state')
  const recoveredOptions = { configPath: config,remoteBindings: false,persist: { path: join(recoveryPersistence,'v3') } }
  let worker: ReturnType<typeof spawn> | undefined
  try {
    // The full dump contains schema AND migration ledger; don't pre-migrate it.
    command(['d1','execute','optidesk-recovery-test-db','--local','--config',config,'--persist-to',recoveryPersistence,'--file',preparedPath],join(options.outputDirectory,'import.log'))
    const restored = await getPlatformProxy<{ DB: D1Database }>(recoveredOptions)
    let next: number, prefix: string, padding: number
    try {
      const after = await snapshot(restored.env.DB)
      assert.equal(digest(after.schema),digest(before.schema),'Restored schema differs')
      for (const table of Object.keys(before.data)) assert.equal(digest(after.data[table]),digest(before.data[table]),`Restored rows/fields differ in ${table}`)
      const shop = before.data.shop_settings[0]
      prefix = shop.invoice_prefix as string; padding = shop.invoice_number_padding as number
      // Simulate printed numbers missing from an old restore point. Reconcile
      // beyond them BEFORE reopening writes; never reuse a consumed sequence.
      next = (shop.next_invoice_number as number)+8
      await restored.env.DB.batch([
        restored.env.DB.prepare('UPDATE shop_settings SET next_invoice_number=? WHERE uuid=? AND next_invoice_number=?').bind(next,shop.uuid,shop.next_invoice_number),
        restored.env.DB.prepare(`INSERT INTO audit_logs(id,actor_admin_user_id,action,entity_type,entity_id,after_json)
          SELECT ?,?,'reconcile_invoice_sequence','shop_settings',uuid,json_object('next_invoice_number',next_invoice_number) FROM shop_settings WHERE uuid=? AND changes()=1`).bind(crypto.randomUUID(),before.data.admin_users[0].id,shop.uuid),
        restored.env.DB.prepare('UPDATE sessions SET revoked_at=created_at WHERE revoked_at IS NULL'),
      ])
      assert.equal((await restored.env.DB.prepare('SELECT next_invoice_number FROM shop_settings').first<{ next_invoice_number: number }>())!.next_invoice_number,next)
    } finally { await restored.dispose() }
    const repeated = command(['d1','migrations','apply','optidesk-recovery-test-db','--local','--config',config,'--persist-to',recoveryPersistence],join(options.outputDirectory,'repeat-migrations.log'))
    assert.match(repeated,/No migrations to apply/u)
    const secrets = join(recovery,'recovery.env')
    writeFileSync(secrets,`SESSION_PEPPER=${randomBytes(32).toString('base64url')}\n`,{ mode: 0o600 })
    const port = await freePort(), origin = `http://127.0.0.1:${port}`
    worker = spawn(process.execPath,[cli,'dev','--local','--config',config,'--persist-to',recoveryPersistence,'--env-file',secrets,'--port',String(port),'--ip','127.0.0.1','--show-interactive-dev-session','false'],{ cwd: root,env: environment,stdio: 'pipe' })
    let logs = ''
    worker.stdout?.on('data',chunk => { logs += String(chunk) }); worker.stderr?.on('data',chunk => { logs += String(chunk) })
    let ready = false
    for (let attempts = 0; attempts < 120; attempts++) {
      try { if ((await fetch(`${origin}/api/health`)).status === 200) { ready = true; break } } catch { /* Wait for the local listener. */ }
      if (worker.exitCode !== null) break
      await new Promise(resolve => setTimeout(resolve,250))
    }
    writeFileSync(join(options.outputDirectory,'recovery-worker.log'),logs,{ mode: 0o600 })
    assert(ready,'Recovered local Worker did not start')
    assert.equal((await fetch(`${origin}/api/auth/me`,{ headers: { Cookie: options.sourceCookie } })).status,401)
    const session = await (await fetch(`${origin}/api/auth/session`)).json() as { data: { authenticated: boolean; setupRequired: boolean } }
    assert.equal(session.data.authenticated,false); assert.equal(session.data.setupRequired,false)
    const login = await fetch(`${origin}/api/auth/login`,{ method: 'POST',headers: { Origin: origin,'Content-Type': 'application/json' },body: JSON.stringify(options.owner) })
    assert.equal(login.status,200,'Original fixture password could not sign in after restore')
    const cookie = login.headers.get('Set-Cookie')!.split(';')[0]
    const loggedIn = await login.json() as { data: { csrfToken: string } }
    const headers = { Origin: origin,'Content-Type': 'application/json',Cookie: cookie,'X-CSRF-Token': loggedIn.data.csrfToken }
    const invoicePath = `/api/customers/${options.invoice.customer_uuid}/purchases/${options.invoice.purchase_uuid}/invoice`
    const historical = await (await fetch(origin+invoicePath,{ headers })).json() as { data: Invoice }
    assert.equal(digest(historical.data),digest(options.invoice),'Historical invoice changed after restore')
    const purchase = await fetch(`${origin}/api/customers/${options.invoice.customer_uuid}/purchases`,{ method: 'POST',headers,body: JSON.stringify({ client_request_id: crypto.randomUUID(),purchase_date: '2020-01-17',items: [{ description: 'Recovery-only transaction',product_category: 'other',quantity: 1,unit_price: '10.01' }] }) })
    assert.equal(purchase.status,201)
    const created = await purchase.json() as { data: { uuid: string } }
    const issue = await fetch(`${origin}/api/customers/${options.invoice.customer_uuid}/purchases/${created.data.uuid}/invoice`,{ method: 'POST',headers,body: JSON.stringify({ client_request_id: crypto.randomUUID() }) })
    assert.equal(issue.status,201)
    const invoice = await issue.json() as { data: Invoice }
    assert.equal(invoice.data.invoice_number,`${prefix!}-${String(next!).padStart(padding!,'0')}`)
    assert(!before.data.invoices.some(row => row.invoice_number === invoice.data.invoice_number))
    const verification = await getPlatformProxy<{ DB: D1Database }>(recoveredOptions)
    try {
      await snapshot(verification.env.DB)
      assert.equal((await verification.env.DB.prepare('SELECT COUNT(*) AS total FROM invoices').first<{ total: number }>())!.total,before.data.invoices.length+1)
      assert.equal((await verification.env.DB.prepare('SELECT COUNT(*) AS total FROM (SELECT invoice_number FROM invoice_number_reservations GROUP BY invoice_number HAVING COUNT(*)>1)').first<{ total: number }>())!.total,0)
    } finally { await verification.dispose() }
    const originalAgain = await getPlatformProxy<{ DB: D1Database }>(sourceOptions)
    try { const unchanged = await snapshot(originalAgain.env.DB); assert.equal(digest(unchanged),digest(before),'Source fixtures changed during recovery') } finally { await originalAgain.dispose() }
    const result = { localOnly: true,checksumVerified: true,fullSchemaAndAllOriginalFieldsRestored: true,migrationCount: 9,repeatMigrationEmpty: true,foreignKeysClean: true,quickCheck: 'ok',sourceUnchanged: true,oldSessionsRejected: true,ownerLoginAfterRestore: true,historicalInvoiceUnchanged: true,printedNumberGapReconciled: true,newInvoiceNumberUnique: true,fixtureCounts: Object.fromEntries(Object.entries(before.data).map(([table,rows]) => [table,rows.length])) }
    writeFileSync(join(options.outputDirectory,'recovery-result.json'),JSON.stringify(result,null,2),{ mode: 0o600 })
    return result
  } finally {
    if (worker && worker.exitCode === null) { const exited = new Promise<void>(resolve => worker!.once('exit',() => resolve())); worker.kill('SIGTERM'); await exited }
    rmSync(recovery,{ recursive: true,force: true }) // Only our disposable recovery directory.
  }
}
