import { beforeEach, describe, expect, it } from 'vitest'
import type { Prescription } from '../shared/prescriptions'
import { HttpError } from '../worker/lib/errors'
import { archiveCustomer, createCustomer } from '../worker/services/customers'
import { createPrescription, getPrescription, getPrescriptionHistory, listPrescriptions, revisePrescription, type PrescriptionActor } from '../worker/services/prescriptions'
import { bindings, count, installDatabaseHooks, setup, type AuthSession } from './helpers'

installDatabaseHooks()
let owner: AuthSession
let actor: PrescriptionActor
let customerUuid: string
beforeEach(async () => {
  owner = await setup()
  actor = { adminId: owner.data.id, requestId: crypto.randomUUID() }
  customerUuid = (await createCustomer(bindings.DB, { name: 'Race Customer', phone: '+919876543210' }, actor)).uuid
})
async function audits() {
  return (await bindings.DB.prepare("SELECT * FROM audit_logs WHERE entity_type = 'prescription' ORDER BY rowid").all()).results
}
const root = () => createPrescription(bindings.DB, customerUuid, { prescribed_on: '2026-01-01', right_sphere: '+1.25', notes: 'Original clinical notes' }, actor)

/** A scheduling-only proxy: the actual D1 first() completes and its genuine
 * result is held until all competing writers have read the same state. Every
 * statement, batch, constraint, result and rollback is actual workerd D1; no
 * SQL result or application response is invented/substituted. */
