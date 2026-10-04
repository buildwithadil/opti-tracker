import { createExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import worker from '../worker/index'
import { prepareSession } from '../worker/lib/auth'
import {
  authenticatedHeaders, bindings, count, failure, installDatabaseHooks,
  jsonRequest, ORIGIN, OWNER, request, setup, success,
} from './helpers'

installDatabaseHooks()

describe('fail-closed authentication configuration', () => {
  it.each(['', 'too-short'])('rejects an invalid SESSION_PEPPER: %j', async pepper => {
    const response = await worker.fetch(new Request(`${ORIGIN}/api/auth/session`), { ...bindings, SESSION_PEPPER: pepper }, createExecutionContext())
    await failure(response, 503, 'CONFIGURATION_REQUIRED')
    expect(await count('admin_users')).toBe(0)
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })

  it.each([undefined, '', 'short'])('disables setup when no valid SETUP_TOKEN is configured: %j', async setupToken => {
    const response = await worker.fetch(new Request(`${ORIGIN}/api/auth/setup`, {
      method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(OWNER),
    }), { ...bindings, SETUP_TOKEN: setupToken }, createExecutionContext())
    await failure(response, 403, 'SETUP_DISABLED')
    for (const table of ['admin_users', 'shop_settings', 'sessions', 'audit_logs']) expect(await count(table)).toBe(0)
  })
})

describe('credential version and API routing guards', () => {
  it('cannot commit an already-prepared login session after its password version changes', async () => {
    const owner = await setup()
    const row = await bindings.DB.prepare('SELECT password_hash FROM admin_users WHERE id = ?').bind(owner.data.id).first<{ password_hash: string }>()
    const pending = await prepareSession({ env: bindings }, owner.data.id, row!.password_hash)
    await success(await jsonRequest('/api/auth/change-password', {
      currentPassword: OWNER.password, newPassword: 'replacement after pending login request',
    }, { headers: authenticatedHeaders(owner) }))
    const result = await pending.statement.run()
    expect(result.meta.changes).toBe(0)
    expect(await count('sessions')).toBe(1)
    await failure(await request('/api/auth/me', { headers: { Cookie: `__Host-optidesk_session=${pending.sessionToken}` } }), 401, 'AUTH_REQUIRED')
  })

  it('returns safe JSON API misses rather than serving the SPA or exposing future modules', async () => {
    await failure(await request('/api/customers'), 401, 'AUTH_REQUIRED')
    const owner = await setup()
    for (const path of ['/api/customers', '/api/purchases', '/api/reports', '/api/missing']) {
      await failure(await request(path, { headers: { Cookie: owner.cookie } }), 404, 'NOT_FOUND')
    }
    await failure(await request('/api'), 404, 'NOT_FOUND')
  })
})
