import { HttpError } from './errors.js'

/** Preserve strict percent-decoding and reject duplicate parameters before Zod. */
export function readQueryParameters(url: URL, label: string): Record<string, string> {
  if (url.search.length > 2048) throw new HttpError(400, 'INVALID_INPUT', `The ${label} query is too long.`)
  const query: Record<string, string> = {}
  for (const part of url.search.slice(1).split('&')) {
    if (!part && !url.search) continue
    const separator = part.indexOf('=')
    let key: string, value: string
    try {
      key = decodeURIComponent((separator < 0 ? part : part.slice(0, separator)).replace(/\+/gu, ' '))
      value = decodeURIComponent((separator < 0 ? '' : part.slice(separator + 1)).replace(/\+/gu, ' '))
    } catch { throw new HttpError(400, 'INVALID_INPUT', `The ${label} query contains invalid encoding.`) }
    if (Object.hasOwn(query, key)) throw new HttpError(400, 'INVALID_INPUT', `Supply each ${label} query parameter only once.`, [{ field: key, message: 'Duplicate query parameter.' }])
    Object.defineProperty(query, key, { value, enumerable: true, configurable: true })
  }
  return query
}
