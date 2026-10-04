export class InputNormalizationError extends Error {
  readonly code = 'INVALID_INPUT'

  constructor(message: string) {
    super(message)
    this.name = 'InputNormalizationError'
  }
}

export interface TextOptions {
  field?: string
  maxLength?: number
  allowEmpty?: boolean
}

/** Normalize user-entered text while preserving the distinction from null. */
export function normalizeText(value: unknown, options: TextOptions = {}): string {
  const field = options.field ?? 'value'
  if (typeof value !== 'string') {
    throw new InputNormalizationError(`${field} must be text`)
  }

  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
  if (!options.allowEmpty && normalized.length === 0) {
    throw new InputNormalizationError(`${field} is required`)
  }
  if (options.maxLength !== undefined && normalized.length > options.maxLength) {
    throw new InputNormalizationError(`${field} must be at most ${options.maxLength} characters`)
  }
  return normalized
}

export function normalizeRequiredText(value: unknown, field: string, maxLength = 500): string {
  return normalizeText(value, { field, maxLength })
}

export function normalizeOptionalText(value: unknown, field: string, maxLength = 500): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const normalized = normalizeText(value, { field, maxLength, allowEmpty: true })
  return normalized.length === 0 ? null : normalized
}

export function normalizeName(value: unknown, field = 'name'): string {
  return normalizeText(value, { field, maxLength: 200 })
}

export function normalizeEmail(value: unknown, field = 'email'): string {
  const email = normalizeText(value, { field, maxLength: 320 }).toLowerCase()
  // This intentionally stays conservative: it catches malformed input without
  // pretending to implement the full RFC email grammar.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new InputNormalizationError(`${field} must be a valid email address`)
  }
  return email
}

export function normalizeOptionalEmail(value: unknown, field = 'email'): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  return normalizeEmail(value, field)
}

/** Normalize a phone number to an ASCII plus-prefixed or national digit string. */
export function normalizePhone(value: unknown, field = 'phone'): string {
  const phone = normalizeText(value, { field, maxLength: 32 }).replace(/[\s().-]/gu, '')
  if (!/^\+?\d{7,15}$/u.test(phone)) {
    throw new InputNormalizationError(`${field} must contain 7 to 15 digits`)
  }
  return phone
}

export function normalizeOptionalPhone(value: unknown, field = 'phone'): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  return normalizePhone(value, field)
}

export function normalizeDateOnly(value: unknown, field = 'date'): string {
  const date = normalizeText(value, { field, maxLength: 10 })
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    throw new InputNormalizationError(`${field} must use YYYY-MM-DD format`)
  }

  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new InputNormalizationError(`${field} must be a real calendar date`)
  }
  return date
}

export function normalizeOptionalDateOnly(value: unknown, field = 'date'): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  return normalizeDateOnly(value, field)
}

export function normalizeInteger(
  value: unknown,
  field: string,
  options: { min?: number; max?: number } = {},
): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && value.trim() === '')) {
    throw new InputNormalizationError(`${field} must be an integer`)
  }
  if (typeof value === 'string' && !/^-?\d+$/u.test(value.trim())) {
    throw new InputNormalizationError(`${field} must be an integer`)
  }
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(numberValue)) {
    throw new InputNormalizationError(`${field} must be an integer`)
  }
  if (options.min !== undefined && numberValue < options.min) {
    throw new InputNormalizationError(`${field} must be at least ${options.min}`)
  }
  if (options.max !== undefined && numberValue > options.max) {
    throw new InputNormalizationError(`${field} must be at most ${options.max}`)
  }
  return numberValue
}
