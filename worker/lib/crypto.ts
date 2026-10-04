const textEncoder = new TextEncoder()

export const DEFAULT_PBKDF2_ITERATIONS = 600_000
const DERIVED_KEY_BITS = 256
const MIN_PBKDF2_ITERATIONS = 100_000
const MAX_PBKDF2_ITERATIONS = 2_000_000

export interface PasswordHashOptions {
  iterations?: number
  saltBytes?: number
}

/**
 * Hash a password using Web Crypto PBKDF2-SHA-256.
 *
 * The encoded value is self-describing:
 * pbkdf2-sha256$iterations$salt-base64url$digest-base64url
 */
export async function hashPassword(
  password: string,
  options: PasswordHashOptions = {},
): Promise<string> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('Password must be a non-empty string')
  }

  const iterations = options.iterations ?? DEFAULT_PBKDF2_ITERATIONS
  validateIterations(iterations)
  const saltLength = options.saltBytes ?? 16
  if (!Number.isSafeInteger(saltLength) || saltLength < 16 || saltLength > 64) {
    throw new RangeError('Password salt length must be between 16 and 64 bytes')
  }

  const salt = new Uint8Array(saltLength)
  crypto.getRandomValues(salt)
  const digest = await derivePasswordDigest(password, salt, iterations)
  return [
    'pbkdf2-sha256',
    String(iterations),
    bytesToBase64Url(salt),
    bytesToBase64Url(digest),
  ].join('$')
}

/** Verify a password hash without revealing malformed stored values. */
export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  try {
    const parts = encodedHash.split('$')
    if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') {
      return false
    }

    const iterations = Number(parts[1])
    validateIterations(iterations)
    const salt = base64UrlToBytes(parts[2])
    const expectedDigest = base64UrlToBytes(parts[3])
    if (salt.length < 16 || salt.length > 64 || expectedDigest.length !== DERIVED_KEY_BITS / 8) {
      return false
    }

    const actualDigest = await derivePasswordDigest(password, salt, iterations)
    return constantTimeEqual(actualDigest, expectedDigest)
  } catch {
    return false
  }
}

/**
 * Hash an opaque high-entropy session token with HMAC when a pepper is given.
 * Session-token entropy, not slow password hashing, protects these values.
 */
export async function hashToken(token: string, pepper?: string): Promise<string> {
  if (typeof token !== 'string' || token.length === 0) {
    throw new TypeError('Token must be a non-empty string')
  }

  const tokenBytes = textEncoder.encode(token)
  if (pepper !== undefined) {
    if (pepper.length === 0) {
      throw new TypeError('Token pepper must be non-empty when provided')
    }
    const key = await crypto.subtle.importKey(
      'raw',
      textEncoder.encode(pepper),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const digest = await crypto.subtle.sign('HMAC', key, tokenBytes)
    return bytesToBase64Url(new Uint8Array(digest))
  }

  const digest = await crypto.subtle.digest('SHA-256', tokenBytes)
  return bytesToBase64Url(new Uint8Array(digest))
}

/** Generate a high-entropy URL-safe opaque token for an HTTP-only cookie. */
export function generateOpaqueToken(bytes = 32): string {
  if (!Number.isSafeInteger(bytes) || bytes < 32 || bytes > 128) {
    throw new RangeError('Opaque token length must be between 32 and 128 bytes')
  }
  const random = new Uint8Array(bytes)
  crypto.getRandomValues(random)
  return bytesToBase64Url(random)
}

export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false
  }

  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index]
  }
  return difference === 0
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new TypeError('Invalid base64url value')
  }
  const base64 = value.replace(/-/gu, '+').replace(/_/gu, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function derivePasswordDigest(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt as unknown as BufferSource,
      iterations,
    },
    key,
    DERIVED_KEY_BITS,
  )
  return new Uint8Array(bits)
}

function validateIterations(iterations: number): void {
  if (!Number.isSafeInteger(iterations) || iterations < MIN_PBKDF2_ITERATIONS || iterations > MAX_PBKDF2_ITERATIONS) {
    throw new RangeError(
      `PBKDF2 iterations must be between ${MIN_PBKDF2_ITERATIONS} and ${MAX_PBKDF2_ITERATIONS}`,
    )
  }
}
