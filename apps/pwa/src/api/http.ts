/**
 * The single door to Cezar's API (CLAUDE.md → "Każde wywołanie API przez
 * src/api/http.ts"). It exists to make three judgements in one place:
 *
 *  1. **Is there a session?** The gateway answers a missing or stale session
 *     with a bare 403 carrying a 148-byte HTML error page — no redirect, no
 *     challenge header, identical for reads, writes and streams
 *     (`docs/CEZAR_API.md` § 1a). That, and an otherwise-successful response
 *     that is HTML rather than JSON, is the only signal the product ever gets
 *     that it is not authorized, and it becomes `AuthRequiredError`.
 *  2. **Did the server refuse for its own reasons?** Cezar's errors are
 *     `{ "error": string }` plus a status; they become `ApiError`.
 *  3. **Did the request never arrive?** A dead network or a request that
 *     outlived its timeout becomes `NetworkError` / `TimeoutError` — which is
 *     emphatically *not* the same as "not authorized", and callers must not
 *     conflate them.
 *
 * Paths are always the versioned surface; legacy `/api/…` is frozen
 * (CLAUDE.md rule 2). Requests are same-origin by construction — the app is
 * served from Cezar's own origin, which is what the #426 guard requires.
 */

const API_PREFIX = '/api/v1/'

/** Long enough for a cold Cezar, short enough to fail before the operator does. */
export const DEFAULT_TIMEOUT_MS = 10_000

/** The gateway refused: no session, or a stale one. Offer re-unlocking (FR-004). */
export class AuthRequiredError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Cezar refused the request (${status}) — no valid session`)
    this.name = 'AuthRequiredError'
    this.status = status
  }
}

/** Cezar itself answered with an error. `message` is its own `{ error }` when it sent one. */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** The request never completed: no network, DNS, TLS, or a dropped connection. */
export class NetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'NetworkError'
  }
}

/** A `NetworkError` whose cause was our own deadline rather than the network. */
export class TimeoutError extends NetworkError {
  constructor(timeoutMs: number) {
    super(`Cezar did not answer within ${timeoutMs} ms`)
    this.name = 'TimeoutError'
  }
}

export type ApiFetchOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Serialised as JSON. */
  body?: unknown
  /** Caller's cancellation, merged with the timeout below. */
  signal?: AbortSignal
  timeoutMs?: number
}

function isJson(response: Response): boolean {
  return response.headers.get('content-type')?.includes('application/json') ?? false
}

/** Cezar's error shape is `{ error }`; anything else falls back to the status. */
async function errorMessage(response: Response): Promise<string> {
  if (!isJson(response)) return `HTTP ${response.status}`
  try {
    const body: unknown = await response.json()
    const message = (body as { error?: unknown } | null)?.error
    return typeof message === 'string' && message.length > 0
      ? message
      : `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}

/**
 * Fetch a versioned API path and return its parsed JSON body.
 *
 * @throws {AuthRequiredError} the gateway refused, or answered with a page instead of data
 * @throws {ApiError} Cezar answered with an error status
 * @throws {TimeoutError | NetworkError} the request never completed
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  if (!path.startsWith(API_PREFIX)) {
    // A programming error, not a runtime condition: the unversioned surface is
    // frozen and nothing here may reach for it.
    throw new Error(`API path must start with ${API_PREFIX}: ${path}`)
  }

  const { method = 'GET', body, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const abortFromCaller = () => controller.abort()
  signal?.addEventListener('abort', abortFromCaller)

  let response: Response
  try {
    response = await fetch(path, {
      method,
      // The session cookie is HttpOnly and same-origin; the app never sees it
      // and never sends a credential of its own (R-AUTH-5).
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    })
  } catch (cause) {
    if (timedOut) throw new TimeoutError(timeoutMs)
    // A caller-driven abort is not a failure — let it propagate as itself so
    // TanStack Query can tell a cancelled query from a broken network.
    if (signal?.aborted) throw cause
    throw new NetworkError('Nie udało się połączyć z Cezarem', { cause })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abortFromCaller)
  }

  // 401 never appears on this gateway, but a different perimeter would use it
  // and it means the same thing here.
  if (response.status === 401 || response.status === 403) {
    throw new AuthRequiredError(response.status)
  }

  if (!response.ok) {
    throw new ApiError(await errorMessage(response), response.status)
  }

  // A 200 that is not JSON means something in front of Cezar answered for it —
  // a login page, a captive portal, a cached shell. Treat it as no session
  // rather than as data (CLAUDE.md → "odpowiedź HTML zamiast JSON").
  if (!isJson(response)) {
    throw new AuthRequiredError(response.status)
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new ApiError('Odpowiedź Cezara nie jest poprawnym JSON-em', response.status)
  }
}
