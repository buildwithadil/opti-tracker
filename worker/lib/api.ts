export interface ApiMeta {
  requestId?: string
  [key: string]: unknown
}

export interface ApiSuccess<T> {
  success: true
  data: T
  message?: string
  meta?: ApiMeta
}

export interface ApiFailure {
  success: false
  error: {
    code: string
    message: string
    details?: unknown
  }
  message: string
  meta?: ApiMeta
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure

/** Minimal response surface needed to preserve middleware headers in Blaze. */
export interface ResponseWriter {
  status(code: number): ResponseWriter
  header(name: string, value: string): ResponseWriter
  send(body?: BodyInit | null, status?: number): void
}

export interface ApiResponseOptions {
  status?: number
  headers?: HeadersInit
  meta?: ApiMeta
  message?: string
}

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
}

/** Build a JSON response with the stable API success envelope. */
export function apiSuccess<T>(data: T, options: ApiResponseOptions = {}): Response {
  const body: ApiSuccess<T> = {
    success: true,
    data,
    ...(options.message ? { message: options.message } : {}),
    ...(options.meta ? { meta: options.meta } : {}),
  }

  return jsonResponse(body, options)
}

/** Build a JSON response with the stable API error envelope. */
export function apiFailure(
  code: string,
  message: string,
  options: ApiResponseOptions & { details?: unknown } = {},
): Response {
  const body: ApiFailure = {
    success: false,
    error: {
      code,
      message,
      ...(options.details === undefined ? {} : { details: options.details }),
    },
    message,
    ...(options.meta ? { meta: options.meta } : {}),
  }

  return jsonResponse(body, options)
}

/**
 * Forward a Web Response through the framework response writer. Calling
 * `raw()` would bypass headers set by middleware in some Blaze versions.
 */
export function sendResponse(writer: ResponseWriter, response: Response): void {
  writer.status(response.status)
  response.headers.forEach((value, name) => writer.header(name, value))
  writer.send(response.body)
}

function jsonResponse<T>(body: T, options: ApiResponseOptions): Response {
  const headers = new Headers(JSON_HEADERS)
  if (options.headers) {
    new Headers(options.headers).forEach((value, name) => headers.set(name, value))
  }

  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers,
  })
}
