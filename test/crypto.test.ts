import { describe, expect, it } from 'vitest'
import {
  bytesToBase64Url, constantTimeEqual, generateOpaqueToken, hashPassword, hashToken, verifyPassword,
} from '../worker/lib/crypto'
import { hmac, SESSION_PEPPER } from './helpers'

function decodeBase64Url(value: string): Uint8Array {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '='))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

describe('password hashing in workerd Web Crypto', () => {
  it('uses independently verifiable PBKDF2-SHA256 with 600,000 iterations, a random salt, and a 256-bit digest', async () => {
    const password = '  a Unicode passphrase ₹ 🔐 with spaces  '
    const first = await hashPassword(password)
    const second = await hashPassword(password)
    const [algorithm, iterations, salt, digest] = first.split('$')
    expect(algorithm).toBe('pbkdf2-sha256')
    expect(Number(iterations)).toBe(600_000)
    expect(decodeBase64Url(salt)).toHaveLength(16)
    expect(decodeBase64Url(digest)).toHaveLength(32)
    expect(first).not.toBe(second)
    expect(salt).not.toBe(second.split('$')[2])
    expect(first).not.toContain(password)
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
    const independentDigest = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, salt: decodeBase64Url(salt) }, key, 256)
    expect(new Uint8Array(independentDigest)).toEqual(decodeBase64Url(digest))
    expect(await verifyPassword(password, first)).toBe(true)
    expect(await verifyPassword(password.trim(), first)).toBe(false)
    expect(await verifyPassword('a different password', first)).toBe(false)
  })

  it.each([
    '', 'plaintext-password', 'pbkdf2-sha256$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'pbkdf2-sha256$2000001$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'pbkdf2-sha256$NaN$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'pbkdf2-sha256$600000$short$short',
    'pbkdf2-sha256$600000$%%%$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'bcrypt$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA$extra',
  ])('fails closed without throwing for a malformed stored hash: %s', async (encoded) => {
    expect(await verifyPassword('a secret password', encoded)).toBe(false)
  })

  it('rejects unsafe password-hash derivation parameters', async () => {
    await expect(hashPassword('')).rejects.toThrow(TypeError)
    for (const iterations of [0, 99_999, 2_000_001, 100_000.5]) {
      await expect(hashPassword('a password', { iterations })).rejects.toThrow(RangeError)
    }
    for (const saltBytes of [0, 15, 65, 16.5]) {
      await expect(hashPassword('a password', { saltBytes })).rejects.toThrow(RangeError)
    }
  })
})

describe('opaque tokens and secret-derived fingerprints', () => {
  it('generates distinct 32-byte cryptographically random base64url session tokens', () => {
    const tokens = Array.from({ length: 100 }, () => generateOpaqueToken())
    expect(new Set(tokens).size).toBe(tokens.length)
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u)
      expect(decodeBase64Url(token)).toHaveLength(32)
    }
    for (const size of [0, 31, 129, 32.5]) expect(() => generateOpaqueToken(size)).toThrow(RangeError)
  })

  it('matches independent HMAC-SHA256, requires the correct pepper, and separates CSRF from session fingerprints', async () => {
    const token = generateOpaqueToken()
    expect(await hashToken(token, SESSION_PEPPER)).toBe(await hmac(token))
    expect(await hashToken(token, SESSION_PEPPER)).not.toBe(await hashToken(token, 'a different secret pepper'))
    expect(await hashToken(token, SESSION_PEPPER)).not.toBe(await hashToken(`csrf:${token}`, SESSION_PEPPER))
    const unpeppered = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
    expect(await hashToken(token)).toBe(bytesToBase64Url(unpeppered))
    await expect(hashToken('')).rejects.toThrow(TypeError)
    await expect(hashToken(token, '')).rejects.toThrow(TypeError)
  })

  it('compares the entire byte sequence, including lengths and the final byte', () => {
    expect(constantTimeEqual(new Uint8Array(), new Uint8Array())).toBe(true)
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true)
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false)
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0]))).toBe(false)
  })
})
