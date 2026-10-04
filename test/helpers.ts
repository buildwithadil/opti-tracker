/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-plugin/types" />

import { applyD1Migrations, env, reset, SELF, type D1Migration } from 'cloudflare:test'
import { beforeAll, beforeEach, expect } from 'vitest'
import type { Env } from '../worker/types'

export const bindings = env as Env & { TEST_MIGRATIONS: D1Migration[] }
export const ORIGIN = 'https://optidesk.test'
export const SETUP_TOKEN = 'test-setup-token-for-optidesk'
export const SESSION_PEPPER = 'test-session-pepper-for-optidesk-at-least-32-chars'
export const OWNER = {
  name: 'Test Owner',
  email: 'owner@optidesk.test',
  password: 'a genuinely strong owner passphrase',
  setupToken: SETUP_TOKEN,
}

export interface SessionData {
  authenticated: true
  id: string
  name: string
  email: string
  csrfToken: string
  shopName: string
}

export type Envelope<T> = {
  success: true
  data: T
  message?: string
  meta?: { requestId: string }
} | {
  success: false
  error: { code: string; message: string; details?: { field: string; message: string }[] }
  message: string
  meta: { requestId: string }
}

export interface AuthSession {
  data: SessionData
  cookie: string
  token: string
  response: Response
}

/** Migrate once per file. Keep trigger definitions from the migrations rather
 * than silently installing replacement constraints in the test fixture. */
export function installDatabaseHooks(): void {
  beforeAll(async () => {
    await reset()
    await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS)
  })
  beforeEach(async () => {
    const { results: triggers } = await bindings.DB.prepare(`SELECT name, sql FROM sqlite_master
      WHERE type = 'trigger' AND name IN ('audit_logs_immutable_delete', 'purchases_no_hard_delete')`)
      .all<{ name: string; sql: string }>()
    for (const trigger of triggers) {
      await bindings.DB.prepare(`DROP TRIGGER "${trigger.name}"`).run()
    }
    try {
      // Child-first deletion keeps foreign-key enforcement enabled throughout.
      for (const table of [
        'audit_logs', 'payment_reversals', 'payments', 'purchase_items', 'purchases',
        'prescriptions', 'tax_profiles', 'customers', 'sessions', 'login_attempts',
        'settings', 'shop_settings', 'auth_rate_limits', 'admin_users', 'application_metadata',
      ]) {
        await bindings.DB.prepare(`DELETE FROM ${table}`).run()
      }
    } finally {
      for (const trigger of triggers) await bindings.DB.prepare(trigger.sql).run()
    }
  })
}

/** All API calls use the actual Worker service binding, never a mocked router. */
export function request(path: string, options: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, options)
}

export function jsonRequest(path: string, data: unknown, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers({ Origin: ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.10' })
  new Headers(options.headers).forEach((value, name) => headers.set(name, value))
  return request(path, { ...options, method: options.method ?? 'POST', headers, body: JSON.stringify(data) })
}

export async function success<T>(response: Response, status = 200): Promise<T> {
  const result = await response.json() as Envelope<T>
  expect(response.status, JSON.stringify(result)).toBe(status)
  expect(result.success, JSON.stringify(result)).toBe(true)
  if (!result.success) throw new Error(`Unexpected API failure: ${result.error.code}`)
  return result.data
}

export async function failure(response: Response, status: number, code: string) {
  const result = await response.json() as Envelope<never>
  expect(response.status, JSON.stringify(result)).toBe(status)
  expect(result.success).toBe(false)
  if (result.success) throw new Error('Expected an API error response')
  expect(result.error.code).toBe(code)
  expect(result.message).toBe(result.error.message)
  expect(result.meta.requestId).toBe(response.headers.get('X-Request-Id'))
  expect(result.meta.requestId).toMatch(/^[0-9a-f-]{36}$/u)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('Content-Type')).toContain('application/json')
  return result
}

export async function authSession(response: Response, status = 200): Promise<AuthSession> {
  const data = await success<SessionData>(response.clone(), status)
  const setCookie = response.headers.get('Set-Cookie')
  expect(setCookie).toBeTruthy()
  const cookie = setCookie!.split(';')[0]
  expect(cookie).toMatch(/^__Host-optidesk_session=[A-Za-z0-9_-]{43}$/u)
  return { data, cookie, token: cookie.slice(cookie.indexOf('=') + 1), response }
}

export async function setup(overrides: Partial<typeof OWNER> = {}): Promise<AuthSession> {
  return authSession(await jsonRequest('/api/auth/setup', { ...OWNER, ...overrides }), 201)
}

export async function login(overrides: Partial<Pick<typeof OWNER, 'email' | 'password'>> = {}): Promise<AuthSession> {
  return authSession(await jsonRequest('/api/auth/login', { email: OWNER.email, password: OWNER.password, ...overrides }))
}

export function authenticatedHeaders(session: AuthSession): Record<string, string> {
  return { Cookie: session.cookie, 'X-CSRF-Token': session.data.csrfToken }
}

export async function count(table: string): Promise<number> {
  const row = await bindings.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>()
  return row!.count
}

/** Independent Web Crypto derivation, not the production hashing helper. */
export async function hmac(value: string, pepper = SESSION_PEPPER): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
  return btoa(String.fromCharCode(...digest)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

export async function seedOwner(): Promise<string> {
  const id = 'database-test-owner'
  await bindings.DB.prepare('INSERT INTO admin_users(id,email,display_name,password_hash) VALUES (?,?,?,?)')
    .bind(id, OWNER.email, OWNER.name, 'not-used-for-authentication').run()
  return id
}

export async function seedCustomer(id = 'customer-1', phone = '9876543210'): Promise<string> {
  await bindings.DB.prepare('INSERT INTO customers(id,full_name,phone) VALUES (?,?,?)').bind(id, `Customer ${id}`, phone).run()
  return id
}

export async function seedPurchase(id = 'purchase-1', customerId = 'customer-1', invoiceNumber: string | null = 'INV-0001'): Promise<string> {
  await bindings.DB.prepare(`INSERT INTO purchases(id,customer_id,invoice_number,status,issued_at)
    VALUES (?,?,?,?,?)`).bind(id, customerId, invoiceNumber, invoiceNumber ? 'issued' : 'draft', invoiceNumber ? new Date().toISOString() : null).run()
  return id
}
