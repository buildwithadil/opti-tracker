import type { BlazeApp, BlazeResponse } from 'blazefw'
import type { Env } from '../types.js'
import type { RequestWithAuth } from '../lib/auth.js'
import { assertSecrets, clearSessionCookie, prepareSession, requireAdmin, setSessionCookie } from '../lib/auth.js'
import { constantTimeEqual, hashPassword, hashToken, verifyPassword } from '../lib/crypto.js'
import { HttpError } from '../lib/errors.js'
import { readJson } from '../lib/request.js'
import { changePasswordSchema, loginSchema, setupSchema } from '../validators/auth.js'
import { throttle } from '../services/rate-limit.js'
import { apiSuccess, sendResponse } from '../lib/api.js'
import { settingStatements } from '../lib/settings.js'

export type RouteFunction = (req: RequestWithAuth, res: BlazeResponse) => Promise<void>
export type RegisterRoute = (handler: RouteFunction) => import('blazefw').Handler<Env>
const encoder = new TextEncoder()
// Equivalent-cost derivation for unknown email addresses, never a login credential.
const dummyHash = 'pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

async function ownerExists(db: D1Database): Promise<boolean> {
  return !!await db.prepare('SELECT 1 AS present FROM admin_users LIMIT 1').first()
}

async function sessionData(req: RequestWithAuth) {
  const admin = requireAdmin(req)
  const shop = await req.env.DB.prepare('SELECT shop_name FROM shop_settings WHERE singleton_slot = 1').first<{ shop_name: string }>()
  return { authenticated: true as const, id: admin.id, name: admin.displayName, email: admin.email, csrfToken: req.csrfToken, shopName: shop?.shop_name ?? '' }
}

