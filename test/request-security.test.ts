import { describe, expect, it, vi } from 'vitest'
import {
  authenticatedHeaders, bindings, count, failure, jsonRequest, ORIGIN, OWNER,
  request, setup, success, installDatabaseHooks,
} from './helpers'

installDatabaseHooks()

const credentials = { email: OWNER.email, password: OWNER.password }

function rawPost(path: string, body: BodyInit | null, headers: HeadersInit = {}): Promise<Response> {
  return request(path, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers }, body })
}

describe('same-origin request boundary', () => {
  it.each([
    ['missing', undefined], ['null', 'null'], ['foreign', 'https://attacker.test'],
    ['wrong scheme', 'http://optidesk.test'], ['subdomain', 'https://sub.optidesk.test'],
    ['suffix confusion', 'https://optidesk.test.attacker.test'],
  ])('rejects %s Origin for both public authentication mutations', async (_label, origin) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    if (origin !== undefined) headers.set('Origin', origin)
    for (const [path, body] of [['/api/auth/setup', OWNER], ['/api/auth/login', credentials]] as const) {
      await failure(await request(path, { method: 'POST', headers, body: JSON.stringify(body) }), 403, 'CSRF_ORIGIN_INVALID')
    }
    expect(await count('admin_users')).toBe(0)
    expect(await count('sessions')).toBe(0)
    expect(await count('auth_rate_limits')).toBe(0)
  })

  it('rejects a cross-site Fetch Metadata header even with a matching Origin', async () => {
    await failure(await jsonRequest('/api/auth/setup', OWNER, { headers: { 'Sec-Fetch-Site': 'cross-site' } }), 403, 'CSRF_ORIGIN_INVALID')
    expect(await count('admin_users')).toBe(0)
  })

  it('enforces Origin on protected unsafe methods before allowing a valid CSRF token', async () => {
    const owner = await setup()
    for (const path of ['/api/auth/logout', '/api/auth/change-password']) {
      const headers = { ...authenticatedHeaders(owner), 'Content-Type': 'application/json' }
      await failure(await request(path, { method: 'POST', headers, body: '{}' }), 403, 'CSRF_ORIGIN_INVALID')
      await failure(await jsonRequest(path, {}, { headers: { ...headers, Origin: 'https://attacker.test' } }), 403, 'CSRF_ORIGIN_INVALID')
    }
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      await failure(await request('/api/shop/identity', { method, headers: authenticatedHeaders(owner) }), 403, 'CSRF_ORIGIN_INVALID')
      await failure(await request('/api/shop/identity', { method, headers: { Cookie: owner.cookie, Origin: ORIGIN } }), 403, 'CSRF_TOKEN_INVALID')
    }
    expect(await bindings.DB.prepare('SELECT revoked_at FROM sessions').first()).toEqual({ revoked_at: null })
  })

  it('does not require Origin or CSRF for safe authenticated reads', async () => {
    const owner = await setup()
    const data = await success(await request('/api/auth/me', { headers: { Cookie: owner.cookie } }))
    expect(data).toEqual(owner.data)
  })
})

describe('JSON and body-size validation', () => {
  it.each([undefined, 'text/plain', 'application/x-www-form-urlencoded'])('requires application/json, not %s', async (contentType) => {
    const headers = new Headers({ Origin: ORIGIN })
    if (contentType) headers.set('Content-Type', contentType)
    await failure(await request('/api/auth/login', { method: 'POST', headers, body: JSON.stringify(credentials) }), 415, 'JSON_REQUIRED')
    expect(await count('sessions')).toBe(0)
  })

  it('accepts JSON media type parameters', async () => {
    const response = await jsonRequest('/api/auth/setup', OWNER, { headers: { 'Content-Type': 'application/json; charset=utf-8' } })
    expect((await success<{ authenticated: boolean }>(response, 201)).authenticated).toBe(true)
  })

  it.each(['', '{', '{"email":', '{"email":"owner@optidesk.test"} trailing', 'undefined'])('rejects malformed JSON safely: %j', async (body) => {
    const result = await failure(await rawPost('/api/auth/login', body), 400, 'INVALID_JSON')
    expect(result.error.message).not.toContain('SyntaxError')
    expect(await count('auth_rate_limits')).toBe(0)
    expect(await count('sessions')).toBe(0)
  })

  it('rejects a missing body and malformed UTF-8', async () => {
    await failure(await rawPost('/api/auth/login', null), 400, 'INVALID_JSON')
    await failure(await rawPost('/api/auth/login', new Uint8Array([0x7b, 0xff, 0x7d])), 400, 'INVALID_JSON')
  })

  it.each([{ body: null }, { body: [] }, { body: 'string' }, { body: 123 }, { body: true }])('rejects a non-object JSON payload: $body', async ({ body }) => {
    await failure(await jsonRequest('/api/auth/login', body), 400, 'INVALID_INPUT')
    expect(await count('auth_rate_limits')).toBe(0)
  })

  it('accepts an exactly 16 KiB JSON body but rejects the next byte', async () => {
    const payload = JSON.stringify(credentials)
    const exact = payload.padEnd(16 * 1024, ' ')
    expect(new TextEncoder().encode(exact).byteLength).toBe(16 * 1024)
    await failure(await rawPost('/api/auth/login', exact), 401, 'LOGIN_FAILED')
    await failure(await rawPost('/api/auth/login', `${exact} `), 413, 'BODY_TOO_LARGE')
    expect(await count('sessions')).toBe(0)
  })

  it('counts UTF-8 bytes rather than JavaScript characters', async () => {
    const body = JSON.stringify({ ...credentials, ignored: '₹'.repeat(6000) })
    expect(body.length).toBeLessThan(16 * 1024)
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(16 * 1024)
    await failure(await rawPost('/api/auth/login', body), 413, 'BODY_TOO_LARGE')
  })

  it('rejects an oversized streamed body with no Content-Length declaration', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(credentials).padEnd(16 * 1024 + 1, ' '))
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 8192))
        controller.enqueue(bytes.slice(8192))
        controller.close()
      },
    })
    await failure(await rawPost('/api/auth/login', stream), 413, 'BODY_TOO_LARGE')
    expect(await count('auth_rate_limits')).toBe(0)
  })

  it('rejects oversized declared Content-Length before authenticating credentials', async () => {
    await failure(await rawPost('/api/auth/login', JSON.stringify(credentials), { 'Content-Length': '16385' }), 413, 'BODY_TOO_LARGE')
    expect(await count('auth_rate_limits')).toBe(0)
  })
})

