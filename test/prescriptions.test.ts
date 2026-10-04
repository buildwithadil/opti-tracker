import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Customer } from '../shared/customers'
import type { Prescription, PrescriptionHistory, PrescriptionList } from '../shared/prescriptions'
import { authenticatedHeaders, bindings, count, failure, installDatabaseHooks, jsonRequest, login, ORIGIN, request, setup, success, type AuthSession } from './helpers'

installDatabaseHooks()
let owner: AuthSession
let customer: Customer
beforeEach(async () => {
  owner = await setup()
  customer = await success<Customer>(await jsonRequest('/api/customers', { name: 'Clinical Customer', phone: '9876543210' }, { headers: authenticatedHeaders(owner) }), 201)
})
const publicKeys = ['uuid', 'customer_uuid', 'prescription_type', 'prescribed_on', 'expires_on', 'prescriber_name', 'notes',
  'right_sphere', 'right_cylinder', 'right_axis', 'right_addition', 'left_sphere', 'left_cylinder', 'left_axis', 'left_addition',
  'distance_pd', 'near_pd', 'right_pd', 'left_pd', 'root_uuid', 'revision_number', 'supersedes_uuid', 'superseded_by_uuid',
  'superseded_at', 'status', 'revision_reason', 'created_at', 'updated_at'].sort()
const metadataKeys = ['uuid', 'customer_uuid', 'prescription_type', 'root_uuid', 'revision_number', 'supersedes_uuid',
  'superseded_by_uuid', 'superseded_at', 'prescribed_on', 'expires_on', 'status', 'created_at', 'updated_at']
