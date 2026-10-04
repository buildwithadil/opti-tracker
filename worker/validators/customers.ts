import { z } from 'zod'
import { normalizeIndianMobile } from '../../shared/phone.js'
import { HttpError } from '../lib/errors.js'

const controlCharacters = /[\p{Cc}\p{Cf}\u2028\u2029]/u
const name = z.string()
  .refine((value) => !controlCharacters.test(value), 'The name must not contain control characters.')
  .transform((value) => value.normalize('NFKC').trim().replace(/\s+/gu, ' '))
  .pipe(z.string().min(1, 'Enter the full name.').max(200, 'Use at most 200 characters for the name.'))
const phone = z.string().max(32, 'Use at most 32 characters for the mobile number.')
  .transform((value, context) => {
    try { return normalizeIndianMobile(value) }
    catch (error) {
      context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Enter a valid Indian mobile number.' })
      return z.NEVER
    }
  })

export const createCustomerSchema = z.object({ name, phone }).strict()
export const patchCustomerSchema = z.object({ name: name.optional(), phone: phone.optional() }).strict()
  .refine((input) => input.name !== undefined || input.phone !== undefined, 'Provide a name or mobile number to update.')
export const customerPathSchema = z.object({ uuid: z.string().uuid('Use a valid customer UUID.').toLowerCase() }).strict()

function boundedInteger(max: number) {
  return z.string().regex(/^[1-9][0-9]*$/u, 'Use a positive whole number.')
    .transform(Number).pipe(z.number().int().min(1).max(max))
}

export const customerListSchema = z.object({
  search: z.string().refine((value) => !controlCharacters.test(value), 'Search must not contain control characters.').trim().max(100).default(''),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  page: boundedInteger(10000).default(1),
  pageSize: boundedInteger(50).default(20),
  sort: z.enum(['created_at', 'updated_at', 'name', 'phone']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
}).strict()

/** URLSearchParams silently repairs malformed percent/UTF-8 encoding and
 * overwrites duplicates when converted to an object; reject both explicitly.
 */
export function parseCustomerListQuery(url: URL): CustomerListOptions {
  if (url.search.length > 2048) throw new HttpError(400, 'INVALID_INPUT', 'The customer query is too long.')
  const query: Record<string, string> = {}
  for (const part of url.search.slice(1).split('&')) {
    if (!part && !url.search) continue
    let key: string
    let value: string
    const separator = part.indexOf('=')
    try {
      key = decodeURIComponent((separator < 0 ? part : part.slice(0, separator)).replace(/\+/gu, ' '))
      value = decodeURIComponent((separator < 0 ? '' : part.slice(separator + 1)).replace(/\+/gu, ' '))
    } catch {
      throw new HttpError(400, 'INVALID_INPUT', 'The customer query contains invalid encoding.')
    }
    if (Object.hasOwn(query, key)) {
      throw new HttpError(400, 'INVALID_INPUT', 'Supply each customer query parameter only once.', [{ field: key, message: 'Duplicate query parameter.' }])
    }
    // Define an own property so __proto__ cannot evade strict validation.
    Object.defineProperty(query, key, { value, enumerable: true, configurable: true })
  }
  return customerListSchema.parse(query)
}

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>
export type PatchCustomerInput = z.infer<typeof patchCustomerSchema>
export type CustomerListOptions = z.infer<typeof customerListSchema>
