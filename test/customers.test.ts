import { beforeEach, describe, expect, it } from 'vitest'
import type { Customer, CustomerList } from '../shared/customers'
import {
  authenticatedHeaders, bindings, failure, installDatabaseHooks, jsonRequest,
  login, ORIGIN, request, setup, success, type AuthSession,
} from './helpers'
import { acceptedMobileForms, invalidMobileInputs, PUBLIC_CUSTOMER_KEYS } from './customer-fixtures'

installDatabaseHooks()
let owner: AuthSession
beforeEach(async () => { owner = await setup() })

function headers() { return authenticatedHeaders(owner) }
function create(name = 'Test Customer', phone = '9876543210') {
  return jsonRequest('/api/customers', { name, phone }, { headers: headers() })
}
function patch(uuid: string, body: unknown) {
  return jsonRequest(`/api/customers/${uuid}`, body, { method: 'PATCH', headers: headers() })
}
function status(uuid: string, action: 'archive' | 'restore') {
  // Status actions explicitly need neither JSON nor Content-Type.
  return request(`/api/customers/${uuid}${action === 'restore' ? '/restore' : ''}`, { method: action === 'archive' ? 'DELETE' : 'POST', headers: { ...headers(), Origin: ORIGIN } })
}
async function requestResponse(path: string): Promise<Response> {
  return request(path, { headers: { Cookie: owner.cookie } })
}
async function getList(query = ''): Promise<CustomerList> {
  return success<CustomerList>(await requestResponse(`/api/customers${query}`))
}
async function auditCount(): Promise<number> {
  return (await bindings.DB.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE entity_type = 'customer'").first<{ total: number }>())!.total
}
async function assertCustomer(response: Response, statusCode = 200) {
  const envelope = await response.clone().json() as { meta: { requestId: string } }
  const data = await success<Customer>(response, statusCode)
  expect(Object.keys(data).sort()).toEqual(PUBLIC_CUSTOMER_KEYS)
  expect(data.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  expect(data.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  expect(data.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  expect(envelope.meta.requestId).toBe(response.headers.get('X-Request-Id'))
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  return data
}

describe('authenticated customer REST lifecycle and append-only snapshot audits', () => {
  it('creates, reads, partially edits, archives and restores with exact persisted snapshots and admin/request identity', async () => {
    const responses: Response[] = []
    const snapshots: Customer[] = []
    responses.push(await create('  Ａsha　　देवी  ', '0091-98765 43210'))
    snapshots.push(await assertCustomer(responses[0], 201))
    const original = snapshots[0]
    expect(original).toMatchObject({ name: 'Asha देवी', phone: '+91 98765 43210', normalized_phone: '+919876543210', archived_at: null })
    expect(await assertCustomer(await requestResponse(`/api/customers/${original.uuid.toUpperCase()}`))).toEqual(original)
    responses.push(await patch(original.uuid, { name: '  Updated   Customer  ' }))
    snapshots.push(await assertCustomer(responses[1]))
    expect(snapshots[1]).toMatchObject({ name: 'Updated Customer', normalized_phone: original.normalized_phone, created_at: original.created_at, archived_at: null })
    responses.push(await patch(original.uuid, { phone: '0 91234-56780' }))
    snapshots.push(await assertCustomer(responses[2]))
    expect(snapshots[2]).toMatchObject({ name: 'Updated Customer', phone: '+91 91234 56780', normalized_phone: '+919123456780', created_at: original.created_at })
    responses.push(await status(original.uuid, 'archive'))
    snapshots.push(await assertCustomer(responses[3]))
    expect(snapshots[3].archived_at).toBe(snapshots[3].updated_at)
    expect(snapshots[3].archived_at).not.toBeNull()
    expect(await requestResponse(`/api/customers/${original.uuid}`).then(success<Customer>)).toEqual(snapshots[3])
    expect((await getList()).customers).toEqual([])
    expect((await getList('?status=archived')).customers).toEqual([snapshots[3]])
    expect(await assertCustomer(await status(original.uuid, 'archive'))).toEqual(snapshots[3])
    expect(await auditCount()).toBe(4)
    responses.push(await status(original.uuid, 'restore'))
    snapshots.push(await assertCustomer(responses[4]))
    expect(snapshots[4]).toMatchObject({ archived_at: null, created_at: original.created_at, name: 'Updated Customer' })
    expect(await assertCustomer(await status(original.uuid, 'restore'))).toEqual(snapshots[4])
    expect((await getList()).customers).toEqual([snapshots[4]])
    const audit = await bindings.DB.prepare(`SELECT actor_admin_user_id,action,entity_type,entity_id,before_json,after_json,request_id,metadata_json
      FROM audit_logs WHERE entity_type = 'customer' ORDER BY rowid`).all<{
      actor_admin_user_id: string; action: string; entity_type: string; entity_id: string;
      before_json: string | null; after_json: string; request_id: string; metadata_json: string | null;
    }>()
    expect(audit.results).toHaveLength(5)
    audit.results.forEach((entry, index) => {
      expect(entry).toMatchObject({ actor_admin_user_id: owner.data.id, action: ['create', 'update', 'update', 'archive', 'restore'][index], entity_type: 'customer', entity_id: original.uuid, request_id: responses[index].headers.get('X-Request-Id'), metadata_json: null })
      expect(entry.before_json === null ? null : JSON.parse(entry.before_json)).toEqual(index === 0 ? null : snapshots[index - 1])
      expect(JSON.parse(entry.after_json)).toEqual(snapshots[index])
      for (const forbidden of ['password', 'csrf', 'session', 'token', 'ip_address', 'revision']) {
        expect(entry.after_json).not.toContain(forbidden)
        expect(entry.before_json ?? '').not.toContain(forbidden)
      }
    })
    expect(await bindings.DB.prepare('SELECT created_by_admin_id,updated_by_admin_id,deleted_by_admin_id FROM customers').first())
      .toEqual({ created_by_admin_id: owner.data.id, updated_by_admin_id: owner.data.id, deleted_by_admin_id: null })
  })

  it('returns field-specific duplicate conflicts for all equivalent phone formats and never mutates/audits a failed create or edit', async () => {
    const first = await assertCustomer(await create(), 201)
    const other = await assertCustomer(await create('Other', '9123456780'), 201)
    for (const phone of acceptedMobileForms('9876543210')) {
      const result = await failure(await create('Duplicate', phone), 409, 'CUSTOMER_PHONE_CONFLICT')
      expect(result.error.details).toEqual([{ field: 'phone', message: expect.any(String) }])
      await failure(await patch(other.uuid, { name: 'Must not commit', phone }), 409, 'CUSTOMER_PHONE_CONFLICT')
    }
    expect(await assertCustomer(await requestResponse(`/api/customers/${first.uuid}`))).toEqual(first)
    expect(await assertCustomer(await requestResponse(`/api/customers/${other.uuid}`))).toEqual(other)
    expect(await auditCount()).toBe(2)
    expect((await getList('?status=all')).pagination.total).toBe(2)
  })

  it('preserves archived records and history during phone reuse; restore conflict is atomic and can be resolved by editing the archived number', async () => {
    const original = await assertCustomer(await create('Original'), 201)
    await bindings.DB.prepare("INSERT INTO prescriptions(id,customer_id) VALUES ('rx',?)").bind(original.uuid).run()
    await bindings.DB.prepare("INSERT INTO purchases(id,customer_id) VALUES ('sale',?)").bind(original.uuid).run()
    const archived = await assertCustomer(await status(original.uuid, 'archive'))
    const replacement = await assertCustomer(await create('Replacement', '91 98765-43210'), 201)
    const conflict = await failure(await status(original.uuid, 'restore'), 409, 'CUSTOMER_PHONE_CONFLICT')
    expect(conflict.error.details?.[0].field).toBe('phone')
    expect(await assertCustomer(await requestResponse(`/api/customers/${original.uuid}`))).toEqual(archived)
    expect(await auditCount()).toBe(3)
    const edited = await assertCustomer(await patch(original.uuid, { phone: '8123456789' }))
    expect(edited.archived_at).toBe(archived.archived_at)
    const restored = await assertCustomer(await status(original.uuid, 'restore'))
    expect(restored).toMatchObject({ name: original.name, archived_at: null, normalized_phone: '+918123456789', created_at: original.created_at })
    expect((await getList()).customers.map(customer => customer.uuid).sort()).toEqual([original.uuid, replacement.uuid].sort())
    expect(await bindings.DB.prepare('SELECT customer_id FROM prescriptions').first()).toEqual({ customer_id: original.uuid })
    expect(await bindings.DB.prepare('SELECT customer_id FROM purchases').first()).toEqual({ customer_id: original.uuid })
    await expect(bindings.DB.prepare('DELETE FROM customers WHERE uuid = ?').bind(original.uuid).run()).rejects.toThrow(/customers cannot be permanently deleted/u)
    const rearchived = await assertCustomer(await request(`/api/customers/${original.uuid}`, { method: 'DELETE', headers: { ...headers(), Origin: ORIGIN } }))
    expect(rearchived).toMatchObject({ uuid: original.uuid, name: original.name, normalized_phone: '+918123456789' })
    expect(rearchived.archived_at).not.toBeNull()
    expect((await getList('?status=all')).pagination.total).toBe(2)
    expect(await bindings.DB.prepare('SELECT customer_id FROM prescriptions').first()).toEqual({ customer_id: original.uuid })
    expect(await auditCount()).toBe(6)
  })

  it('uses INVALID_INPUT for bad IDs, CUSTOMER_NOT_FOUND for valid absent IDs, without audit writes', async () => {
    const missing = crypto.randomUUID()
    for (const uuid of ['not-a-uuid', missing]) {
      const code = uuid === missing ? 'CUSTOMER_NOT_FOUND' : 'INVALID_INPUT'
      const statusCode = uuid === missing ? 404 : 400
      await failure(await requestResponse(`/api/customers/${uuid}`), statusCode, code)
      await failure(await patch(uuid, { name: 'Valid' }), statusCode, code)
      for (const action of ['archive', 'restore'] as const) await failure(await status(uuid, action), statusCode, code)
    }
    expect(await auditCount()).toBe(0)
  })
})

describe('customer REST validation, security and literal parameter handling', () => {
  it('rejects nonobjects, unknown/private fields, invalid names and malformed phones without writes', async () => {
    const customer = await assertCustomer(await create(), 201)
    const bodies: unknown[] = [null, [], 1, true, 'string', {}, { name: 'Missing phone' }, { phone: '9876543210' },
      { name: '', phone: '9876543210' }, { name: 'X'.repeat(201), phone: '9876543210' },
      { name: 'A\u200bB', phone: '9876543210' }, { name: 'Good', phone: '9123456780', uuid: crypto.randomUUID() },
      { name: 'Good', phone: '9123456780', normalized_phone: '+919123456780' },
      { name: 'Good', phone: '9123456780', archived_at: null }, { name: 'Good', phone: '9123456780', revision: 2 },
      { name: 'Good', phone: '9123456780', created_by_admin_id: owner.data.id },
      ...invalidMobileInputs.map(phone => ({ name: 'Good', phone })),
    ]
    for (const body of bodies) await failure(await jsonRequest('/api/customers', body, { headers: headers() }), 400, 'INVALID_INPUT')
    for (const body of [null, [], {}, { name: null }, { phone: null }, { name: 'A\nB' }, { archived_at: null }, { name: 'Good', unknown: true }, ...invalidMobileInputs.filter(phone => phone !== undefined).map(phone => ({ phone }))]) {
      await failure(await patch(customer.uuid, body), 400, 'INVALID_INPUT')
    }
    expect(await assertCustomer(await requestResponse(`/api/customers/${customer.uuid}`))).toEqual(customer)
    expect(await auditCount()).toBe(1)
  })

  it('retains the real JSON media/encoding/size boundary on creation and edit', async () => {
    const customer = await assertCustomer(await create(), 201)
    for (const [path, method] of [['/api/customers', 'POST'], [`/api/customers/${customer.uuid}`, 'PATCH']] as const) {
      const base = { ...headers(), Origin: ORIGIN }
      await failure(await request(path, { method, headers: { ...base, 'Content-Type': 'text/plain' }, body: '{}' }), 415, 'JSON_REQUIRED')
      await failure(await request(path, { method, headers: { ...base, 'Content-Type': 'application/json' }, body: '{' }), 400, 'INVALID_JSON')
      await failure(await request(path, { method, headers: { ...base, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Valid', phone: '9123456780' }).padEnd(16385, ' ') }), 413, 'BODY_TOO_LARGE')
    }
    expect(await auditCount()).toBe(1)
  })

  it('protects all six routes with administrator sessions and exact Origin/session-bound CSRF for every mutation', async () => {
    const customer = await assertCustomer(await create(), 201)
    const routes = [
      ['/api/customers', 'GET'], [`/api/customers/${customer.uuid}`, 'GET'],
      ['/api/customers', 'POST'], [`/api/customers/${customer.uuid}`, 'PATCH'],
      [`/api/customers/${customer.uuid}`, 'DELETE'], [`/api/customers/${customer.uuid}/restore`, 'POST'],
    ] as const
    const secondSession = await login()
    for (const [path, method] of routes) {
      await failure(await request(path, { method, headers: { Origin: ORIGIN } }), 401, 'AUTH_REQUIRED')
      if (method === 'GET') {
        expect((await requestResponse(path)).status).toBe(200)
        continue
      }
      for (const origin of [undefined, 'null', 'https://attacker.test', 'http://optidesk.test', 'https://sub.optidesk.test', 'https://optidesk.test.attacker.test']) {
        const protectedHeaders = new Headers(headers())
        if (origin !== undefined) protectedHeaders.set('Origin', origin)
        await failure(await request(path, { method, headers: protectedHeaders }), 403, 'CSRF_ORIGIN_INVALID')
      }
      for (const token of [undefined, '', 'wrong-token', secondSession.data.csrfToken]) {
        const protectedHeaders = new Headers({ Cookie: owner.cookie, Origin: ORIGIN })
        if (token !== undefined) protectedHeaders.set('X-CSRF-Token', token)
        await failure(await request(path, { method, headers: protectedHeaders }), 403, 'CSRF_TOKEN_INVALID')
      }
      await failure(await request(path, { method, headers: { ...headers(), Origin: ORIGIN, 'Sec-Fetch-Site': 'cross-site' } }), 403, 'CSRF_ORIGIN_INVALID')
    }
    await bindings.DB.prepare("UPDATE admin_users SET status = 'disabled' WHERE id = ?").bind(owner.data.id).run()
    await failure(await requestResponse('/api/customers'), 401, 'AUTH_REQUIRED')
    expect(await auditCount()).toBe(1)
  })

  it.each([
    'page=0', 'page=-1', 'page=1.5', 'page=01', 'page=1e2', 'page=10001', 'pageSize=0', 'pageSize=51',
    'status=deleted', 'sort=revision', 'sort=name%3BDROP%20TABLE%20customers', 'order=ASC', 'search=%00',
    `search=${'x'.repeat(101)}`, 'search=a&search=b', 'page=1&page=2', '%70age=1&page=2', 'unknown=1',
    '__proto__=evil', 'search=%GG', 'search=%FF',
  ])('returns safe INVALID_INPUT for query %s', async query => {
    await failure(await requestResponse(`/api/customers?${query}`), 400, 'INVALID_INPUT')
    expect(await auditCount()).toBe(0)
  })

  it('searches names literally and case-insensitively, escaping percent, underscore and backslash instead of broadening or injecting SQL', async () => {
    const names = ['Asha MixedCase', '100% real', 'under_score', 'back\\slash', "O'Neil", "x' OR 1=1 --", 'Unrelated']
    const created = await Promise.all(names.map((name, index) => create(name, `987650000${index}`).then(response => assertCustomer(response, 201))))
    for (const [search, expected] of [['mIxEdCaSe', 0], ['%', 1], ['_', 2], ['\\', 3], ["O'Neil", 4], ["x' OR 1=1 --", 5]] as const) {
      const found = await getList(`?${new URLSearchParams({ search })}`)
      expect(found.customers).toEqual([created[expected]])
      expect(found.pagination.total).toBe(1)
    }
    expect((await getList(`?${new URLSearchParams({ search: '%_\\' })}`)).customers).toEqual([])
    expect((await getList()).pagination.total).toBe(names.length)
  })

  it('looks up all equivalent full phone forms and partial phone digits, while arbitrary text is never stripped into a match', async () => {
    const customer = await assertCustomer(await create('Phone lookup'), 201)
    await assertCustomer(await create('Different', '8123456789'), 201)
    for (const search of acceptedMobileForms('9876543210')) {
      expect((await getList(`?${new URLSearchParams({ search })}`)).customers).toEqual([customer])
    }
    for (const search of ['98765', '43210', '765432']) {
      expect((await getList(`?${new URLSearchParams({ search })}`)).customers).toEqual([customer])
    }
    for (const search of ['(98765) 43210', '+1 9876543210', '98765.43210', '98765--43210']) {
      expect((await getList(`?${new URLSearchParams({ search })}`)).customers).toEqual([])
    }
  })
})

describe('customer status, page, sort and stable tie-breakers', () => {
  it('defaults to active/newest, filters archived/all, bounds empty/beyond-end pagination and returns stable pages', async () => {
    const names = ['Zulu', 'alpha', 'Bravo', 'Charlie', 'delta']
    const customers: Customer[] = []
    for (const [index, name] of names.entries()) {
      const customer = await assertCustomer(await create(name, `987650000${index}`), 201)
      await bindings.DB.prepare('UPDATE customers SET created_at = ?,updated_at = ? WHERE uuid = ?')
        .bind(`2025-01-0${index + 1}T00:00:00.000Z`, `2025-02-0${5 - index}T00:00:00.000Z`, customer.uuid).run()
      customers.push(await assertCustomer(await requestResponse(`/api/customers/${customer.uuid}`)))
    }
    customers[2] = await assertCustomer(await status(customers[2].uuid, 'archive'))
    expect((await getList()).customers.map(customer => customer.name)).toEqual(['delta', 'Charlie', 'alpha', 'Zulu'])
    expect((await getList('?status=archived')).customers).toEqual([customers[2]])
    expect((await getList('?status=all')).pagination.total).toBe(5)
    const sorted = ['alpha', 'Bravo', 'Charlie', 'delta', 'Zulu']
    const seen: string[] = []
    for (let page = 1; page <= 3; page++) {
      const result = await getList(`?status=all&sort=name&order=asc&pageSize=2&page=${page}`)
      expect(result.pagination).toEqual({ page, pageSize: 2, total: 5, totalPages: 3 })
      seen.push(...result.customers.map(customer => customer.name))
    }
    expect(seen).toEqual(sorted)
    expect((await getList('?status=all&sort=name&order=desc')).customers.map(customer => customer.name)).toEqual([...sorted].reverse())
    expect((await getList('?status=all&sort=phone&order=asc')).customers.map(customer => customer.normalized_phone)).toEqual(customers.map(customer => customer.normalized_phone))
    expect((await getList('?status=all&sort=phone&order=desc')).customers.map(customer => customer.normalized_phone)).toEqual(customers.map(customer => customer.normalized_phone).reverse())
    expect((await getList('?sort=updated_at&order=asc')).customers.map(customer => customer.name)).toEqual(['delta', 'Charlie', 'alpha', 'Zulu'])
    expect((await getList('?sort=created_at&order=asc')).customers.map(customer => customer.name)).toEqual(['Zulu', 'alpha', 'Charlie', 'delta'])
    expect(await getList('?search=not-found')).toEqual({ customers: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } })
    expect(await getList('?status=all&page=10000&pageSize=50')).toEqual({ customers: [], pagination: { page: 10000, pageSize: 50, total: 5, totalPages: 1 } })
  })

  it('uses uuid ascending as a stable tie-breaker for ascending and descending name/date/phone sorts', async () => {
    const customers: Customer[] = []
    for (let index = 0; index < 4; index++) {
      const customer = await assertCustomer(await create('Same', '9876543210'), 201)
      await status(customer.uuid, 'archive')
      customers.push(customer)
    }
    await bindings.DB.prepare("UPDATE customers SET created_at = '2025-01-01T00:00:00.000Z',updated_at = '2025-01-01T00:00:00.000Z'").run()
    const expected = customers.map(customer => customer.uuid).sort()
    for (const sort of ['name', 'created_at', 'updated_at', 'phone']) for (const order of ['asc', 'desc']) {
      const ids: string[] = []
      for (const page of [1, 2]) ids.push(...(await getList(`?status=all&sort=${sort}&order=${order}&pageSize=2&page=${page}`)).customers.map(customer => customer.uuid))
      expect(ids).toEqual(expected)
    }
  })
})
