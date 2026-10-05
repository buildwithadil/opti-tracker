import { z } from 'zod'
import { readQueryParameters } from '../lib/query.js'
import { purchaseCreateSchema, purchaseCustomerPathSchema, purchaseItemPathSchema, purchaseListSchema } from '../../shared/purchaseValidation.js'

export { purchaseCreateSchema, purchaseCustomerPathSchema, purchaseItemPathSchema, purchaseListSchema }

/** Reject malformed encoding and duplicate/unknown parameters before Zod sees
 * the query. URLSearchParams otherwise silently repairs both cases. */
export function parsePurchaseListQuery(url: URL): PurchaseListOptions {
  return purchaseListSchema.parse(readQueryParameters(url, 'purchase'))
}

export type PurchaseListOptions = z.infer<typeof purchaseListSchema>