function gateReads(database: D1Database, matches: (sql: string) => boolean, expectedReads: number) {
  let reads = 0
  let release!: () => void
  let markReady!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const ready = new Promise<void>(resolve => { markReady = resolve })
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => new Proxy(statement, {
    get(target, key) {
      if (key === 'bind') return (...values: unknown[]) => wrap(target.bind(...values), sql)
      if (key === 'first' && matches(sql)) return async () => {
        const row = await target.first()
        reads++
        if (reads === expectedReads) markReady()
        await gate
        return row
      }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return {
    database: new Proxy(database, {
      get(target, key) {
        if (key === 'prepare') return (sql: string) => wrap(target.prepare(sql), sql)
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }), ready, release,
  }
}

describe('real D1 prescription atomic audit rollback and deterministic concurrent append', () => {
  it('rolls root insertion back entirely if its actual create audit is rejected', async () => {
    await bindings.DB.prepare(`CREATE TRIGGER test_reject_prescription_audit BEFORE INSERT ON audit_logs
      WHEN NEW.entity_type = 'prescription' BEGIN SELECT RAISE(ABORT, 'test prescription audit failure'); END`).run()
    try {
      await expect(root()).rejects.toThrow(/test prescription audit failure/u)
      expect(await count('prescriptions')).toBe(0)
      expect(await audits()).toEqual([])
    } finally { await bindings.DB.prepare('DROP TRIGGER test_reject_prescription_audit').run() }
  })

  it.each(['supersede', 'revise'])('rolls child plus every earlier audit back when the %s audit fails', async action => {
    const original = await root()
    const originalRow = await bindings.DB.prepare('SELECT * FROM prescriptions').first()
    const previousAudit = await audits()
    await bindings.DB.prepare(`CREATE TRIGGER test_reject_prescription_audit BEFORE INSERT ON audit_logs
      WHEN NEW.entity_type = 'prescription' AND NEW.action = '${action}'
      BEGIN SELECT RAISE(ABORT, 'test prescription audit failure'); END`).run()
    try {
      await expect(revisePrescription(bindings.DB, customerUuid, original.uuid, { right_sphere: '-2', revision_reason: 'Must roll back' }, actor)).rejects.toThrow(/test prescription audit failure/u)
      expect(await count('prescriptions')).toBe(1)
      expect(await bindings.DB.prepare('SELECT * FROM prescriptions').first()).toEqual(originalRow)
      expect(await getPrescription(bindings.DB, customerUuid, original.uuid)).toEqual(original)
      expect(await audits()).toEqual(previousAudit)
    } finally { await bindings.DB.prepare('DROP TRIGGER test_reject_prescription_audit').run() }
  })

  it.each([1, 2, 3])('races same-parent revisions at chain depth %i: one child, one 409 and exactly two winning audits', async depth => {
    let parent = await root()
    for (let revision = 1; revision < depth; revision++) parent = await revisePrescription(bindings.DB, customerUuid, parent.uuid,
      { notes: `Earlier revision ${revision}`, revision_reason: 'Prepare chain' }, actor)
    const previousRows = (await bindings.DB.prepare('SELECT * FROM prescriptions ORDER BY revision_number').all()).results
    const previousAudits = await audits()
    const gate = gateReads(bindings.DB, sql => sql.includes('WHERE p.customer_id = ? AND p.id = ?'), 2)
    const pending = [0, 1].map(index => revisePrescription(gate.database, customerUuid, parent.uuid,
      { right_sphere: index === 0 ? '-2.13' : '+3.37', revision_reason: `Writer ${index}` }, { ...actor, requestId: `writer-${index}` }))
    try { await gate.ready } finally { gate.release() }
    const outcomes = await Promise.allSettled(pending)
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    const loser = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult
    expect(loser.reason).toBeInstanceOf(HttpError)
    expect(loser.reason).toMatchObject({ status: 409, code: 'PRESCRIPTION_NOT_CURRENT' })
    const winnerIndex = outcomes.findIndex(outcome => outcome.status === 'fulfilled')
    const winner = (outcomes[winnerIndex] as PromiseFulfilledResult<Prescription>).value
    expect(winner).toMatchObject({ root_uuid: parent.root_uuid, revision_number: depth + 1, supersedes_uuid: parent.uuid,
      revision_reason: `Writer ${winnerIndex}`, right_sphere: winnerIndex === 0 ? '-2.13' : '+3.37', status: 'current' })
    expect(await getPrescription(bindings.DB, customerUuid, winner.uuid)).toEqual(winner)
    expect((await bindings.DB.prepare('SELECT * FROM prescriptions ORDER BY revision_number').all()).results.slice(0, -1)).toEqual(previousRows)
    expect(await count('prescriptions')).toBe(depth + 1)
    expect((await bindings.DB.prepare('SELECT id FROM prescriptions WHERE supersedes_id = ?').bind(parent.uuid).all()).results).toEqual([{ id: winner.uuid }])
    const afterAudits = await audits()
    expect(afterAudits.slice(0, -2)).toEqual(previousAudits)
    expect(afterAudits.slice(-2)).toMatchObject([{ action: 'supersede', entity_id: parent.uuid, request_id: `writer-${winnerIndex}` },
      { action: 'revise', entity_id: winner.uuid, request_id: `writer-${winnerIndex}` }])
    expect(afterAudits.some(event => event.request_id === `writer-${1 - winnerIndex}`)).toBe(false)
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  })

  it.each(['create', 'revise'])('guards customer archive inside the atomic %s batch after the genuine active pre-read', async operation => {
    const parent = await root()
    const previousAudits = await audits()
    const gate = gateReads(bindings.DB, sql => sql === 'SELECT uuid,archived_at FROM customers WHERE uuid = ?', 1)
    const pending = operation === 'create'
      ? createPrescription(gate.database, customerUuid, { prescribed_on: '2026-01-02' }, actor)
      : revisePrescription(gate.database, customerUuid, parent.uuid, { notes: 'Must not save', revision_reason: 'Raced archive' }, actor)
    // Attach rejection handling before releasing, without replacing the result.
    const outcome = Promise.allSettled([pending])
    try {
      await gate.ready
      await archiveCustomer(bindings.DB, customerUuid, actor)
    } finally { gate.release() }
    const [result] = await outcome
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 409, code: 'CUSTOMER_ARCHIVED' })
    expect(await count('prescriptions')).toBe(1)
    expect(await audits()).toEqual(previousAudits)
    expect(await getPrescription(bindings.DB, customerUuid, parent.uuid)).toEqual(parent)
  })

  it('keeps list/count and chain/count snapshots consistent while real roots and revisions append concurrently', async () => {
    const original = await root()
    const writes = (async () => {
      let parent = original
      for (let index = 0; index < 12; index++) {
        parent = await revisePrescription(bindings.DB, customerUuid, parent.uuid, { notes: `Snapshot ${index}`, revision_reason: 'Snapshot append' }, actor)
        await createPrescription(bindings.DB, customerUuid, { prescribed_on: '2025-01-01' }, actor)
      }
    })()
    await Promise.all([writes, ...[0, 1].map(async () => {
      for (let observation = 0; observation < 15; observation++) {
        const listed = await listPrescriptions(bindings.DB, customerUuid, { page: 1, pageSize: 50 })
        expect(listed.pagination.total).toBe(listed.prescriptions.length)
        expect(new Set(listed.prescriptions.map(row => row.uuid)).size).toBe(listed.prescriptions.length)
        const history = await getPrescriptionHistory(bindings.DB, customerUuid, original.uuid, { page: 1, pageSize: 50 })
        expect(history.pagination.total).toBe(history.prescriptions.length)
        expect(history.prescriptions.map(row => row.revision_number)).toEqual(Array.from({ length: history.pagination.total }, (_, index) => history.pagination.total - index))
        expect(history.prescriptions.filter(row => row.status === 'current')).toHaveLength(1)
      }
    })])
    expect((await listPrescriptions(bindings.DB, customerUuid, { page: 1, pageSize: 50 })).pagination.total).toBe(25)
    expect((await getPrescriptionHistory(bindings.DB, customerUuid, original.uuid, { page: 1, pageSize: 50 })).pagination.total).toBe(13)
  })
})

describe('actual D1 immutable linear ancestry and referential integrity', () => {
  it('rejects changes to every original column, no-op updates and deletion while permitting only linked child inserts', async () => {
    const original = await root()
    const before = await bindings.DB.prepare('SELECT * FROM prescriptions').first()
    const columns = (await bindings.DB.prepare('PRAGMA table_info(prescriptions)').all<{ name: string }>()).results
    for (const { name } of columns) await expect(bindings.DB.prepare(`UPDATE prescriptions SET ${name} = ${name} WHERE id = ?`).bind(original.uuid).run()).rejects.toThrow(/prescriptions are immutable/u)
    await expect(bindings.DB.prepare('UPDATE prescriptions SET customer_id = ?,right_sphere = ? WHERE id = ?').bind(crypto.randomUUID(), '99.99', original.uuid).run()).rejects.toThrow(/prescriptions are immutable/u)
    await expect(bindings.DB.prepare('DELETE FROM prescriptions WHERE id = ?').bind(original.uuid).run()).rejects.toThrow(/prescriptions are immutable/u)
    expect(await bindings.DB.prepare('SELECT * FROM prescriptions').first()).toEqual(before)
    await revisePrescription(bindings.DB, customerUuid, original.uuid, { notes: 'Append allowed', revision_reason: 'Linked child' }, actor)
    expect(await bindings.DB.prepare('SELECT * FROM prescriptions WHERE id = ?').bind(original.uuid).first()).toEqual(before)
  })

  it('enforces lineage at the database boundary against missing roots, mismatched customers/roots, skipped revisions, cycles and branches', async () => {
    const parent = await root()
    const other = await createCustomer(bindings.DB, { name: 'Other', phone: '+918123456789' }, actor)
    const otherRoot = await createPrescription(bindings.DB, other.uuid, { prescribed_on: '2026-01-01' }, actor)
    const id = crypto.randomUUID()
    const attempt = (fields: { id?: string; customer?: string; root?: string | null; parent?: string | null; version?: number; reason?: string | null; status?: string; deleted?: string | null }) =>
      bindings.DB.prepare(`INSERT INTO prescriptions(id,customer_id,root_id,supersedes_id,revision_number,revision_reason,status,deleted_at,deleted_by_admin_id)
        VALUES (?,?,?,?,?,?,?,?,?)`).bind(fields.id ?? id, fields.customer ?? customerUuid,
          fields.root === undefined ? parent.uuid : fields.root, fields.parent === undefined ? parent.uuid : fields.parent,
          fields.version ?? 2, fields.reason === undefined ? 'Raw child' : fields.reason, fields.status ?? 'active',
          fields.deleted ?? null, fields.deleted ? actor.adminId : null).run()
    for (const fields of [{ root: null }, { customer: other.uuid }, { root: otherRoot.uuid }, { parent: crypto.randomUUID() },
      { version: 1 }, { version: 3 }, { reason: null }, { id: parent.uuid }, { root: id }, { status: 'archived' },
      { deleted: '2026-01-01T00:00:00.000Z' }, { parent: null, root: parent.uuid }, { parent: null, root: id, version: 2 },
      { parent: null, root: id, version: 1, reason: 'Root reason is forbidden' }]) {
      await expect(attempt(fields)).rejects.toThrow(/invalid prescription lineage/u)
    }
    expect(await count('prescriptions')).toBe(2)
    await attempt({})
    await expect(attempt({ id: crypto.randomUUID() })).rejects.toThrow(/invalid prescription lineage|UNIQUE constraint/u)
    const grandchild = crypto.randomUUID()
    await bindings.DB.prepare(`INSERT INTO prescriptions(id,customer_id,root_id,supersedes_id,revision_number,revision_reason)
      VALUES (?,?,?,?,3,'Grandchild')`).bind(grandchild, customerUuid, parent.uuid, id).run()
    expect((await getPrescriptionHistory(bindings.DB, customerUuid, parent.uuid, { page: 1, pageSize: 20 })).prescriptions.map(row => row.uuid)).toEqual([grandchild, id, parent.uuid])
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  })

  it('retains genuine customer, root and parent foreign keys independently of lineage guards and unique indexes', async () => {
    const parent = await root()
    const indexes = (await bindings.DB.prepare('PRAGMA index_list(prescriptions)').all<{ name: string; unique: number; partial: number }>()).results
    expect(indexes).toContainEqual(expect.objectContaining({ name: 'uq_prescriptions_successor', unique: 1, partial: 1 }))
    expect(indexes).toContainEqual(expect.objectContaining({ name: 'uq_prescriptions_root_revision', unique: 1 }))
    expect((await bindings.DB.prepare('PRAGMA index_info(uq_prescriptions_successor)').all<{ name: string }>()).results.map(row => row.name)).toEqual(['supersedes_id'])
    expect((await bindings.DB.prepare('PRAGMA index_info(uq_prescriptions_root_revision)').all<{ name: string }>()).results.map(row => row.name)).toEqual(['root_id', 'revision_number'])
    const guard = await bindings.DB.prepare("SELECT sql FROM sqlite_master WHERE name = 'prescriptions_lineage_insert'").first<{ sql: string }>()
    expect(guard).not.toBeNull()
    await bindings.DB.prepare('DROP TRIGGER prescriptions_lineage_insert').run()
    try {
      const missing = crypto.randomUUID()
      for (const [customer, root, supersedes] of [[customerUuid, missing, parent.uuid],
        [customerUuid, parent.uuid, missing], [missing, parent.uuid, parent.uuid]]) {
        await expect(bindings.DB.prepare(`INSERT INTO prescriptions(id,customer_id,root_id,supersedes_id,revision_number,revision_reason)
          VALUES (?,?,?,?,2,'FK must still guard')`).bind(crypto.randomUUID(), customer, root, supersedes).run()).rejects.toThrow(/FOREIGN KEY constraint failed/u)
      }
      // Database indexes, not the application or lineage trigger, also prevent
      // duplicate root-version slots and multiple successors on the same parent.
      const child = crypto.randomUUID()
      await bindings.DB.prepare(`INSERT INTO prescriptions(id,customer_id,root_id,supersedes_id,revision_number,revision_reason)
        VALUES (?,?,?,?,2,'Independent indexes')`).bind(child, customerUuid, parent.uuid, parent.uuid).run()
      await expect(bindings.DB.prepare(`INSERT INTO prescriptions(id,customer_id,root_id,supersedes_id,revision_number,revision_reason)
        VALUES (?,?,?,?,3,'Duplicate successor')`).bind(crypto.randomUUID(), customerUuid, parent.uuid, parent.uuid).run()).rejects.toThrow(/UNIQUE constraint failed: prescriptions.supersedes_id/u)
      await expect(bindings.DB.prepare(`INSERT INTO prescriptions(id,customer_id,root_id,supersedes_id,revision_number,revision_reason)
        VALUES (?,?,?,?,2,'Duplicate version')`).bind(crypto.randomUUID(), customerUuid, parent.uuid, child).run()).rejects.toThrow(/UNIQUE constraint failed: prescriptions.root_id, prescriptions.revision_number/u)
    } finally { await bindings.DB.prepare(guard!.sql).run() }
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
    const restored = await bindings.DB.prepare("SELECT sql FROM sqlite_master WHERE name = 'prescriptions_lineage_insert'").first()
    expect(restored).toEqual(guard)
  })

  it('rejects successors to archived or deleted legacy roots, invalid revision/reason bounds and nonexistent customer FKs', async () => {
    for (const archived of [true, false]) {
      const id = crypto.randomUUID()
      await bindings.DB.prepare(`INSERT INTO prescriptions(id,customer_id,root_id,status,deleted_at,deleted_by_admin_id)
        VALUES (?,?,?,?,?,?)`).bind(id, customerUuid, id, archived ? 'archived' : 'active',
          archived ? null : '2025-01-01T00:00:00.000Z', archived ? null : actor.adminId).run()
      await expect(bindings.DB.prepare(`INSERT INTO prescriptions(id,customer_id,root_id,supersedes_id,revision_number,revision_reason)
        VALUES (?,?,?,?,2,'Forbidden')`).bind(crypto.randomUUID(), customerUuid, id, id).run()).rejects.toThrow(/invalid prescription lineage/u)
    }
    const orphan = crypto.randomUUID()
    await expect(bindings.DB.prepare('INSERT INTO prescriptions(id,customer_id,root_id) VALUES (?,?,?)').bind(orphan, crypto.randomUUID(), orphan).run()).rejects.toThrow(/FOREIGN KEY constraint failed/u)
    const parent = await root()
    for (const [revision, reason] of [[0, 'Reason'], [2.5, 'Reason'], [2, ''], [2, 'x'.repeat(501)]] as const) {
      await expect(bindings.DB.prepare(`INSERT INTO prescriptions(id,customer_id,root_id,supersedes_id,revision_number,revision_reason)
        VALUES (?,?,?,?,?,?)`).bind(crypto.randomUUID(), customerUuid, parent.uuid, parent.uuid, revision, reason).run()).rejects.toThrow(/invalid prescription lineage|CHECK constraint/u)
    }
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  })
})
