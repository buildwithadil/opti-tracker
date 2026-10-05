/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-plugin/types" />

import { applyD1Migrations, env, reset, SELF, type D1Migration } from 'cloudflare:test'
import { beforeAll, beforeEach, expect } from 'vitest'
import type { Env } from '../worker/types'
import { formatIndianMobile, normalizeIndianMobile } from '../shared/phone'

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
      WHERE type = 'trigger' AND name IN ('audit_logs_immutable_delete', 'purchases_no_hard_delete', 'purchases_immutable_update', 'purchases_immutable_delete', 'purchase_items_immutable_update', 'purchase_items_immutable_delete', 'customers_no_hard_delete', 'prescriptions_immutable_delete')`)
      .all<{ name: string; sql: string }>()
    for (const trigger of triggers) {
      await bindings.DB.prepare(`DROP TRIGGER "${trigger.name}"`).run()
    }
    try {
      // Child-first deletion keeps foreign-key enforcement enabled throughout.
      for (const table of ['payment_reversals', 'payments', 'purchase_items', 'purchases', 'audit_logs']) {
        await bindings.DB.prepare(`DELETE FROM ${table}`).run()
      }
      // Only this isolated test binding is cleaned. Remove descendants before
      // their root/parent, then restore the exact original immutable trigger.
      const versions = await bindings.DB.prepare('SELECT id FROM prescriptions ORDER BY revision_number DESC')
        .all<{ id: string }>()
      for (const { id } of versions.results) await bindings.DB.prepare('DELETE FROM prescriptions WHERE id = ?').bind(id).run()
      for (const table of [
        'tax_profiles', 'customers', 'sessions', 'login_attempts', 'settings',
        'shop_settings', 'auth_rate_limits', 'admin_users', 'application_metadata',
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
  const canonical = normalizeIndianMobile(phone)
  await bindings.DB.prepare('INSERT INTO customers(uuid,name,phone,normalized_phone) VALUES (?,?,?,?)')
    .bind(id, `Customer ${id}`, formatIndianMobile(canonical), canonical).run()
  return id
}

export async function seedPurchase(id = 'purchase-1', customerId = 'customer-1', invoiceNumber: string | null = 'INV-0001', options: { prescriptionId?: string; subtotal?: number; discount?: number; tax?: number } = {}): Promise<string> {
  const migrated = await bindings.DB.prepare("SELECT name FROM d1_migrations WHERE name = '0006_purchase_management.sql'").first()
  if (!migrated) {
    await bindings.DB.prepare(`INSERT INTO purchases(id,customer_id,invoice_number,status,issued_at)
      VALUES (?,?,?,?,?)`).bind(id, customerId, invoiceNumber, invoiceNumber ? 'issued' : 'draft', invoiceNumber ? new Date().toISOString() : null).run()
    return id
  }
  const { subtotal = 0, discount = 0, tax = 0 } = options
  await bindings.DB.batch([
    bindings.DB.prepare(`INSERT INTO purchases(id,customer_id,invoice_number,status,issued_at,prescription_id,subtotal_paise,discount_paise,tax_paise,total_paise,taxable_amount_paise,item_count,creation_audit_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)`).bind(id, customerId, invoiceNumber, invoiceNumber ? 'issued' : 'draft', invoiceNumber ? new Date().toISOString() : null, options.prescriptionId ?? null, subtotal, discount, tax, subtotal - discount + tax, subtotal - discount, `${id}-audit`),
    bindings.DB.prepare(`INSERT INTO purchase_items(id,purchase_id,description,quantity,unit_price_paise,discount_paise,tax_paise,line_total_paise,taxable_paise,snapshot_position)
      VALUES (?,?,'Database fixture',1,?,?,?,?,?,0)`).bind(`${id}-item`, id, subtotal, discount, tax, subtotal - discount + tax, subtotal - discount),
    bindings.DB.prepare("INSERT INTO audit_logs(id,action,entity_type,entity_id) VALUES (?,'create','purchase',?)").bind(`${id}-audit`, id),
  ])
  return id
}
