/** Accepted Indian mobile forms: 9876543210, 09876543210,
 * 919876543210, +919876543210 and 00919876543210. A single ASCII
 * space or hyphen may separate a prefix or the two five-digit groups.
 * Do not strip arbitrary punctuation: malformed/foreign input must fail.
 */
export function normalizeIndianMobile(input: unknown): string {
  if (typeof input !== 'string' || input.length > 32 || !/^[0-9+ -]+$/u.test(input)) {
    throw new Error('Enter a valid Indian mobile number with 10 digits.')
  }
  const match = /^(?:(?:\+91|0091|91|0)[ -]?)?([6-9][0-9]{4})[ -]?([0-9]{5})$/u.exec(input.trim())
  if (!match) throw new Error('Enter a valid Indian mobile number starting with 6, 7, 8 or 9.')
  return `+91${match[1]}${match[2]}`
}

/** Format an already canonical number; never silently normalize corrupt data. */
export function formatIndianMobile(normalized: string): string {
  if (!/^\+91[6-9][0-9]{9}$/u.test(normalized)) throw new Error('The mobile number is not canonical.')
  return `+91 ${normalized.slice(3, 8)} ${normalized.slice(8)}`
}
