import type { BlazeRequest, BlazeResponse } from 'blazefw'
import type { Env } from '../types.js'
import { constantTimeEqual, generateOpaqueToken, hashToken } from './crypto.js'
import { HttpError } from './errors.js'

export const SESSION_COOKIE = 'optidesk_session'
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60
const encoder = new TextEncoder()

export interface AuthenticatedAdmin {
  id: string
  email: string
  displayName: string
}

export interface RequestWithAuth extends BlazeRequest<Env> {
  admin?: AuthenticatedAdmin
  sessionId?: string
  csrfToken?: string
}

export function sessionCookieName(url: string): string {
  return new URL(url).protocol === 'https:' ? '__Host-optidesk_session' : SESSION_COOKIE
}

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index < 0 || part.slice(0, index).trim() !== name) continue
    try { return decodeURIComponent(part.slice(index + 1).trim()) } catch { return null }
  }
  return null
}

/** Mutations require an explicit same-origin browser request, including login. */
export function assertSameOrigin(request: Request): void {
  if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new HttpError(403, 'CSRF_ORIGIN_INVALID', 'The request origin is not allowed.')
  }
}

export function assertSecrets(env: Env): void {
  if (!env.SESSION_PEPPER || env.SESSION_PEPPER.length < 32) {
    throw new HttpError(503, 'CONFIGURATION_REQUIRED', 'Authentication is not configured. Contact the application maintainer.')
  }
}

/** A deterministic, secret-derived CSRF value can be retrieved after refresh
 * without storing a readable token in D1, localStorage or a second cookie. */
export async function csrfForSession(token: string, pepper: string): Promise<string> {
  return hashToken(`csrf:${token}`, pepper)
}

export async function authenticate(req: RequestWithAuth): Promise<AuthenticatedAdmin | null> {
  assertSecrets(req.env)
  const token = readCookie(req.raw, sessionCookieName(req.raw.url))
  if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return null
  const row = await req.env.DB.prepare(`
    SELECT s.id AS session_id, a.id, a.email, a.display_name
    FROM sessions s JOIN admin_users a ON a.id = s.admin_user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND s.revoked_at IS NULL
      AND a.status = 'active' AND a.deleted_at IS NULL LIMIT 1
  `).bind(await hashToken(token, req.env.SESSION_PEPPER), new Date().toISOString())
    .first<{ session_id: string; id: string; email: string; display_name: string }>()
  if (!row) return null
  req.admin = { id: row.id, email: row.email, displayName: row.display_name }
  req.sessionId = row.session_id
  req.csrfToken = await csrfForSession(token, req.env.SESSION_PEPPER)
  return req.admin
}

export function requireAdmin(req: RequestWithAuth): AuthenticatedAdmin {
  if (!req.admin) throw new HttpError(401, 'AUTH_REQUIRED', 'Please sign in to continue.')
  return req.admin
}

export function requireCsrf(req: RequestWithAuth): void {
  const supplied = req.raw.headers.get('X-CSRF-Token') ?? ''
  const expected = req.csrfToken ?? ''
  if (!supplied || !expected || !constantTimeEqual(encoder.encode(supplied), encoder.encode(expected))) {
    throw new HttpError(403, 'CSRF_TOKEN_INVALID', 'A valid session security token is required.')
  }
}

export async function prepareSession(req: Pick<RequestWithAuth, 'env'>, adminId: string, expectedPasswordHash?: string) {
  const sessionToken = generateOpaqueToken()
  const csrfToken = await csrfForSession(sessionToken, req.env.SESSION_PEPPER)
  const parameters = [crypto.randomUUID(), adminId, await hashToken(sessionToken, req.env.SESSION_PEPPER),
    await hashToken(csrfToken, req.env.SESSION_PEPPER), new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString()]
  const statement = expectedPasswordHash
    ? req.env.DB.prepare(`INSERT INTO sessions (id,admin_user_id,token_hash,csrf_token_hash,expires_at)
        SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM admin_users
          WHERE id = ? AND password_hash = ? AND status = 'active' AND deleted_at IS NULL)`)
        .bind(...parameters, adminId, expectedPasswordHash)
    : req.env.DB.prepare('INSERT INTO sessions (id,admin_user_id,token_hash,csrf_token_hash,expires_at) VALUES (?,?,?,?,?)').bind(...parameters)
  return { sessionToken, csrfToken, statement }
}

export function setSessionCookie(res: BlazeResponse, token: string, url: string): void {
  res.cookie(sessionCookieName(url), token, {
    httpOnly: true, secure: new URL(url).protocol === 'https:', sameSite: 'Lax', path: '/', maxAge: SESSION_MAX_AGE_SECONDS,
  })
}

export function clearSessionCookie(res: BlazeResponse, url: string): void {
  res.cookie(sessionCookieName(url), '', {
    httpOnly: true, secure: new URL(url).protocol === 'https:', sameSite: 'Lax', path: '/', maxAge: 0,
  })
}