export function registerAuth(app: BlazeApp<Env>, route: RegisterRoute): void {
  app.get('/api/auth/session', route(async (req, res) => {
    sendResponse(res, apiSuccess(req.admin ? await sessionData(req) : { authenticated: false, setupRequired: !await ownerExists(req.env.DB) }))
  }))
  app.get('/api/auth/me', route(async (req, res) => sendResponse(res, apiSuccess(await sessionData(req)))))
  app.get('/api/shop/identity', route(async (req, res) => {
    const data = await sessionData(req)
    sendResponse(res, apiSuccess({ shopName: data.shopName, administratorEmail: data.email }))
  }))

  app.post('/api/auth/setup', route(async (req, res) => {
    assertSecrets(req.env)
    await throttle(req, 'setup')
    if (await ownerExists(req.env.DB)) throw new HttpError(409, 'SETUP_ALREADY_COMPLETE', 'The owner account already exists.')
    const input = setupSchema.parse(await readJson(req.raw))
    if (!req.env.SETUP_TOKEN || req.env.SETUP_TOKEN.length < 16) throw new HttpError(403, 'SETUP_DISABLED', 'Initial setup is not enabled.')
    const [supplied, expected] = await Promise.all([hashToken(input.setupToken), hashToken(req.env.SETUP_TOKEN)])
    if (!constantTimeEqual(encoder.encode(supplied), encoder.encode(expected))) throw new HttpError(403, 'SETUP_TOKEN_INVALID', 'The setup token is invalid.')
    const adminId = crypto.randomUUID()
    const session = await prepareSession(req, adminId)
    const passwordHash = await hashPassword(input.password)
    try {
      await req.env.DB.batch([
        req.env.DB.prepare(`INSERT INTO admin_users(id,email,display_name,password_hash) VALUES (?,?,?,?)`).bind(adminId, input.email, input.name, passwordHash),
        req.env.DB.prepare('INSERT INTO shop_settings(uuid) VALUES (?)').bind(crypto.randomUUID()),
        ...settingStatements(req.env.DB, adminId),
        req.env.DB.prepare(`INSERT INTO audit_logs(id,actor_admin_user_id,action,entity_type,entity_id,after_json,request_id) VALUES (?,?,'create','admin_user',?,?,?)`)
          .bind(crypto.randomUUID(), adminId, adminId, JSON.stringify({ email: input.email, name: input.name }), req.id),
        session.statement,
      ])
    } catch (error) {
      // A concurrent bootstrap is rejected by the singleton unique constraint.
      if (await ownerExists(req.env.DB)) throw new HttpError(409, 'SETUP_ALREADY_COMPLETE', 'The owner account already exists.')
      throw error
    }
    req.admin = { id: adminId, email: input.email, displayName: input.name }
    req.csrfToken = session.csrfToken
    setSessionCookie(res, session.sessionToken, req.raw.url)
    sendResponse(res, apiSuccess(await sessionData(req), { status: 201, message: 'Owner account created.' }))
  }))

  app.post('/api/auth/login', route(async (req, res) => {
    const input = loginSchema.parse(await readJson(req.raw))
    await throttle(req, 'login', input.email)
    const admin = await req.env.DB.prepare(`SELECT id,email,display_name,password_hash FROM admin_users
      WHERE email = ? COLLATE NOCASE AND status = 'active' AND deleted_at IS NULL LIMIT 1`)
      .bind(input.email).first<{ id: string; email: string; display_name: string; password_hash: string }>()
    const valid = await verifyPassword(input.password, admin?.password_hash ?? dummyHash)
    if (!valid || !admin) throw new HttpError(401, 'LOGIN_FAILED', 'Email or password is incorrect.')
    // Re-check the credential version inside the session insert: an in-flight
    // login verified before a password change must not create a new old session.
    const session = await prepareSession(req, admin.id, admin.password_hash)
    const results = await req.env.DB.batch([
      session.statement,
      req.env.DB.prepare('UPDATE admin_users SET last_login_at = ?, updated_at = ? WHERE id = ? AND password_hash = ?')
        .bind(new Date().toISOString(), new Date().toISOString(), admin.id, admin.password_hash),
    ])
    if (results[0].meta.changes !== 1) throw new HttpError(401, 'LOGIN_FAILED', 'Email or password is incorrect.')
    req.admin = { id: admin.id, email: admin.email, displayName: admin.display_name }
    req.csrfToken = session.csrfToken
    setSessionCookie(res, session.sessionToken, req.raw.url)
    sendResponse(res, apiSuccess(await sessionData(req), { message: 'Signed in.' }))
  }))

  app.post('/api/auth/logout', route(async (req, res) => {
    requireAdmin(req)
    await req.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(new Date().toISOString(), req.sessionId).run()
    clearSessionCookie(res, req.raw.url)
    sendResponse(res, apiSuccess(null, { message: 'Signed out.' }))
  }))

  app.post('/api/auth/change-password', route(async (req, res) => {
    const admin = requireAdmin(req)
    await throttle(req, 'password-change', admin.email)
    const input = changePasswordSchema.parse(await readJson(req.raw))
    const row = await req.env.DB.prepare('SELECT password_hash FROM admin_users WHERE id = ?').bind(admin.id).first<{ password_hash: string }>()
    if (!row || !await verifyPassword(input.currentPassword, row.password_hash)) throw new HttpError(400, 'PASSWORD_INVALID', 'Current password is incorrect.')
    if (input.currentPassword === input.newPassword) throw new HttpError(400, 'PASSWORD_UNCHANGED', 'Choose a different new password.')
    const now = new Date().toISOString()
    const nextHash = await hashPassword(input.newPassword)
    const results = await req.env.DB.batch([
      req.env.DB.prepare('UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE id = ? AND password_hash = ?')
        .bind(nextHash, now, admin.id, row.password_hash),
      req.env.DB.prepare(`UPDATE sessions SET revoked_at = ? WHERE admin_user_id = ? AND revoked_at IS NULL AND expires_at > ?
        AND EXISTS(SELECT 1 FROM admin_users WHERE id = ? AND password_hash = ?)`)
        .bind(now, admin.id, now, admin.id, nextHash),
      req.env.DB.prepare(`INSERT INTO audit_logs(id,actor_admin_user_id,action,entity_type,entity_id,after_json,request_id)
        SELECT ?,?,'change_password','admin_user',?,?,? WHERE EXISTS(SELECT 1 FROM admin_users WHERE id = ? AND password_hash = ?)`)
        .bind(crypto.randomUUID(), admin.id, admin.id, JSON.stringify({ changed: true }), req.id, admin.id, nextHash),
    ])
    if (results[0].meta.changes !== 1) throw new HttpError(409, 'CREDENTIALS_CHANGED', 'The password changed during this request. Sign in again.')
    clearSessionCookie(res, req.raw.url)
    sendResponse(res, apiSuccess(null, { message: 'Password changed. Please sign in again.' }))
  }))
}
