export type ApiEnvelope<T> = {
  success: boolean
  data?: T
  message?: string
  error?: { message?: string }
}

export class ApiError extends Error {
  readonly status: number
  readonly details?: unknown

  constructor(message: string, status = 0, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

export type UnauthenticatedSession = {
  authenticated: false
  setupRequired: boolean
}

export type AuthenticatedSession = {
  authenticated: true
  id: string
  name: string
  email: string
  csrfToken: string
  shopName: string
}

export type Session = UnauthenticatedSession | AuthenticatedSession
export type ShopIdentity = { shopName: string; administratorEmail: string }

// CSRF tokens deliberately live only in this module's runtime memory. Nothing in
// the auth client writes tokens to localStorage, sessionStorage, cookies, or URLs.
let csrfToken: string | null = null

export function clearCsrfToken() {
  csrfToken = null
}

function rememberSession<T extends Session>(session: T): T {
  if (session.authenticated) csrfToken = session.csrfToken
  else clearCsrfToken()
  return session
}

export function csrfHeaders(): HeadersInit {
  if (!csrfToken) throw new ApiError('Your session security token is unavailable. Please sign in again.', 401)
  return { 'X-CSRF-Token': csrfToken }
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function responseMessage(body: unknown, response: Response) {
  if (typeof body === 'object' && body !== null) {
    if ('message' in body && typeof body.message === 'string') return body.message
    if ('error' in body && typeof body.error === 'object' && body.error !== null && 'message' in body.error && typeof body.error.message === 'string') {
      return body.error.message
    }
  }
  return response.statusText || 'The request could not be completed.'
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const method = (init.method ?? 'GET').toUpperCase()
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  if (unsafe && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  headers.set('Accept', 'application/json')

  // Browsers automatically attach the current page Origin to same-origin and
  // cross-origin unsafe fetches. Origin is intentionally not manually set here.
  const requestInit: RequestInit = {
    ...init,
    ...(unsafe && init.body === undefined ? { body: '{}' } : {}),
    headers,
    credentials: 'include',
  }

  let response: Response
  try {
    response = await fetch(path, requestInit)
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : 'Unable to connect to OptiDesk.', 0, error)
  }

  const body = await parseResponse(response)
  if (!response.ok) throw new ApiError(responseMessage(body, response), response.status, body)
  if (!body || typeof body !== 'object' || !('success' in body)) {
    throw new ApiError('The server returned an unexpected response.', response.status, body)
  }

  const envelope = body as ApiEnvelope<T>
  if (!envelope.success) throw new ApiError(envelope.message || envelope.error?.message || 'The request was not successful.', response.status, envelope)
  return envelope.data as T
}

export const authApi = {
  session: async ({ signal }: { signal?: AbortSignal } = {}) => rememberSession(await apiRequest<Session>('/api/auth/session', { signal })),
  me: async ({ signal }: { signal?: AbortSignal } = {}) => rememberSession(await apiRequest<AuthenticatedSession>('/api/auth/me', { signal })),
  login: async (payload: { email: string; password: string }) => {
    const session = await apiRequest<AuthenticatedSession>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    return rememberSession(session)
  },
  setup: async (payload: { name: string; email: string; password: string; setupToken: string }) => {
    const session = await apiRequest<AuthenticatedSession>('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    return rememberSession(session)
  },
  logout: async () => {
    await apiRequest<undefined>('/api/auth/logout', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({}),
    })
    clearCsrfToken()
  },
  changePassword: async (payload: { currentPassword: string; newPassword: string }) => {
    await apiRequest<undefined>('/api/auth/change-password', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify(payload),
    })
    clearCsrfToken()
  },
  shopIdentity: ({ signal }: { signal?: AbortSignal } = {}) => apiRequest<ShopIdentity>('/api/shop/identity', { signal }),
}
