import { createApp, type Handler } from 'blazefw'
import { ZodError } from 'zod'
import type { Env } from './types.js'
import { apiFailure, apiSuccess, sendResponse } from './lib/api.js'
import { assertSameOrigin, authenticate, requireAdmin, requireCsrf, type RequestWithAuth } from './lib/auth.js'
import { HttpError } from './lib/errors.js'
import { registerAuth, type RouteFunction } from './routes/auth.js'
import { registerCustomers } from './routes/customers.js'
import { registerPrescriptions } from './routes/prescriptions.js'
import { registerPurchases } from './routes/purchases.js'
import { registerPayments } from './routes/payments.js'
import { registerInvoices } from './routes/invoices.js'

const app = createApp<Env>()
const publicPaths = new Set(['/api/health', '/api/auth/session', '/api/auth/setup', '/api/auth/login'])
const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function handleError(error: unknown, req: RequestWithAuth, res: import('blazefw').BlazeResponse): void {
  if (error instanceof HttpError) {
    if (error.status === 429) res.header('Retry-After', '900')
    sendResponse(res, apiFailure(error.code, error.message, { status: error.status, details: error.details, meta: { requestId: req.id } }))
  } else if (error instanceof ZodError) {
    sendResponse(res, apiFailure('INVALID_INPUT', 'Please correct the highlighted fields.', {
      status: 400, details: error.issues.map(({ path, message }) => ({ field: path.join('.'), message })), meta: { requestId: req.id },
    }))
  } else {
    // Neither request URLs/query strings nor database error text may contain PII.
    console.error(JSON.stringify({ event: 'request_failed', requestId: req.id, category: 'unexpected_error' }))
    sendResponse(res, apiFailure('INTERNAL_ERROR', 'The operation could not be completed. Please try again.', { status: 500, meta: { requestId: req.id } }))
  }
}

function route(fn: RouteFunction): Handler<Env> {
  return async (req, res) => {
    try { await fn(req as RequestWithAuth, res) } catch (error) { handleError(error, req as RequestWithAuth, res) }
  }
}

// One centralized API boundary, registered before every route. No business
// module is exposed until its own phase has passed financial/security tests.
const apiBoundary: Handler<Env> = async (request, res, next) => {
  const req = request as RequestWithAuth
  req.id = crypto.randomUUID()
  res.header('X-Request-Id', req.id)
  // Blaze stores header keys case-sensitively; Web Headers forwards lowercase
  // names. Match that casing so forwarding cannot append duplicate directives.
  res.header('cache-control', 'no-store')
  res.header('X-Content-Type-Options', 'nosniff')
  res.header('Referrer-Policy', 'no-referrer')
  res.header('X-Frame-Options', 'DENY')
  res.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
  res.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (new URL(req.raw.url).protocol === 'https:') res.header('Strict-Transport-Security', 'max-age=31536000')
  try {
    if (!req.path.startsWith('/api/')) { next(); return }
    const unsafe = unsafeMethods.has(req.method)
    if (unsafe) assertSameOrigin(req.raw)
    if (req.path !== '/api/health') {
      await authenticate(req)
      if (!publicPaths.has(req.path)) {
        requireAdmin(req)
        if (unsafe) requireCsrf(req)
      }
    }
    next()
  } catch (error) { handleError(error, req, res) }
}
app.use(apiBoundary)

app.get('/api/health', route(async (_req, res) => {
  sendResponse(res, apiSuccess({ service: 'optidesk', status: 'ok' }))
}))
registerAuth(app, route)
registerCustomers(app, route)
registerPrescriptions(app, route)
registerPurchases(app, route)
registerPayments(app, route)
registerInvoices(app, route)
app.onError((error, req, res) => handleError(error, req as RequestWithAuth, res))
app.notFound((req, res) => {
  sendResponse(res, apiFailure('NOT_FOUND', 'The requested resource was not found.', { status: 404, meta: { requestId: req.id } }))
})

export default {
  fetch: app.fetch,
  // Only ephemeral security data is pruned; financial/audit records never are.
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const now = new Date().toISOString()
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
    await env.DB.batch([
      env.DB.prepare('DELETE FROM auth_rate_limits WHERE reset_at < ?').bind(Date.now() - 86400000),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(cutoff),
      env.DB.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').bind(cutoff),
    ])
    console.info(JSON.stringify({ event: 'auth_cleanup_complete', at: now }))
  },
} satisfies ExportedHandler<Env>
