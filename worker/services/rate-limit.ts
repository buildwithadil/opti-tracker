import type { RequestWithAuth } from '../lib/auth.js'
import { hashToken } from '../lib/crypto.js'
import { HttpError } from '../lib/errors.js'

const WINDOW_MS = 15 * 60 * 1000
const SQL = `INSERT INTO auth_rate_limits(bucket_key,request_count,reset_at,updated_at)
 VALUES (?,1,?,?) ON CONFLICT(bucket_key) DO UPDATE SET
 request_count = CASE WHEN reset_at <= ? THEN 1 ELSE request_count + 1 END,
 reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END,
 updated_at = excluded.updated_at RETURNING request_count, reset_at`

/** Atomic D1 reservations, not a racy read-then-write limit. Raw addresses and
 * email identifiers never enter rate-limit storage or application logs. */
export async function throttle(req: RequestWithAuth, operation: string, email?: string): Promise<void> {
  const now = Date.now()
  const ip = req.raw.headers.get('CF-Connecting-IP') ?? 'unavailable'
  const scopes: [string, number][] = [[`${operation}:ip:${ip}`, 20]]
  if (email) scopes.push([`${operation}:email:${email.toLowerCase()}`, 5])
  const statements = await Promise.all(scopes.map(async ([scope]) => req.env.DB.prepare(SQL)
    .bind(await hashToken(scope, req.env.SESSION_PEPPER), now + WINDOW_MS, new Date(now).toISOString(), now, now)))
  const results = await req.env.DB.batch<{ request_count: number; reset_at: number }>(statements)
  for (let i = 0; i < scopes.length; i++) {
    const value = results[i].results[0]
    if (value.request_count > scopes[i][1]) {
      throw new HttpError(429, 'AUTH_RATE_LIMITED', 'Too many attempts. Wait 15 minutes before trying again.')
    }
  }
}
