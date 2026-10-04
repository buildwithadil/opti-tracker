import { beforeEach, describe, expect, it } from 'vitest'
import type { Customer } from '../shared/customers'
import {
  archiveCustomer, createCustomer, getCustomer, listCustomers, restoreCustomer, updateCustomer,
  type CustomerActor,
} from '../worker/services/customers'
import { HttpError } from '../worker/lib/errors'
import { authenticatedHeaders, bindings, installDatabaseHooks, jsonRequest, setup, success, type AuthSession } from './helpers'

installDatabaseHooks()
let owner: AuthSession
let actor: CustomerActor
beforeEach(async () => {
  owner = await setup()
  actor = { adminId: owner.data.id, requestId: crypto.randomUUID() }
})

async function customerAudits() {
  return (await bindings.DB.prepare(`SELECT action,before_json,after_json,request_id FROM audit_logs
    WHERE entity_type = 'customer' ORDER BY rowid`).all<{ action: string; before_json: string | null; after_json: string; request_id: string }>()).results
}

/** Scheduling-only adapter. Every query/mutation/result still comes from real
 * workerd D1. Hold two actual completed reads at the same persisted revision
 * before permitting either real atomic batch, so race coverage is deterministic.
 * No SQL/results or success/failure responses are mocked or substituted. */
