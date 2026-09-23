/**
 * The single door to Cezar's API (CLAUDE.md: every API call goes through
 * `src/api/http.ts`). It exists to make three judgements in one place:
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

/** The push sidecar (`apps/push-sidecar`), same origin, behind the same gate (REQUIREMENTS A6). */
const PUSH_PREFIX = '/m/push/'

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

/**
 * Why this layer, rather than the server, judged an answer unusable. A coded `ApiError` carries
 * no words of the server's, so nothing may show its `message` to the operator — `i18n/errors.ts`
 * turns the code into the sentence a screen prints (CLAUDE.md: UI text only from `i18n/en.ts`).
 */
export type ApiErrorCode =
  /** A 2xx whose JSON is not the shape the caller needs — a field or a container is missing. */
  | 'unexpected-shape'
  /** A 2xx that claimed JSON and did not parse. */
  | 'invalid-json'
  /** `/m/push/…` answered by the SPA fallback instead of the sidecar: a missing sidecar (#31). */
  | 'not-routed'
  /** An error status with no `{ error }` of its own — nginx's page, or an empty body. */
  | 'no-detail'

/**
 * Cezar itself answered with an error. `message` is its own `{ error }` when it sent one — and
 * only then, which is exactly what `code === undefined` says. With a code, `message` is a
 * developer-facing note and the operator's sentence comes from the code instead.
 */
export class ApiError extends Error {
  readonly status: number

  /** Set when this layer judged the answer; absent when the server gave its own reason. */
  readonly code: ApiErrorCode | undefined

  constructor(message: string, status: number, code?: ApiErrorCode) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
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

/**
 * Cezar's error shape is `{ error }`; anything else falls back to the status, and says so with
 * `no-detail` — the caller must not read that fallback out to the operator as a reason.
 */
async function refusal(response: Response): Promise<ApiError> {
  const noDetail = new ApiError(`HTTP ${response.status}`, response.status, 'no-detail')
  if (!isJson(response)) return noDetail
  try {
    const body: unknown = await response.json()
    const message = (body as { error?: unknown } | null)?.error
    return typeof message === 'string' && message.length > 0
      ? new ApiError(message, response.status)
      : noDetail
  } catch {
    return noDetail
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
  return request<T>(path, options, 'no-session')
}

/**
 * The same judgements for the push sidecar's `/m/push/…`. It sits behind the same gate and
 * answers errors in Cezar's `{ error }` shape, so a lapsed session reads the same way here.
 *
 * One difference: a 2xx that is not JSON is not the gate. Past the gate, a `/m/push/` that is
 * not routed to the sidecar falls into `location ^~ /m/`'s SPA fallback and gets our own
 * `index.html` with a 200 (#31). That is a missing sidecar, so it reads as nginx's 502 would.
 *
 * @throws {ApiError} status 502 when the answer was not the sidecar's JSON
 */
export async function pushFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  if (!path.startsWith(PUSH_PREFIX)) {
    throw new Error(`push path must start with ${PUSH_PREFIX}: ${path}`)
  }
  return request<T>(path, options, 'not-routed')
}

/** The perimeter's own paths (`deploy/nginx/`): nginx answers them, not Cezar or the sidecar. */
const SESSION_PREFIX = '/m/session/'

/**
 * S-12: a bodyless POST to the perimeter, which answers with a status and nothing else — so the
 * status is what comes back, and judging it is the caller's job.
 *
 * @throws {TimeoutError | NetworkError} the request never completed
 */
export async function perimeterPost(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<number> {
  if (!path.startsWith(SESSION_PREFIX)) {
    throw new Error(`perimeter path must start with ${SESSION_PREFIX}: ${path}`)
  }
  const response = await send(path, { method: 'POST' }, undefined, timeoutMs)
  return response.status
}

/** What a 2xx that is not JSON means on a surface: the gate's page, or the app shell. */
type NotJson = 'no-session' | 'not-routed'

async function request<T>(path: string, options: ApiFetchOptions, notJson: NotJson): Promise<T> {
  const { method = 'GET', body, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options

  const response = await send(
    path,
    {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    signal,
    timeoutMs,
  )

  // 401 never appears on this gateway, but a different perimeter would use it
  // and it means the same thing here.
  if (response.status === 401 || response.status === 403) {
    throw new AuthRequiredError(response.status)
  }

  if (!response.ok) {
    throw await refusal(response)
  }

  // A 200 that is not JSON means something in front of Cezar answered for it —
  // a login page, a captive portal, a cached shell. Treat it as no session
  // rather than as data (CLAUDE.md: HTML where JSON was asked for means no session).
  if (!isJson(response)) {
    if (notJson === 'not-routed') {
      throw new ApiError(`HTTP ${response.status} (not JSON)`, 502, 'not-routed')
    }
    throw new AuthRequiredError(response.status)
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new ApiError('the answer is not valid JSON', response.status, 'invalid-json')
  }
}

/** The fetch itself: same-origin, under a timeout, with the caller's cancellation merged in. */
async function send(
  path: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Response> {
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
      ...init,
      // The session cookie is HttpOnly and same-origin; the app never sees it
      // and never sends a credential of its own (R-AUTH-5).
      credentials: 'same-origin',
      signal: controller.signal,
    })
  } catch (cause) {
    if (timedOut) throw new TimeoutError(timeoutMs)
    // A caller-driven abort is not a failure — let it propagate as itself so
    // TanStack Query can tell a cancelled query from a broken network.
    if (signal?.aborted) throw cause
    throw new NetworkError('could not reach Cezar', { cause })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abortFromCaller)
  }

  return response
}
