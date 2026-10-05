import { z } from 'zod'
import { HttpError } from '../lib/errors.js'
import { purchaseCreateSchema, purchaseCustomerPathSchema, purchaseItemPathSchema, purchaseListSchema } from '../../shared/purchaseValidation.js'

export { purchaseCreateSchema, purchaseCustomerPathSchema, purchaseItemPathSchema, purchaseListSchema }

/** Reject malformed encoding and duplicate/unknown parameters before Zod sees
 * the query. URLSearchParams otherwise silently repairs both cases. */
export function parsePurchaseListQuery(url: URL): PurchaseListOptions {
  if (url.search.length > 2048) throw new HttpError(400, 'INVALID_INPUT', 'The purchase query is too long.')
  const query: Record<string, string> = {}
  for (const part of url.search.slice(1).split('&')) {
    if (!part && !url.search) continue
    const separator = part.indexOf('=')
    let key: string
    let value: string
    try {
      key = decodeURIComponent((separator < 0 ? part : part.slice(0, separator)).replace(/\+/gu, ' '))
      value = decodeURIComponent((separator < 0 ? '' : part.slice(separator + 1)).replace(/\+/gu, ' '))
    } catch { throw new HttpError(400, 'INVALID_INPUT', 'The purchase query contains invalid encoding.') }
    if (Object.hasOwn(query, key)) {
      throw new HttpError(400, 'INVALID_INPUT', 'Supply each purchase query parameter only once.', [{ field: key, message: 'Duplicate query parameter.' }])
    }
    Object.defineProperty(query, key, { value, enumerable: true, configurable: true })
  }
  return purchaseListSchema.parse(query)
}

export type PurchaseListOptions = z.infer<typeof purchaseListSchema>
