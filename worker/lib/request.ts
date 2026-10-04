import { HttpError } from './errors.js'

export const MAX_JSON_BYTES = 16 * 1024

/** Bound stream reads as well as Content-Length; chunked requests cannot bypass
 * the limit. Used only on fixed-schema authenticated JSON endpoints. */
export async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'JSON_REQUIRED', 'Use application/json for this request.')
  }
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_JSON_BYTES) {
    throw new HttpError(413, 'BODY_TOO_LARGE', 'The request body is too large.')
  }
  const reader = request.body?.getReader()
  if (!reader) throw new HttpError(400, 'INVALID_JSON', 'A JSON request body is required.')
  let bytes = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_JSON_BYTES) {
        await reader.cancel()
        throw new HttpError(413, 'BODY_TOO_LARGE', 'The request body is too large.')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const data = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(data)) as unknown }
  catch { throw new HttpError(400, 'INVALID_JSON', 'Request body must contain valid JSON.') }
}