const metadata = (row: Prescription) => Object.fromEntries(metadataKeys.map(key => [key, row[key as keyof Prescription]]))
function path(id?: string, uuid = customer.uuid) { return `/api/customers/${uuid}/prescriptions${id ? `/${id}` : ''}` }
function create(input: unknown = { prescribed_on: '2026-01-02' }) { return jsonRequest(path(), input, { headers: authenticatedHeaders(owner) }) }
function revise(id: string, input: unknown) { return jsonRequest(path(id), input, { method: 'PATCH', headers: authenticatedHeaders(owner) }) }
function read<T>(url: string) { return request(url, { headers: { Cookie: owner.cookie } }).then(response => success<T>(response)) }
async function audits() {
  return (await bindings.DB.prepare("SELECT * FROM audit_logs WHERE entity_type = 'prescription' ORDER BY rowid")
    .all<{ action: string; entity_id: string; actor_admin_user_id: string; request_id: string; before_json: string | null; after_json: string; metadata_json: string | null }>()).results
}
async function record(response: Response, status = 201) {
  const envelope = await response.clone().json() as { meta: { requestId: string } }
  const result = await success<Prescription>(response, status)
  expect(Object.keys(result).sort()).toEqual(publicKeys)
  expect(result.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  expect(result.customer_uuid).toBe(customer.uuid)
  expect(result.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  expect(result.updated_at).toBe(result.created_at)
  expect(envelope.meta.requestId).toBe(response.headers.get('X-Request-Id'))
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  return result
}

describe('actual SELF customer-linked prescription REST lifecycle', () => {
  it('creates exact signed values, reads, appends replacements, preserves originals and returns linear history/audit identity', async () => {
    const rootResponse = await create({ prescribed_on: '2024-02-29', expires_on: '2027-02-28',
      right_sphere: '+1.13', right_cylinder: '-.5', right_axis: 0, right_addition: '-0.00',
      left_sphere: -2.25, left_axis: 180, distance_pd: '63.5', near_pd: '59.25', right_pd: '30', left_pd: '31',
      prescriber_name: '  Dr. Private Clinical Name  ', notes: '  Private clinical notes\nSecond line  ' })
    const root = await record(rootResponse)
    expect(root).toMatchObject({ root_uuid: root.uuid, revision_number: 1, supersedes_uuid: null,
      superseded_by_uuid: null, superseded_at: null, status: 'current', revision_reason: null,
      right_sphere: '+1.13', right_cylinder: '-0.50', right_axis: 0, right_addition: '0.00',
      left_sphere: '-2.25', left_cylinder: null, left_axis: 180, left_addition: null,
      distance_pd: '63.50', near_pd: '59.25', right_pd: '30.00', left_pd: '31.00',
      prescriber_name: 'Dr. Private Clinical Name', notes: 'Private clinical notes\nSecond line' })
    const originalRow = await bindings.DB.prepare('SELECT * FROM prescriptions WHERE id = ?').bind(root.uuid).first()
    expect(await read<Prescription>(path(root.uuid.toUpperCase(), customer.uuid.toUpperCase()))).toEqual(root)
    const revisionResponse = await revise(root.uuid, { right_sphere: '-3.13', near_pd: null, notes: '', revision_reason: '  Correct supplied record  ' })
    const replacement = await record(revisionResponse)
    expect(replacement).toMatchObject({ ...root, uuid: replacement.uuid, right_sphere: '-3.13', near_pd: null, notes: null,
      root_uuid: root.uuid, revision_number: 2, supersedes_uuid: root.uuid, status: 'current',
      revision_reason: 'Correct supplied record', created_at: replacement.created_at, updated_at: replacement.updated_at })
    expect(replacement.uuid).not.toBe(root.uuid)
    expect(await bindings.DB.prepare('SELECT * FROM prescriptions WHERE id = ?').bind(root.uuid).first()).toEqual(originalRow)
    const superseded = await read<Prescription>(path(root.uuid))
    expect(superseded).toEqual({ ...root, status: 'superseded', superseded_by_uuid: replacement.uuid, superseded_at: replacement.created_at })
    expect(await read<PrescriptionHistory>(`${path(root.uuid)}/history`)).toEqual({ root_uuid: root.uuid,
      prescriptions: [replacement, superseded], pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 } })
    expect(await read<PrescriptionHistory>(`${path(replacement.uuid)}/history?pageSize=1&page=2`)).toEqual({ root_uuid: root.uuid,
      prescriptions: [superseded], pagination: { page: 2, pageSize: 1, total: 2, totalPages: 2 } })
    await failure(await revise(root.uuid, { notes: 'Stale must not persist', revision_reason: 'Stale' }), 409, 'PRESCRIPTION_NOT_CURRENT')
    const thirdResponse = await revise(replacement.uuid, { prescribed_on: '2026-04-01', expires_on: null, revision_reason: 'New source date' })
    const third = await record(thirdResponse)
    expect(third).toMatchObject({ root_uuid: root.uuid, supersedes_uuid: replacement.uuid, revision_number: 3,
      prescribed_on: '2026-04-01', expires_on: null, right_sphere: '-3.13', distance_pd: '63.50', notes: null })
    expect((await read<PrescriptionHistory>(`${path(third.uuid)}/history`)).prescriptions.map(row => row.revision_number)).toEqual([3, 2, 1])
    const events = await audits()
    expect(events.map(event => event.action)).toEqual(['create', 'supersede', 'revise', 'supersede', 'revise'])
    expect(events.map(event => event.entity_id)).toEqual([root.uuid, root.uuid, replacement.uuid, replacement.uuid, third.uuid])
    expect(events.map(event => event.request_id)).toEqual([rootResponse.headers.get('X-Request-Id'),
      revisionResponse.headers.get('X-Request-Id'), revisionResponse.headers.get('X-Request-Id'),
      thirdResponse.headers.get('X-Request-Id'), thirdResponse.headers.get('X-Request-Id')])
    expect(JSON.parse(events[0].after_json)).toEqual(metadata(root))
    expect(JSON.parse(events[1].before_json!)).toEqual(metadata(root))
    expect(JSON.parse(events[1].after_json)).toEqual(metadata(superseded))
    expect(JSON.parse(events[2].after_json)).toEqual(metadata(replacement))
    for (const event of events) {
      expect(event.actor_admin_user_id).toBe(owner.data.id)
      expect(event.metadata_json).toBeNull()
      for (const forbidden of ['right_sphere', 'left_sphere', 'cylinder', 'axis', 'addition', '_pd', 'prescriber', 'notes',
        'Private clinical', 'Correct supplied record', 'session', 'csrf', 'token', 'password', 'ip_address', 'phone', 'email']) {
        expect(event.before_json ?? '').not.toContain(forbidden)
        expect(event.after_json).not.toContain(forbidden)
      }
    }
    expect(await count('prescriptions')).toBe(3)
    expect((await bindings.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  })

  it('keeps all omitted/null/blank measurements unknown and only explicit zero becomes zero', async () => {
    const unknown = await record(await create({ prescribed_on: '2026-01-01' }))
    for (const key of ['right_sphere', 'right_cylinder', 'right_axis', 'right_addition', 'left_sphere', 'left_cylinder', 'left_axis',
      'left_addition', 'distance_pd', 'near_pd', 'right_pd', 'left_pd', 'expires_on', 'prescriber_name', 'notes'] as const) expect(unknown[key]).toBeNull()
    const blank = await record(await create({ prescribed_on: '2026-01-02', right_sphere: '', left_sphere: null,
      right_axis: ' ', right_cylinder: 0, left_axis: '0', left_addition: '-0', distance_pd: '', notes: ' ' }))
    expect(blank).toMatchObject({ right_sphere: null, left_sphere: null, right_axis: null, right_cylinder: '0.00',
      left_axis: 0, left_addition: '0.00', distance_pd: null, near_pd: null, notes: null })
    expect(await read<Prescription>(path(blank.uuid))).toEqual(blank)
  })

  it('lists all immutable versions by date/newest timestamp/id, pages every row and isolates customer histories', async () => {
    expect(await read<PrescriptionList>(path())).toEqual({ prescriptions: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } })
    const other = await success<Customer>(await jsonRequest('/api/customers', { name: 'Other customer', phone: '8123456789' }, { headers: authenticatedHeaders(owner) }), 201)
    await success(await jsonRequest(path(undefined, other.uuid), { prescribed_on: '9999-12-31' }, { headers: authenticatedHeaders(owner) }), 201)
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()].sort()
    for (const id of ids) await bindings.DB.prepare(`INSERT INTO prescriptions(id,customer_id,root_id,prescribed_on,created_at)
      VALUES (?,?,?,'2025-01-01','2025-01-01T00:00:00.000Z')`).bind(id, customer.uuid, id).run()
    const old = await record(await create({ prescribed_on: '2024-01-01' }))
    const current = await record(await create({ prescribed_on: '2026-01-01' }))
    const revision = await record(await revise(current.uuid, { prescribed_on: '2026-02-01', revision_reason: 'Latest date' }))
    const all = await read<PrescriptionList>(`${path()}?pageSize=50`)
    expect(all.prescriptions.map(row => row.uuid)).toEqual([revision.uuid, current.uuid, ...ids, old.uuid])
    const seen: string[] = []
    for (let page = 1; page <= 3; page++) {
      const result = await read<PrescriptionList>(`${path()}?pageSize=2&page=${page}`)
      expect(result.pagination).toEqual({ page, pageSize: 2, total: 6, totalPages: 3 })
      seen.push(...result.prescriptions.map(row => row.uuid))
    }
    expect(seen).toEqual(all.prescriptions.map(row => row.uuid))
    expect(await read<PrescriptionList>(`${path()}?pageSize=50&page=10000`)).toEqual({ prescriptions: [], pagination: { page: 10000, pageSize: 50, total: 6, totalPages: 1 } })
    expect((await read<PrescriptionHistory>(`${path(old.uuid)}/history`)).prescriptions.map(row => row.uuid)).toEqual([old.uuid])
  })

  it('reads legacy incomplete/noncanonical/contact/archived/deleted values verbatim without silently repairing them', async () => {
    for (const [index, type, status, deleted] of [[0, 'spectacle', 'active', null], [1, 'contact_lens', 'active', null],
      [2, 'other', 'active', null], [3, 'spectacle', 'archived', null], [4, 'spectacle', 'active', '2025-01-01T00:00:00.000Z']] as const) {
      const id = crypto.randomUUID()
      await bindings.DB.prepare(`INSERT INTO prescriptions(id,customer_id,root_id,prescription_type,status,deleted_at,deleted_by_admin_id,
        prescribed_on,right_sphere,left_cylinder,pupillary_distance,notes)
        VALUES (?,?,?,?,?,?,?,NULL,'legacy +1.0','-0.375','legacy unknown','Untouched legacy notes')`)
        .bind(id, customer.uuid, id, type, status, deleted, deleted ? owner.data.id : null).run()
      const result = await read<Prescription>(path(id))
      expect(result).toMatchObject({ uuid: id, prescription_type: type, prescribed_on: null, right_sphere: 'legacy +1.0',
        left_cylinder: '-0.375', distance_pd: 'legacy unknown', notes: 'Untouched legacy notes',
        status: index >= 3 ? 'archived' : 'current', root_uuid: id, revision_number: 1 })
      expect((await read<PrescriptionHistory>(`${path(id)}/history`)).prescriptions).toEqual([result])
      const revision = await revise(id, { prescribed_on: '2026-01-01', right_sphere: '1', left_cylinder: null, distance_pd: null, revision_reason: 'Repair transcription' })
      if (index === 0) {
        expect(await record(revision)).toMatchObject({ revision_number: 2, prescribed_on: '2026-01-01', right_sphere: '+1.00', left_cylinder: null, distance_pd: null })
      } else {
        await failure(revision, 409, index >= 3 ? 'PRESCRIPTION_NOT_CURRENT' : 'PRESCRIPTION_UNSUPPORTED_TYPE')
      }
    }
  })
})

describe('actual SELF prescription validation and mismatch/security boundaries', () => {
  it('rejects malformed and private fields with no prescription/audit writes', async () => {
    const invalid: unknown[] = [null, [], true, 1, 'text', {}, { prescribed_on: null }, { prescribed_on: '2023-02-29' },
      { prescribed_on: '2026-01-02', expires_on: '2026-01-01' }, { prescribed_on: '2026-01-01', right_sphere: '1.234' },
      { prescribed_on: '2026-01-01', right_axis: 181 }, { prescribed_on: '2026-01-01', distance_pd: 0 },
      { prescribed_on: '2026-01-01', notes: 'Bidi\u202e clinical' },
      ...['id', 'uuid', 'customer_uuid', 'customer_id', 'root_id', 'root_uuid', 'prescription_type', 'status', 'revision_number',
        'supersedes_id', 'supersedes_uuid', 'created_at', 'deleted_at', 'created_by_admin_id'].map(field => ({ prescribed_on: '2026-01-01', [field]: 'injected' })),
    ]
    for (const input of invalid) await failure(await create(input), 400, 'INVALID_INPUT')
    expect(await count('prescriptions')).toBe(0)
    expect(await audits()).toEqual([])
    const root = await record(await create({ prescribed_on: '2026-01-01', expires_on: '2026-12-31' }))
    for (const input of [{ revision_reason: 'Only reason' }, { notes: 'Changed' }, { notes: 'Changed', revision_reason: '' },
      { notes: 'Changed', revision_reason: 'Reason', customer_uuid: crypto.randomUUID() },
      { prescribed_on: '2027-01-01', revision_reason: 'Merged date relation invalid' },
      { expires_on: '2025-12-31', revision_reason: 'Merged date relation invalid' },
      { near_pd: -1, revision_reason: 'Invalid PD' }]) await failure(await revise(root.uuid, input), 400, 'INVALID_INPUT')
    expect(await read<Prescription>(path(root.uuid))).toEqual(root)
    expect(await count('prescriptions')).toBe(1)
    expect(await audits()).toHaveLength(1)
  })

  it.each(['create', 'supersede', 'revise'])('returns a safe actual SELF 500 and rolls the entire transaction back when the %s audit fails', async action => {
    const root = action === 'create' ? null : await record(await create({ prescribed_on: '2026-01-01', right_sphere: '-1.13', notes: 'Private source clinical notes' }))
    const previousRows = (await bindings.DB.prepare('SELECT * FROM prescriptions').all()).results
    const previousAudits = await audits()
    await bindings.DB.prepare(`CREATE TRIGGER test_reject_prescription_http_audit BEFORE INSERT ON audit_logs
      WHEN NEW.entity_type = 'prescription' AND NEW.action = '${action}'
      BEGIN SELECT RAISE(ABORT, 'test prescription audit failure'); END`).run()
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const response = root
        ? await revise(root.uuid, { notes: 'Private replacement clinical notes', prescriber_name: 'Private Prescriber Name', revision_reason: 'Private replacement reason' })
        : await create({ prescribed_on: '2026-01-01', right_sphere: '-123.13', notes: 'Private new clinical notes', prescriber_name: 'Private Prescriber Name' })
      const result = await failure(response, 500, 'INTERNAL_ERROR')
      expect(result.error.message).toBe('The operation could not be completed. Please try again.')
      expect(logger).toHaveBeenCalledTimes(1)
      expect(JSON.parse(logger.mock.calls[0][0] as string)).toEqual({ event: 'request_failed', requestId: result.meta.requestId, category: 'unexpected_error' })
      for (const forbidden of ['Private', '-123.13', 'notes', 'prescriber_name', 'revision_reason', 'INSERT', 'SELECT', 'D1_ERROR', 'stack', 'test prescription audit failure']) {
        expect(JSON.stringify(result)).not.toContain(forbidden)
        expect(JSON.stringify(logger.mock.calls)).not.toContain(forbidden)
      }
      expect((await bindings.DB.prepare('SELECT * FROM prescriptions').all()).results).toEqual(previousRows)
      expect(await audits()).toEqual(previousAudits)
      if (root) expect(await read<Prescription>(path(root.uuid))).toEqual(root)
    } finally {
      logger.mockRestore()
      await bindings.DB.prepare('DROP TRIGGER test_reject_prescription_http_audit').run()
    }
  })

  it('enforces JSON encoding/media/16KiB size on POST and PATCH before writing clinical data', async () => {
    const root = await record(await create())
    for (const [url, method] of [[path(), 'POST'], [path(root.uuid), 'PATCH']] as const) {
      const headers = { ...authenticatedHeaders(owner), Origin: ORIGIN }
      await failure(await request(url, { method, headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' }), 415, 'JSON_REQUIRED')
      await failure(await request(url, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: '{' }), 400, 'INVALID_JSON')
      await failure(await request(url, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}'.padEnd(16385, ' ') }), 413, 'BODY_TOO_LARGE')
    }
    expect(await count('prescriptions')).toBe(1)
    expect(await audits()).toHaveLength(1)
  })

  it('binds both customer+prescription IDs on detail, PATCH and history, preventing cross-customer reassignment or disclosure', async () => {
    const root = await record(await create({ prescribed_on: '2026-01-01', notes: 'Secret clinical source text' }))
    const other = await success<Customer>(await jsonRequest('/api/customers', { name: 'Other', phone: '8123456789' }, { headers: authenticatedHeaders(owner) }), 201)
    for (const suffix of ['', '/history']) {
      const result = await failure(await request(`${path(root.uuid, other.uuid)}${suffix}`, { headers: { Cookie: owner.cookie } }), 404, 'PRESCRIPTION_NOT_FOUND')
      expect(JSON.stringify(result)).not.toContain('Secret clinical source text')
      expect(JSON.stringify(result)).not.toContain(root.uuid)
    }
    await failure(await jsonRequest(path(root.uuid, other.uuid), { notes: 'Must not reassign', revision_reason: 'Wrong customer' },
      { method: 'PATCH', headers: authenticatedHeaders(owner) }), 404, 'PRESCRIPTION_NOT_FOUND')
    expect(await read<PrescriptionList>(path(undefined, other.uuid))).toEqual({ prescriptions: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } })
    const missing = crypto.randomUUID()
    for (const [url, code] of [[path(undefined, missing), 'CUSTOMER_NOT_FOUND'], [path(root.uuid, missing), 'CUSTOMER_NOT_FOUND'],
      [path(missing), 'PRESCRIPTION_NOT_FOUND'], [`${path(missing)}/history`, 'PRESCRIPTION_NOT_FOUND']] as const) {
      await failure(await request(url, { headers: { Cookie: owner.cookie } }), 404, code)
    }
    for (const url of [path(undefined, 'invalid'), path('invalid'), `${path('invalid')}/history`, path(root.uuid, 'invalid')]) {
      await failure(await request(url, { headers: { Cookie: owner.cookie } }), 400, 'INVALID_INPUT')
    }
    await failure(await request(path(root.uuid), { method: 'DELETE', headers: { ...authenticatedHeaders(owner), Origin: ORIGIN } }), 404, 'NOT_FOUND')
    expect(await read<Prescription>(path(root.uuid))).toEqual(root)
    expect(await audits()).toHaveLength(1)
  })

  it('protects every route with real sessions, exact Origin, fetch-site and session-bound CSRF; revoked/disabled owners cannot read', async () => {
    const root = await record(await create())
    const second = await login()
    for (const [url, method] of [[path(), 'GET'], [path(root.uuid), 'GET'], [`${path(root.uuid)}/history`, 'GET'],
      [path(), 'POST'], [path(root.uuid), 'PATCH']] as const) {
      await failure(await request(url, { method, headers: { Origin: ORIGIN } }), 401, 'AUTH_REQUIRED')
      if (method === 'GET') {
        expect((await request(url, { headers: { Cookie: owner.cookie } })).status).toBe(200)
        continue
      }
      for (const origin of [undefined, 'null', 'https://attacker.test', 'http://optidesk.test', 'https://sub.optidesk.test', 'https://optidesk.test.attacker.test']) {
        const headers = new Headers(authenticatedHeaders(owner))
        if (origin !== undefined) headers.set('Origin', origin)
        await failure(await request(url, { method, headers }), 403, 'CSRF_ORIGIN_INVALID')
      }
      for (const token of [undefined, '', 'wrong-token', second.data.csrfToken]) {
        const headers = new Headers({ Cookie: owner.cookie, Origin: ORIGIN })
        if (token !== undefined) headers.set('X-CSRF-Token', token)
        await failure(await request(url, { method, headers }), 403, 'CSRF_TOKEN_INVALID')
      }
      await failure(await request(url, { method, headers: { ...authenticatedHeaders(owner), Origin: ORIGIN, 'Sec-Fetch-Site': 'cross-site' } }), 403, 'CSRF_ORIGIN_INVALID')
    }
    await jsonRequest('/api/auth/logout', {}, { headers: authenticatedHeaders(owner) })
    await failure(await request(path(root.uuid), { headers: { Cookie: owner.cookie } }), 401, 'AUTH_REQUIRED')
    await bindings.DB.prepare("UPDATE admin_users SET status = 'disabled' WHERE id = ?").bind(owner.data.id).run()
    await failure(await request(`${path(root.uuid)}/history`, { headers: { Cookie: second.cookie } }), 401, 'AUTH_REQUIRED')
    expect(await count('prescriptions')).toBe(1)
    expect(await audits()).toHaveLength(1)
  })

  it.each(['page=0', 'page=-1', 'page=01', 'page=1.5', 'page=1e2', 'page=10001', 'pageSize=0', 'pageSize=51',
    'page=1&page=2', '%70age=1&page=2', 'unknown=1', 'status=current', 'sort=prescribed_on', '__proto__=x', 'page=%GG', 'page=%FF'])('rejects unsafe list/history query %s', async query => {
    const root = await record(await create())
    for (const url of [path(), `${path(root.uuid)}/history`]) await failure(await request(`${url}?${query}`, { headers: { Cookie: owner.cookie } }), 400, 'INVALID_INPUT')
    expect(await audits()).toHaveLength(1)
  })

  it('blocks new/replacement writes for archived customers while preserving readable originals/history and permitting restore', async () => {
    const root = await record(await create())
    await success(await request(`/api/customers/${customer.uuid}`, { method: 'DELETE', headers: { ...authenticatedHeaders(owner), Origin: ORIGIN } }))
    await failure(await create(), 409, 'CUSTOMER_ARCHIVED')
    await failure(await revise(root.uuid, { notes: 'Archived write', revision_reason: 'Blocked' }), 409, 'CUSTOMER_ARCHIVED')
    expect(await read<Prescription>(path(root.uuid))).toEqual(root)
    expect((await read<PrescriptionHistory>(`${path(root.uuid)}/history`)).prescriptions).toEqual([root])
    expect(await count('prescriptions')).toBe(1)
    expect(await audits()).toHaveLength(1)
    await success(await request(`/api/customers/${customer.uuid}/restore`, { method: 'POST', headers: { ...authenticatedHeaders(owner), Origin: ORIGIN } }))
    const replacement = await record(await revise(root.uuid, { notes: 'Restored write', revision_reason: 'Allowed after restore' }))
    expect(replacement.status).toBe('current')
    expect(await audits()).toHaveLength(3)
  })
})
