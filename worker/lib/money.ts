/** A branded integer count of Indian paise. */
export type Paise = number & { readonly __paise: unique symbol }

export interface MoneyLine {
  quantity: number
  unitPricePaise: Paise
  discountPaise?: Paise
  taxPaise?: Paise
}

export interface MoneyTotals {
  subtotalPaise: Paise
  discountPaise: Paise
  taxPaise: Paise
  totalPaise: Paise
}

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER

/** Validate and brand an integer paise value from a trusted numeric source. */
export function asPaise(value: number, field = 'amount'): Paise {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer in paise`)
  }
  return value as Paise
}

/**
 * Parse a rupee amount without going through binary floating point arithmetic.
 * Inputs may contain up to two decimal places (for example, "1250.50").
 */
export function parseRupeesToPaise(value: string | number): Paise {
  const raw = typeof value === 'number' ? String(value) : value.trim()
  const match = raw.match(/^(\d+)(?:\.(\d{1,2}))?$/)
  if (!match) {
    throw new TypeError('Amount must be a non-negative decimal rupee value with at most two fractional digits')
  }

  const whole = Number(match[1])
  const fraction = Number((match[2] ?? '').padEnd(2, '0') || '0')
  const absolutePaise = whole * 100 + fraction
  if (!Number.isSafeInteger(absolutePaise) || absolutePaise > MAX_SAFE_INTEGER) {
    throw new RangeError('Amount is outside the supported safe integer range')
  }

  return absolutePaise as Paise
}

/** Validate a paise amount received from an API or database row. */
export function parsePaise(value: unknown, field = 'amount'): Paise {
  if (typeof value !== 'number') {
    throw new TypeError(`${field} must be an integer paise value`)
  }
  return asPaise(value, field)
}

export function addPaise(...values: Paise[]): Paise {
  return checkedPaise(values.reduce((sum, value) => sum + value, 0), 'sum')
}

export function subtractPaise(left: Paise, right: Paise): Paise {
  return checkedPaise(left - right, 'difference')
}

export function multiplyPaise(amount: Paise, quantity: number): Paise {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new RangeError('Quantity must be a non-negative safe integer')
  }
  return checkedPaise(amount * quantity, 'product')
}

/** Calculate tax using basis points and round to the nearest paise. */
export function calculateTaxPaise(taxablePaise: Paise, rateBasisPoints: number): Paise {
  if (!Number.isSafeInteger(rateBasisPoints) || rateBasisPoints < 0 || rateBasisPoints > 10_000) {
    throw new RangeError('Tax rate must be an integer number of basis points from 0 to 10000')
  }
  asPaise(taxablePaise, 'taxable amount')
  // BigInt avoids overflow in intermediates; the D1-facing result remains a
  // validated safe integer. Half-up rounding is explicit and reproducible.
  const rounded = (BigInt(taxablePaise) * BigInt(rateBasisPoints) + 5_000n) / 10_000n
  return checkedPaise(Number(rounded), 'tax')
}

export function calculateLineTotal(line: MoneyLine): Paise {
  const quantity = line.quantity
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new RangeError('Line quantity must be a positive safe integer')
  }

  const gross = multiplyPaise(line.unitPricePaise, quantity)
  const discount = line.discountPaise ?? asPaise(0)
  const tax = line.taxPaise ?? asPaise(0)
  if (discount > gross) {
    throw new RangeError('Line discount cannot exceed the gross line amount')
  }

  return checkedPaise(gross - discount + tax, 'line total')
}

export function calculateTotals(lines: readonly MoneyLine[], orderDiscountPaise: Paise = asPaise(0)): MoneyTotals {
  // Validate every line before aggregating so a malformed line cannot be hidden
  // by a larger valid subtotal.
  lines.forEach((line) => calculateLineTotal(line))
  const subtotalPaise = addPaise(...lines.map((line) => multiplyPaise(line.unitPricePaise, line.quantity)))
  const lineDiscountPaise = addPaise(...lines.map((line) => line.discountPaise ?? asPaise(0)))
  const discountPaise = addPaise(lineDiscountPaise, orderDiscountPaise)
  if (discountPaise > subtotalPaise) {
    throw new RangeError('Purchase discount cannot exceed the subtotal')
  }
  const taxPaise = addPaise(...lines.map((line) => line.taxPaise ?? asPaise(0)))

  return {
    subtotalPaise,
    discountPaise,
    taxPaise,
    totalPaise: checkedPaise(subtotalPaise - discountPaise + taxPaise, 'purchase total'),
  }
}

/** Stable decimal formatting for API/UI boundaries (not a floating-point value). */
export function formatPaise(value: Paise): string {
  const absolute = Math.abs(value)
  const whole = Math.floor(absolute / 100)
  const fraction = String(absolute % 100).padStart(2, '0')
  return `${value < 0 ? '-' : ''}${whole}.${fraction}`
}

function checkedPaise(value: number, field: string): Paise {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} is outside the supported non-negative paise range`)
  }
  return value as Paise
}
