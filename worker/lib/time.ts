/** Return an RFC 3339 UTC timestamp with millisecond precision. */
export function utcNow(): string {
  return new Date().toISOString()
}

export function newId(): string {
  return crypto.randomUUID()
}

export { isUtcIsoTimestamp } from '../../shared/time.js'
