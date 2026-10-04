import { describe, expect, it } from 'vitest'
import {
  authenticatedHeaders, bindings, count, failure, hmac, jsonRequest, login,
  OWNER, request, setup, success, installDatabaseHooks, type SessionData,
} from './helpers'

installDatabaseHooks()

describe('owner bootstrap and identity', () => {
  it('reports setup-required only before the single owner exists', async () => {
    expect(await success(await request('/api/auth/session'))).toEqual({ authenticated: false, setupRequired: true })
    await failure(await request('/api/auth/me'), 401, 'AUTH_REQUIRED')
    await failure(await request('/api/shop/identity'), 401, 'AUTH_REQUIRED')
    await failure(await jsonRequest('/api/auth/logout', {}), 401, 'AUTH_REQUIRED')
    expect(await count('admin_users')).toBe(0)
    await setup()
    expect(await success(await request('/api/auth/session'))).toEqual({ authenticated: false, setupRequired: false })
  })

  it('creates a normalized owner, an HTTPS-only session, and a non-sensitive audit event atomically', async () => {
    const owner = await setup({ name: '  Test Owner  ', email: '  OWNER@OPTIDESK.TEST  ' })
    expect(owner.data).toEqual({
      authenticated: true, id: expect.any(String), name: OWNER.name, email: OWNER.email,
      csrfToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u), shopName: '',
    })
    expect(owner.data.id).toMatch(/^[0-9a-f-]{36}$/u)
    const cookie = owner.response.headers.get('Set-Cookie')!
    expect(cookie).toMatch(/;\s*HttpOnly(?:;|$)/iu)
    expect(cookie).toMatch(/;\s*Secure(?:;|$)/iu)
    expect(cookie).toMatch(/;\s*SameSite=Lax(?:;|$)/iu)
    expect(cookie).toMatch(/;\s*Path=\/(?:;|$)/iu)
    expect(cookie).toMatch(/;\s*Max-Age=43200(?:;|$)/iu)
    expect(cookie).not.toMatch(/Domain=|csrf/iu)

    const admin = await bindings.DB.prepare('SELECT * FROM admin_users').first<Record<string, unknown>>()
    expect(admin).toMatchObject({ id: owner.data.id, email: OWNER.email, display_name: OWNER.name, role: 'owner', status: 'active', singleton_slot: 1 })
    expect(admin!.password_hash).toMatch(/^pbkdf2-sha256\$600000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/u)
    expect(admin!.password_hash).not.toContain(OWNER.password)
    const session = await bindings.DB.prepare('SELECT * FROM sessions').first<Record<string, unknown>>()
    expect(session).toMatchObject({
      admin_user_id: owner.data.id, token_hash: await hmac(owner.token),
      csrf_token_hash: await hmac(owner.data.csrfToken), revoked_at: null,
    })
    expect(owner.data.csrfToken).toBe(await hmac(`csrf:${owner.token}`))
    expect(session!.token_hash).not.toBe(owner.token)
    expect(session!.csrf_token_hash).not.toBe(owner.data.csrfToken)
    const lifetime = Date.parse(session!.expires_at as string) - Date.parse(session!.created_at as string)
    expect(lifetime).toBeGreaterThan(43_190_000)
    expect(lifetime).toBeLessThanOrEqual(43_200_000)
    const shop = await bindings.DB.prepare('SELECT * FROM shop_settings').first()
    expect(shop).toMatchObject({ shop_name: '', invoice_prefix: 'INV', next_invoice_number: 1, currency: 'INR', singleton_slot: 1 })
    const audit = await bindings.DB.prepare('SELECT * FROM audit_logs').first<Record<string, unknown>>()
    expect(audit).toMatchObject({ actor_admin_user_id: owner.data.id, entity_id: owner.data.id, action: 'create', entity_type: 'admin_user', request_id: owner.response.headers.get('X-Request-Id') })
    expect(JSON.parse(audit!.after_json as string)).toEqual({ email: OWNER.email, name: OWNER.name })
    for (const secret of [OWNER.password, OWNER.setupToken, owner.token, owner.data.csrfToken]) {
      expect(JSON.stringify({ session, audit })).not.toContain(secret)
    }
    for (const secret of [OWNER.password, OWNER.setupToken, owner.token]) {
      expect(JSON.stringify(owner.data)).not.toContain(secret)
    }
    expect(await count('admin_users')).toBe(1)
    expect(await count('sessions')).toBe(1)
    expect(await count('shop_settings')).toBe(1)
    expect(await count('audit_logs')).toBe(1)
  })

  it.each([12, 256])('accepts a %i-character bootstrap password without truncation', async (length) => {
    const password = 'x'.repeat(length)
    const owner = await setup({ password })
    expect(owner.data.authenticated).toBe(true)
    expect((await login({ password })).data.id).toBe(owner.data.id)
    await failure(await jsonRequest('/api/auth/login', { email: OWNER.email, password: password.slice(1) }), 401, 'LOGIN_FAILED')
  })

  it('restores the same in-memory CSRF value on session discovery without setting a readable CSRF cookie', async () => {
    const owner = await setup()
    const response = await request('/api/auth/session', { headers: { Cookie: owner.cookie } })
    expect(await success<SessionData>(response)).toEqual(owner.data)
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(await success<SessionData>(await request('/api/auth/me', { headers: { Cookie: owner.cookie } }))).toEqual(owner.data)
    await bindings.DB.prepare('UPDATE shop_settings SET shop_name = ?').bind('Test Optical Shop').run()
    expect(await success(await request('/api/shop/identity', { headers: { Cookie: owner.cookie } })))
      .toEqual({ shopName: 'Test Optical Shop', administratorEmail: OWNER.email })
    expect((await success<SessionData>(await request('/api/auth/session', { headers: { Cookie: owner.cookie } }))).shopName).toBe('Test Optical Shop')
  })

  it('rejects an incorrect setup token without partially creating any bootstrap records', async () => {
    await failure(await jsonRequest('/api/auth/setup', { ...OWNER, setupToken: 'incorrect-token-that-is-long-enough' }), 403, 'SETUP_TOKEN_INVALID')
    for (const table of ['admin_users', 'shop_settings', 'sessions', 'audit_logs']) expect(await count(table)).toBe(0)
    expect(await success(await request('/api/auth/session'))).toEqual({ authenticated: false, setupRequired: true })
  })

  it('never replaces an existing owner, even when that owner is disabled and archived', async () => {
    const owner = await setup()
    const before = await bindings.DB.prepare('SELECT password_hash FROM admin_users').first()
    await bindings.DB.prepare("UPDATE admin_users SET status = 'disabled', deleted_at = ? WHERE id = ?").bind(new Date().toISOString(), owner.data.id).run()
    await failure(await jsonRequest('/api/auth/setup', { ...OWNER, name: 'Replacement', email: 'replacement@optidesk.test' }), 409, 'SETUP_ALREADY_COMPLETE')
    expect(await count('admin_users')).toBe(1)
    expect(await count('shop_settings')).toBe(1)
    expect(await count('sessions')).toBe(1)
    expect(await count('audit_logs')).toBe(1)
    expect(await bindings.DB.prepare('SELECT password_hash FROM admin_users').first()).toEqual(before)
    expect(await success(await request('/api/auth/session'))).toEqual({ authenticated: false, setupRequired: false })
  })

  it('allows exactly one successful concurrent bootstrap, rolling back the losing batch', async () => {
    const responses = await Promise.all([
      jsonRequest('/api/auth/setup', OWNER),
      jsonRequest('/api/auth/setup', { ...OWNER, name: 'Other Owner', email: 'other@optidesk.test' }),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    const winner = await success<SessionData>(responses.find((response) => response.status === 201)!, 201)
    await failure(responses.find((response) => response.status === 409)!, 409, 'SETUP_ALREADY_COMPLETE')
    expect(await bindings.DB.prepare('SELECT id,email FROM admin_users').first()).toEqual({ id: winner.id, email: winner.email })
    for (const table of ['admin_users', 'shop_settings', 'sessions', 'audit_logs']) expect(await count(table)).toBe(1)
  })
})

describe('login and session lifecycle', () => {
  it('uses the same safe error for unknown email and wrong password, with no new sessions', async () => {
    const owner = await setup()
    const wrong = await failure(await jsonRequest('/api/auth/login', { email: OWNER.email, password: 'wrong but sufficiently long' }), 401, 'LOGIN_FAILED')
    const unknown = await failure(await jsonRequest('/api/auth/login', { email: 'unknown@optidesk.test', password: 'wrong but sufficiently long' }), 401, 'LOGIN_FAILED')
    expect(wrong.error).toEqual(unknown.error)
    expect(wrong.error.message).toBe('Email or password is incorrect.')
    expect(await count('sessions')).toBe(1)
    const signedIn = await login({ email: '  OWNER@OPTIDESK.TEST  ' })
    expect(signedIn.data.id).toBe(owner.data.id)
    expect(signedIn.token).not.toBe(owner.token)
    expect(signedIn.data.csrfToken).not.toBe(owner.data.csrfToken)
    expect(await count('sessions')).toBe(2)
    expect((await bindings.DB.prepare('SELECT last_login_at FROM admin_users').first<{ last_login_at: string }>())!.last_login_at).toBeTruthy()
  })

  it.each(['__Host-optidesk_session=invalid', '__Host-optidesk_session=%E0%A4%A', `__Host-optidesk_session=${'a'.repeat(43)}`])('treats malformed or unknown credentials as unauthenticated: %s', async (cookie) => {
    await setup()
    expect(await success(await request('/api/auth/session', { headers: { Cookie: cookie } }))).toEqual({ authenticated: false, setupRequired: false })
    await failure(await request('/api/auth/me', { headers: { Cookie: cookie } }), 401, 'AUTH_REQUIRED')
  })

  it('does not accept the insecure development cookie name on HTTPS', async () => {
    const owner = await setup()
    await failure(await request('/api/auth/me', { headers: { Cookie: `optidesk_session=${owner.token}` } }), 401, 'AUTH_REQUIRED')
    expect(await success<SessionData>(await request('/api/auth/me', { headers: { Cookie: `unrelated=1; ${owner.cookie}; another=2` } }))).toEqual(owner.data)
  })

  it.each(['expired', 'revoked', 'disabled-owner', 'archived-owner'])('rejects a %s session', async (state) => {
    const owner = await setup()
    const past = new Date(Date.now() - 1000).toISOString()
    if (state === 'expired') await bindings.DB.prepare('UPDATE sessions SET expires_at = ?').bind(past).run()
    if (state === 'revoked') await bindings.DB.prepare('UPDATE sessions SET revoked_at = ?').bind(past).run()
    if (state === 'disabled-owner') await bindings.DB.prepare("UPDATE admin_users SET status = 'disabled'").run()
    if (state === 'archived-owner') await bindings.DB.prepare("UPDATE admin_users SET status = 'disabled', deleted_at = ?").bind(past).run()
    await failure(await request('/api/auth/me', { headers: { Cookie: owner.cookie } }), 401, 'AUTH_REQUIRED')
    expect(await success(await request('/api/auth/session', { headers: { Cookie: owner.cookie } }))).toEqual({ authenticated: false, setupRequired: false })
    if (state.endsWith('owner')) await failure(await jsonRequest('/api/auth/login', { email: OWNER.email, password: OWNER.password }), 401, 'LOGIN_FAILED')
  })

  it('requires session-bound CSRF and revokes only the current session on logout', async () => {
    const owner = await setup()
    const other = await login()
    for (const csrfToken of [undefined, 'invalid', other.data.csrfToken]) {
      const headers: Record<string, string> = { Cookie: owner.cookie }
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken
      await failure(await jsonRequest('/api/auth/logout', {}, { headers }), 403, 'CSRF_TOKEN_INVALID')
    }
    expect(await bindings.DB.prepare('SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NOT NULL').first()).toEqual({ count: 0 })
    const response = await jsonRequest('/api/auth/logout', {}, { headers: authenticatedHeaders(owner) })
    expect(await success(response)).toBeNull()
    expect(response.headers.get('Set-Cookie')).toMatch(/^__Host-optidesk_session=;/u)
    expect(response.headers.get('Set-Cookie')).toMatch(/Max-Age=0/iu)
    expect(response.headers.get('Set-Cookie')).toMatch(/HttpOnly/iu)
    expect(response.headers.get('Set-Cookie')).toMatch(/Secure/iu)
    await failure(await request('/api/auth/me', { headers: { Cookie: owner.cookie } }), 401, 'AUTH_REQUIRED')
    await failure(await jsonRequest('/api/auth/logout', {}, { headers: authenticatedHeaders(owner) }), 401, 'AUTH_REQUIRED')
    expect((await success<SessionData>(await request('/api/auth/me', { headers: { Cookie: other.cookie } }))).id).toBe(owner.data.id)
    expect(await bindings.DB.prepare('SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NOT NULL').first()).toEqual({ count: 1 })
  })
})

describe('password change', () => {
  it('verifies current password and refuses an unchanged password without revocation', async () => {
    const owner = await setup()
    const before = await bindings.DB.prepare('SELECT password_hash FROM admin_users').first()
    await failure(await jsonRequest('/api/auth/change-password', { currentPassword: OWNER.password, newPassword: 'a new and different passphrase' }, { headers: { Cookie: owner.cookie } }), 403, 'CSRF_TOKEN_INVALID')
    await failure(await jsonRequest('/api/auth/change-password', { currentPassword: 'incorrect current password', newPassword: 'a new and different passphrase' }, { headers: authenticatedHeaders(owner) }), 400, 'PASSWORD_INVALID')
    await failure(await jsonRequest('/api/auth/change-password', { currentPassword: OWNER.password, newPassword: OWNER.password }, { headers: authenticatedHeaders(owner) }), 400, 'PASSWORD_UNCHANGED')
    expect(await bindings.DB.prepare('SELECT password_hash FROM admin_users').first()).toEqual(before)
    expect(await bindings.DB.prepare('SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NOT NULL').first()).toEqual({ count: 0 })
    expect(await count('audit_logs')).toBe(1)
    expect((await success<SessionData>(await request('/api/auth/me', { headers: { Cookie: owner.cookie } }))).id).toBe(owner.data.id)
  })

  it('re-hashes the new password, revokes every active session, and appends a secret-free audit event', async () => {
    const owner = await setup()
    const other = await login()
    const before = await bindings.DB.prepare('SELECT password_hash FROM admin_users').first<{ password_hash: string }>()
    const newPassword = 'a new and different owner passphrase'
    const response = await jsonRequest('/api/auth/change-password', { currentPassword: OWNER.password, newPassword }, { headers: authenticatedHeaders(owner) })
    expect(await success(response)).toBeNull()
    expect(response.headers.get('Set-Cookie')).toMatch(/Max-Age=0/iu)
    const after = await bindings.DB.prepare('SELECT password_hash FROM admin_users').first<{ password_hash: string }>()
    expect(after!.password_hash).not.toBe(before!.password_hash)
    expect(after!.password_hash).toMatch(/^pbkdf2-sha256\$600000\$/u)
    expect(after!.password_hash).not.toContain(newPassword)
    expect(await bindings.DB.prepare('SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NOT NULL').first()).toEqual({ count: 2 })
    for (const session of [owner, other]) await failure(await request('/api/auth/me', { headers: { Cookie: session.cookie } }), 401, 'AUTH_REQUIRED')
    expect(await success(await request('/api/auth/session', { headers: { Cookie: owner.cookie } }))).toEqual({ authenticated: false, setupRequired: false })
    const audit = await bindings.DB.prepare("SELECT * FROM audit_logs WHERE action = 'change_password'").first<Record<string, unknown>>()
    expect(audit).toMatchObject({ actor_admin_user_id: owner.data.id, entity_id: owner.data.id, entity_type: 'admin_user' })
    expect(JSON.parse(audit!.after_json as string)).toEqual({ changed: true })
    for (const secret of [OWNER.password, newPassword, owner.token, other.token, before!.password_hash, after!.password_hash]) expect(JSON.stringify(audit)).not.toContain(secret)
    await failure(await jsonRequest('/api/auth/login', { email: OWNER.email, password: OWNER.password }), 401, 'LOGIN_FAILED')
    const signedIn = await login({ password: newPassword })
    expect(signedIn.data.id).toBe(owner.data.id)
    expect(signedIn.token).not.toBe(owner.token)
    expect(await bindings.DB.prepare('SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NULL').first()).toEqual({ count: 1 })
  })

  it.each([11, 257])('rejects a %i-character new password and retains all sessions', async (length) => {
    const owner = await setup()
    const result = await failure(await jsonRequest('/api/auth/change-password', { currentPassword: OWNER.password, newPassword: 'x'.repeat(length) }, { headers: authenticatedHeaders(owner) }), 400, 'INVALID_INPUT')
    expect(result.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'newPassword' })]))
    expect(await bindings.DB.prepare('SELECT revoked_at FROM sessions').first()).toEqual({ revoked_at: null })
    expect(await count('audit_logs')).toBe(1)
  })
})
