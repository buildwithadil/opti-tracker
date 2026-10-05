import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { unstable_splitSqlQuery } from 'wrangler'

// The preserved customer rebuild makes physical dump order differ from FK
// dependency order. Audit anchors also require audits before financial rows.
const tables = ['d1_migrations','application_metadata','admin_users','shop_settings','settings','sessions','auth_rate_limits','login_attempts','customers','prescriptions','tax_profiles','audit_logs','purchases','purchase_items','payments','payment_reversals','invoice_number_reservations','invoices']
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

/** Offline only, for a trusted full OptiDesk SQL export and an EMPTY recovery
 * database. Reorder statements; never rewrite values, drop guards or disable FK. */
export function prepareRecoverySql(sql: string): string {
  const statements = unstable_splitSqlQuery(sql)
  const pragmas: string[] = [], schema: string[] = [], definitions: string[] = [], sequence: string[] = []
  const data = new Map(tables.map(table => [table,[] as string[]]))
  for (const statement of statements) {
    if (/^PRAGMA\s+defer_foreign_keys\s*=\s*(?:TRUE|ON|1)$/iu.test(statement)) pragmas.push(statement)
    else if (/^CREATE TABLE\b/iu.test(statement)) schema.push(statement)
    else if (/^CREATE (?:UNIQUE )?(?:INDEX|TRIGGER|VIEW)\b/iu.test(statement)) definitions.push(statement)
    else if (/^DELETE FROM\s+"?sqlite_sequence"?$/iu.test(statement)) sequence.push(statement)
    else {
      const insert = statement.match(/^INSERT INTO\s+(?:"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))\s/iu)
      const table = insert?.[1] ?? insert?.[2]
      if (table === 'sqlite_sequence') { sequence.push(statement); continue }
      assert(table && data.has(table),'Unsupported SQL statement/table; use a trusted pinned-version full OptiDesk export')
      data.get(table)!.push(statement)
    }
  }
  assert(pragmas.length === 1 && schema.length === tables.length,'Incomplete or unsupported OptiDesk full export')
  const ordered = [...pragmas,...schema,...tables.flatMap(table => data.get(table)!),...sequence,...definitions]
  // Verify the multiset of original SQL bytes: nothing lost/added/rewritten.
  assert.deepEqual(ordered.map(hash).sort(),statements.map(hash).sort())
  return ordered.map(statement => statement+';').join('\n')+'\n'
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length,4,'Usage: node maintenance/prepare-recovery.ts <trusted-export.sql> <new-private-prepared.sql>')
  const input = resolve(process.argv[2]), output = resolve(process.argv[3])
  assert.notEqual(input,output,'Keep the original backup untouched')
  const source = readFileSync(input,'utf8'), prepared = prepareRecoverySql(source)
  writeFileSync(output,prepared,{ mode: 0o600,flag: 'wx' })
  writeFileSync(`${output}.sha256`,hash(prepared)+'  '+output+'\n',{ mode: 0o600,flag: 'wx' })
  console.log('Prepared trusted SQL in dependency order; original statements/values preserved. Import only into an approved empty recovery database.')
}
