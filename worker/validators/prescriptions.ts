import { z } from 'zod'
import { HttpError } from '../lib/errors.js'

const customerUuid = z.string().uuid('Use a valid customer UUID.').toLowerCase()
const prescriptionUuid = z.string().uuid('Use a valid prescription UUID.').toLowerCase()
export const prescriptionCustomerPathSchema = z.object({ customerUuid }).strict()
export const prescriptionItemPathSchema = z.object({ customerUuid, prescriptionUuid }).strict()

function boundedInteger(max: number) {
  return z.string().regex(/^[1-9][0-9]*$/u, 'Use a positive whole number.')
    .transform(Number).pipe(z.number().int().min(1).max(max))
}
export const prescriptionListSchema = z.object({
  page: boundedInteger(10000).default(1),
  pageSize: boundedInteger(50).default(20),
}).strict()

/** Match the customer query boundary: reject malformed encoding, unknown
 * parameters and duplicates instead of URLSearchParams silently repairing them.
 */
export function parsePrescriptionListQuery(url: URL): PrescriptionListOptions {
  if (url.search.length > 2048) throw new HttpError(400, 'INVALID_INPUT', 'The prescription query is too long.')
  const query: Record<string, string> = {}
  for (const part of url.search.slice(1).split('&')) {
    if (!part && !url.search) continue
    const separator = part.indexOf('=')
    let key: string
    let value: string
    try {
      key = decodeURIComponent((separator < 0 ? part : part.slice(0, separator)).replace(/\+/gu, ' '))
      value = decodeURIComponent((separator < 0 ? '' : part.slice(separator + 1)).replace(/\+/gu, ' '))
    } catch {
      throw new HttpError(400, 'INVALID_INPUT', 'The prescription query contains invalid encoding.')
    }
    if (Object.hasOwn(query, key)) {
      throw new HttpError(400, 'INVALID_INPUT', 'Supply each prescription query parameter only once.', [{ field: key, message: 'Duplicate query parameter.' }])
    }
    Object.defineProperty(query, key, { value, enumerable: true, configurable: true })
  }
  return prescriptionListSchema.parse(query)
}

export type PrescriptionListOptions = z.infer<typeof prescriptionListSchema>