describe('strict authentication schema', () => {
  it.each([
    ['missing name', { name: undefined }, 'name'],
    ['short name', { name: 'x' }, 'name'],
    ['blank name', { name: '   ' }, 'name'],
    ['long name', { name: 'x'.repeat(201) }, 'name'],
    ['invalid email', { email: 'not-an-email' }, 'email'],
    ['short password', { password: 'x'.repeat(11) }, 'password'],
    ['long password', { password: 'x'.repeat(257) }, 'password'],
    ['missing token', { setupToken: undefined }, 'setupToken'],
    ['short token', { setupToken: 'short' }, 'setupToken'],
    ['long token', { setupToken: 'x'.repeat(257) }, 'setupToken'],
    ['wrong field type', { password: 123456789012 }, 'password'],
  ])('rejects bootstrap input with %s', async (_label, overrides, field) => {
    const result = await failure(await jsonRequest('/api/auth/setup', { ...OWNER, ...overrides }), 400, 'INVALID_INPUT')
    expect(result.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ field })]))
    for (const table of ['admin_users', 'shop_settings', 'sessions', 'audit_logs']) expect(await count(table)).toBe(0)
    expect(JSON.stringify(result)).not.toContain(OWNER.password)
    expect(JSON.stringify(result)).not.toContain(OWNER.setupToken)
  })

  it('does not accept privilege, hash, or identity injection via extra JSON fields', async () => {
    await failure(await jsonRequest('/api/auth/setup', { ...OWNER, role: 'staff', id: 'chosen-owner', password_hash: 'chosen-hash' }), 400, 'INVALID_INPUT')
    await failure(await jsonRequest('/api/auth/login', { ...credentials, csrfToken: 'injected' }), 400, 'INVALID_INPUT')
    expect(await count('admin_users')).toBe(0)
    expect(await count('sessions')).toBe(0)
  })

  it.each([
    { email: 'invalid', password: OWNER.password }, { email: OWNER.email, password: '' },
    { email: OWNER.email, password: 'x'.repeat(257) }, { email: OWNER.email },
  ])('rejects malformed login credentials without reserving rate-limit capacity', async (body) => {
    await failure(await jsonRequest('/api/auth/login', body), 400, 'INVALID_INPUT')
    expect(await count('auth_rate_limits')).toBe(0)
  })
})

describe('safe errors and response headers', () => {
  it('applies restrictive security headers to success and authentication errors', async () => {
    for (const response of [await request('/api/health'), await request('/api/auth/me')]) {
      expect.soft(response.headers.get('Cache-Control')).toBe('no-store')
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
      expect(response.headers.get('X-Frame-Options')).toBe('DENY')
      expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
      expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=31536000')
      expect(response.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()')
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
      expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/u)
    }
  })

  it('returns only a generic unexpected-error message and PII-free structured logging', async () => {
    // Real D1 failure, not a mocked database: restore the table for subsequent fixtures.
    const definition = await bindings.DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'auth_rate_limits'").first<{ sql: string }>()
    await bindings.DB.prepare('DROP TABLE auth_rate_limits').run()
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const response = await jsonRequest('/api/auth/login?email=private-person@example.test', { email: 'private-person@example.test', password: 'private-password-no-log' })
      const result = await failure(response, 500, 'INTERNAL_ERROR')
      expect(result.error.message).toBe('The operation could not be completed. Please try again.')
      expect(logger).toHaveBeenCalledTimes(1)
      const record = JSON.parse(logger.mock.calls[0][0] as string)
      expect(record).toEqual({ event: 'request_failed', requestId: result.meta.requestId, category: 'unexpected_error' })
      for (const value of ['private-person', 'private-password', 'auth_rate_limits', 'SELECT', 'INSERT', 'D1_ERROR', 'stack']) {
        expect(JSON.stringify(result)).not.toContain(value)
        expect(JSON.stringify(logger.mock.calls)).not.toContain(value)
      }
      expect(response.headers.get('Set-Cookie')).toBeNull()
    } finally {
      logger.mockRestore()
      await bindings.DB.prepare(definition!.sql).run()
      await bindings.DB.prepare('CREATE INDEX idx_auth_rate_limits_reset ON auth_rate_limits(reset_at)').run()
    }
  })
})
