import { describe, expect, it } from 'vitest'
import {
  authenticatedHeaders, bindings, count, failure, hmac, installDatabaseHooks, jsonRequest,
  ORIGIN, OWNER, request, setup,
} from './helpers'

installDatabaseHooks()

const invalidPassword = 'not the actual owner password'
const WINDOW_MS = 15 * 60 * 1000

async function attempt(email: string, headers: Record<string, string> = {}): Promise<Response> {
  return jsonRequest('/api/auth/login', { email, password: invalidPassword }, { headers })
}

describe('atomic authentication rate limiting', () => {
  it('allows five attempts per normalized email across IPs, then blocks the sixth for 15 minutes', async () => {
    await setup()
    const before = Date.now()
    for (let index = 0; index < 5; index++) {
      const email = index % 2 ? '  OWNER@OPTIDESK.TEST  ' : OWNER.email
      await failure(await attempt(email, { 'CF-Connecting-IP': `192.0.2.${index + 1}` }), 401, 'LOGIN_FAILED')
    }
    const blocked = await attempt(OWNER.email, { 'CF-Connecting-IP': '192.0.2.99' })
    const result = await failure(blocked, 429, 'AUTH_RATE_LIMITED')
    expect(blocked.headers.get('Retry-After')).toBe('900')
    expect(result.error.message).toBe('Too many attempts. Wait 15 minutes before trying again.')
    const bucket = await bindings.DB.prepare('SELECT request_count,reset_at FROM auth_rate_limits WHERE bucket_key = ?')
      .bind(await hmac(`login:email:${OWNER.email}`)).first<{ request_count: number; reset_at: number }>()
    expect(bucket!.request_count).toBe(6)
    expect(bucket!.reset_at).toBeGreaterThanOrEqual(before + WINDOW_MS)
    expect(bucket!.reset_at).toBeLessThanOrEqual(Date.now() + WINDOW_MS)
    expect(await count('sessions')).toBe(1)
  })

  it('limits a trusted CF-Connecting-IP to 20 attempts across distinct emails despite spoofed proxy headers', async () => {
    for (let index = 0; index < 20; index++) {
      await failure(await attempt(`unknown-${index}@optidesk.test`, {
        'CF-Connecting-IP': '198.51.100.20',
        'X-Forwarded-For': `203.0.113.${index + 1}`,
        'X-Real-IP': `192.0.2.${index + 1}`,
        Forwarded: `for=203.0.113.${index + 1}`,
      }), 401, 'LOGIN_FAILED')
    }
    await failure(await attempt('twenty-first@optidesk.test', {
      'CF-Connecting-IP': '198.51.100.20', 'X-Forwarded-For': '203.0.113.250', 'X-Real-IP': '192.0.2.250',
    }), 429, 'AUTH_RATE_LIMITED')
    await failure(await attempt('separate-client@optidesk.test', { 'CF-Connecting-IP': '198.51.100.21' }), 401, 'LOGIN_FAILED')
    const ipBucket = await bindings.DB.prepare('SELECT request_count FROM auth_rate_limits WHERE bucket_key = ?')
      .bind(await hmac('login:ip:198.51.100.20')).first()
    expect(ipBucket).toEqual({ request_count: 21 })
    expect(await count('sessions')).toBe(0)
  })

  it('cannot bypass the missing-CF-IP fallback by changing X-Forwarded-For', async () => {
    // request() is deliberately not jsonRequest(): do not inject a test CF IP.
    for (let index = 0; index < 21; index++) {
      const response = await request('/api/auth/login', {
        method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${index + 1}` },
        body: JSON.stringify({ email: `no-cf-${index}@optidesk.test`, password: invalidPassword }),
      })
      await failure(response, index < 20 ? 401 : 429, index < 20 ? 'LOGIN_FAILED' : 'AUTH_RATE_LIMITED')
    }
    expect(await bindings.DB.prepare('SELECT request_count FROM auth_rate_limits WHERE bucket_key = ?')
      .bind(await hmac('login:ip:unavailable')).first()).toEqual({ request_count: 21 })
  })

  it('does not store raw IP or email identifiers in rate-limit buckets', async () => {
    const email = 'private-customer@example.test'
    const ip = '198.51.100.42'
    await failure(await attempt(email, { 'CF-Connecting-IP': ip }), 401, 'LOGIN_FAILED')
    const { results } = await bindings.DB.prepare('SELECT * FROM auth_rate_limits').all<{ bucket_key: string; request_count: number }>()
    expect(results).toHaveLength(2)
    for (const bucket of results) {
      expect(bucket.bucket_key).toMatch(/^[A-Za-z0-9_-]{43}$/u)
      expect(bucket.request_count).toBe(1)
    }
    expect(JSON.stringify(results)).not.toContain(email)
    expect(JSON.stringify(results)).not.toContain(ip)
    expect(results.map((row) => row.bucket_key).sort()).toEqual([
      await hmac(`login:ip:${ip}`), await hmac(`login:email:${email}`),
    ].sort())
  })

  it('resets expired reservations atomically and starts a new 15-minute window', async () => {
    const email = 'rate-reset@optidesk.test'
    for (let index = 0; index < 5; index++) await failure(await attempt(email), 401, 'LOGIN_FAILED')
    await failure(await attempt(email), 429, 'AUTH_RATE_LIMITED')
    await bindings.DB.prepare('UPDATE auth_rate_limits SET reset_at = ?').bind(Date.now() - 1).run()
    const before = Date.now()
    await failure(await attempt(email), 401, 'LOGIN_FAILED')
    const { results } = await bindings.DB.prepare('SELECT request_count,reset_at FROM auth_rate_limits').all<{ request_count: number; reset_at: number }>()
    expect(results).toHaveLength(2)
    for (const bucket of results) {
      expect(bucket.request_count).toBe(1)
      expect(bucket.reset_at).toBeGreaterThanOrEqual(before + WINDOW_MS)
      expect(bucket.reset_at).toBeLessThanOrEqual(Date.now() + WINDOW_MS)
    }
  })

  it('does not race past the per-email limit under concurrent requests', async () => {
    const responses = await Promise.all(Array.from({ length: 10 }, (_, index) => attempt('concurrent@optidesk.test', { 'CF-Connecting-IP': `192.0.2.${index + 1}` })))
    expect(responses.filter((response) => response.status === 401)).toHaveLength(5)
    expect(responses.filter((response) => response.status === 429)).toHaveLength(5)
    for (const response of responses) {
      await failure(response, response.status, response.status === 429 ? 'AUTH_RATE_LIMITED' : 'LOGIN_FAILED')
    }
    expect(await bindings.DB.prepare('SELECT request_count FROM auth_rate_limits WHERE bucket_key = ?')
      .bind(await hmac('login:email:concurrent@optidesk.test')).first()).toEqual({ request_count: 10 })
    expect(await count('sessions')).toBe(0)
  })

  it('rate-limits setup attempts before creating any owner and keeps setup/login buckets separate', async () => {
    const headers = { 'CF-Connecting-IP': '198.51.100.40' }
    for (let index = 0; index < 20; index++) {
      await failure(await jsonRequest('/api/auth/setup', { ...OWNER, setupToken: 'incorrect-but-long-enough-token' }, { headers }), 403, 'SETUP_TOKEN_INVALID')
    }
    const response = await jsonRequest('/api/auth/setup', OWNER, { headers })
    await failure(response, 429, 'AUTH_RATE_LIMITED')
    expect(response.headers.get('Retry-After')).toBe('900')
    for (const table of ['admin_users', 'shop_settings', 'sessions', 'audit_logs']) expect(await count(table)).toBe(0)
    await failure(await attempt('separate-operation@optidesk.test', headers), 401, 'LOGIN_FAILED')
    expect(await bindings.DB.prepare('SELECT request_count FROM auth_rate_limits WHERE bucket_key = ?')
      .bind(await hmac('setup:ip:198.51.100.40')).first()).toEqual({ request_count: 21 })
  })

  it('rate-limits current-password guesses without changing the password or revoking sessions', async () => {
    const owner = await setup()
    const before = await bindings.DB.prepare('SELECT password_hash FROM admin_users').first()
    const input = { currentPassword: invalidPassword, newPassword: 'a valid new password passphrase' }
    for (let index = 0; index < 5; index++) {
      await failure(await jsonRequest('/api/auth/change-password', input, { headers: authenticatedHeaders(owner) }), 400, 'PASSWORD_INVALID')
    }
    await failure(await jsonRequest('/api/auth/change-password', input, { headers: authenticatedHeaders(owner) }), 429, 'AUTH_RATE_LIMITED')
    expect(await bindings.DB.prepare('SELECT password_hash FROM admin_users').first()).toEqual(before)
    expect(await bindings.DB.prepare('SELECT revoked_at FROM sessions').first()).toEqual({ revoked_at: null })
    expect(await count('audit_logs')).toBe(1)
  })
})