function gateTwoCustomerReads(database: D1Database) {
  let readCount = 0
  let release!: () => void
  let markReady!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const ready = new Promise<void>(resolve => { markReady = resolve })
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => new Proxy(statement, {
    get(target, key) {
      if (key === 'bind') return (...values: unknown[]) => wrap(target.bind(...values), sql)
      if (key === 'first' && sql.includes(',revision FROM customers WHERE uuid = ?')) {
        return async () => {
          const row = await target.first()
          readCount++
          if (readCount === 2) markReady()
          await gate
          return row
        }
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

describe('real D1 atomic mutation and audit rollback', () => {
  it('rolls creation back when its real audit insertion fails', async () => {
    await bindings.DB.prepare(`CREATE TRIGGER test_reject_customer_audit BEFORE INSERT ON audit_logs
      WHEN NEW.entity_type = 'customer' BEGIN SELECT RAISE(ABORT, 'test audit failure'); END`).run()
    try {
      await expect(createCustomer(bindings.DB, { name: 'Must not persist', phone: '+919876543210' }, actor)).rejects.toThrow(/test audit failure/u)
      expect((await bindings.DB.prepare('SELECT * FROM customers').all()).results).toEqual([])
      expect(await customerAudits()).toEqual([])
    } finally {
      await bindings.DB.prepare('DROP TRIGGER test_reject_customer_audit').run()
    }
  })

  it.each(['update', 'archive', 'restore'] as const)('rolls %s back, including revision/private archive metadata, when audit insertion fails', async action => {
    const customer = await createCustomer(bindings.DB, { name: 'Original', phone: '+919876543210' }, actor)
    if (action === 'restore') await archiveCustomer(bindings.DB, customer.uuid, actor)
    const original = await bindings.DB.prepare('SELECT * FROM customers WHERE uuid = ?').bind(customer.uuid).first()
    const beforeAudit = await customerAudits()
    await bindings.DB.prepare(`CREATE TRIGGER test_reject_customer_audit BEFORE INSERT ON audit_logs
      WHEN NEW.entity_type = 'customer' BEGIN SELECT RAISE(ABORT, 'test audit failure'); END`).run()
    try {
      const operation = action === 'update' ? updateCustomer(bindings.DB, customer.uuid, { name: 'Must not commit', phone: '+918123456789' }, actor)
        : action === 'archive' ? archiveCustomer(bindings.DB, customer.uuid, actor) : restoreCustomer(bindings.DB, customer.uuid, actor)
      await expect(operation).rejects.toThrow(/test audit failure/u)
      expect(await bindings.DB.prepare('SELECT * FROM customers WHERE uuid = ?').bind(customer.uuid).first()).toEqual(original)
      expect(await customerAudits()).toEqual(beforeAudit)
    } finally {
      await bindings.DB.prepare('DROP TRIGGER test_reject_customer_audit').run()
    }
  })

  it('races authenticated create requests using different representations of one phone; exactly one customer and audit commit', async () => {
    const responses = await Promise.all(['9876543210', '0091 98765-43210'].map(phone => jsonRequest('/api/customers', { name: 'Concurrent create', phone }, { headers: authenticatedHeaders(owner) })))
    expect(responses.map(response => response.status).sort()).toEqual([201, 409])
    const winner = await success<Customer>(responses.find(response => response.status === 201)!, 201)
    const rejected = await responses.find(response => response.status === 409)!.json() as { error: { code: string } }
    expect(rejected.error.code).toBe('CUSTOMER_PHONE_CONFLICT')
    expect((await bindings.DB.prepare('SELECT uuid FROM customers').all()).results).toEqual([{ uuid: winner.uuid }])
    const audits = await customerAudits()
    expect(audits).toHaveLength(1)
    expect(JSON.parse(audits[0].after_json)).toEqual(winner)
  })

  it('races two different customer updates to one active phone without allowing duplicate rows or failed-write audit', async () => {
    const first = await createCustomer(bindings.DB, { name: 'First', phone: '+919876543210' }, actor)
    const second = await createCustomer(bindings.DB, { name: 'Second', phone: '+918123456789' }, actor)
    const outcomes = await Promise.allSettled([
      updateCustomer(bindings.DB, first.uuid, { phone: '+917123456789' }, { ...actor, requestId: 'first-update' }),
      updateCustomer(bindings.DB, second.uuid, { phone: '+917123456789' }, { ...actor, requestId: 'second-update' }),
    ])
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const failure = outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(failure.reason).toMatchObject({ status: 409, code: 'CUSTOMER_PHONE_CONFLICT' })
    const audits = await customerAudits()
    expect(audits.map(entry => entry.action)).toEqual(['create', 'create', 'update'])
    const persisted = (await bindings.DB.prepare('SELECT normalized_phone FROM customers').all<{ normalized_phone: string }>()).results
    expect(persisted.filter(row => row.normalized_phone === '+917123456789')).toHaveLength(1)
  })

  it('races two archived restores sharing a phone; exactly one restore and audit succeed, the loser remains archived', async () => {
    const first = await createCustomer(bindings.DB, { name: 'First', phone: '+919876543210' }, actor)
    await archiveCustomer(bindings.DB, first.uuid, actor)
    const second = await createCustomer(bindings.DB, { name: 'Second', phone: '+919876543210' }, actor)
    await archiveCustomer(bindings.DB, second.uuid, actor)
    const outcomes = await Promise.allSettled([
      restoreCustomer(bindings.DB, first.uuid, { ...actor, requestId: 'restore-first' }),
      restoreCustomer(bindings.DB, second.uuid, { ...actor, requestId: 'restore-second' }),
    ])
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect((outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409, code: 'CUSTOMER_PHONE_CONFLICT' })
    const rows = (await bindings.DB.prepare('SELECT archived_at FROM customers').all<{ archived_at: string | null }>()).results
    expect(rows.filter(row => row.archived_at === null)).toHaveLength(1)
    expect((await customerAudits()).filter(entry => entry.action === 'restore')).toHaveLength(1)
  })
})

describe('deterministic same-revision D1 races and exact audit snapshots', () => {
  it.each([
    ['update', 'update'], ['update', 'archive'], ['archive', 'archive'], ['restore', 'update'], ['restore', 'restore'],
  ] as const)('guards %s versus %s against lost updates without auditing the stale loser', async (firstAction, secondAction) => {
    const created = await createCustomer(bindings.DB, { name: 'Original', phone: '+919876543210' }, actor)
    if (firstAction === 'restore') await archiveCustomer(bindings.DB, created.uuid, actor)
    const before = await getCustomer(bindings.DB, created.uuid)
    const previousAudits = await customerAudits()
    const gate = gateTwoCustomerReads(bindings.DB)
    const run = (action: string, label: string) => {
      const identity = { ...actor, requestId: label }
      return action === 'update' ? updateCustomer(gate.database, created.uuid, { name: `Saved by ${label}` }, identity)
        : action === 'archive' ? archiveCustomer(gate.database, created.uuid, identity) : restoreCustomer(gate.database, created.uuid, identity)
    }
    const pending = [run(firstAction, 'first-writer'), run(secondAction, 'second-writer')]
    try {
      await gate.ready
    } finally {
      gate.release()
    }
    const outcomes = await Promise.allSettled(pending)
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(HttpError)
    expect(rejected.reason).toMatchObject({ status: 409, code: 'CUSTOMER_CHANGED' })
    const winnerIndex = outcomes.findIndex(result => result.status === 'fulfilled')
    const winner = (outcomes[winnerIndex] as PromiseFulfilledResult<Customer>).value
    expect(await getCustomer(bindings.DB, created.uuid)).toEqual(winner)
    const audits = await customerAudits()
    expect(audits).toHaveLength(previousAudits.length + 1)
    expect(audits.slice(0, -1)).toEqual(previousAudits)
    expect(audits.at(-1)).toMatchObject({ action: [firstAction, secondAction][winnerIndex], request_id: ['first-writer', 'second-writer'][winnerIndex] })
    expect(JSON.parse(audits.at(-1)!.before_json!)).toEqual(before)
    expect(JSON.parse(audits.at(-1)!.after_json)).toEqual(winner)
    expect((await bindings.DB.prepare('SELECT revision FROM customers WHERE uuid = ?').bind(created.uuid).first<{ revision: number }>())!.revision)
      .toBe(firstAction === 'restore' ? 2 : 1)
  })
})

describe('list and count snapshot consistency under real D1 writes', () => {
  it('always returns a matching count/page snapshot while creates and archives run concurrently', async () => {
    const query = { search: 'Snapshot', status: 'active', page: 1, pageSize: 50, sort: 'created_at', order: 'desc' } as const
    const seed = await createCustomer(bindings.DB, { name: 'Snapshot seed', phone: '+919876543210' }, actor)
    const observations: Promise<void>[] = []
    const write = async () => {
      for (let index = 0; index < 20; index++) {
        const customer = await createCustomer(bindings.DB, { name: `Snapshot ${index}`, phone: `+9181234500${String(index).padStart(2, '0')}` }, actor)
        if (index % 2 === 0) await archiveCustomer(bindings.DB, customer.uuid, actor)
      }
      await archiveCustomer(bindings.DB, seed.uuid, actor)
    }
    observations.push(write())
    for (let reader = 0; reader < 3; reader++) observations.push((async () => {
      // Keep reading between writes, not just a burst before the writer starts.
      for (let observation = 0; observation < 15; observation++) {
        const result = await listCustomers(bindings.DB, query)
        expect(result.pagination.total).toBe(result.customers.length)
        expect(result.pagination.totalPages).toBe(1)
        expect(result.customers.every(customer => customer.archived_at === null && customer.name.includes('Snapshot'))).toBe(true)
        expect(new Set(result.customers.map(customer => customer.uuid)).size).toBe(result.customers.length)
      }
    })())
    await Promise.all(observations)
    expect((await listCustomers(bindings.DB, query)).pagination.total).toBe(10)
  })
})
