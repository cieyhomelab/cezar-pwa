import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  AuthRequiredError,
  NetworkError,
  TimeoutError,
  apiFetch,
  pushFetch,
} from './http.ts'

/** The gateway's refusal, reproduced from `docs/CEZAR_API.md` § 1a. */
function bareRefusal() {
  return new Response('<html>403 Forbidden</html>', {
    status: 403,
    headers: { 'content-type': 'text/html' },
  })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function mockFetch(implementation: typeof fetch) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(implementation)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('apiFetch', () => {
  it('returns the parsed body of a successful call', async () => {
    mockFetch(async () => json({ version: '0.11.1', projects: [] }))
    await expect(apiFetch('/api/v1/health')).resolves.toEqual({
      version: '0.11.1',
      projects: [],
    })
  })

  it('sends same-origin credentials and asks for JSON', async () => {
    const fetchMock = mockFetch(async () => json({ version: '0.11.1' }))
    await apiFetch('/api/v1/health')

    const [path, init] = fetchMock.mock.calls[0]!
    expect(path).toBe('/api/v1/health')
    expect(init?.credentials).toBe('same-origin')
    expect(new Headers(init?.headers).get('accept')).toBe('application/json')
  })

  it('refuses a path outside the versioned surface', async () => {
    // Legacy `/api/…` is frozen for bookmarklets (CLAUDE.md rule 2).
    await expect(apiFetch('/api/health')).rejects.toThrow(/must start with \/api\/v1\//)
  })

  it.each([401, 403])('turns %i into AuthRequiredError', async (status) => {
    mockFetch(
      async () =>
        new Response('<html>nope</html>', {
          status,
          headers: { 'content-type': 'text/html' },
        }),
    )
    const error = await apiFetch('/api/v1/health').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AuthRequiredError)
    expect((error as AuthRequiredError).status).toBe(status)
  })

  it('turns the gateway’s bare 403 page into AuthRequiredError', async () => {
    mockFetch(async () => bareRefusal())
    await expect(apiFetch('/api/v1/health')).rejects.toBeInstanceOf(AuthRequiredError)
  })

  it('treats a 200 that is HTML as no session, not as data', async () => {
    // A login page, a captive portal, or our own shell answering for /api.
    mockFetch(
      async () =>
        new Response('<!doctype html><title>Cezar</title>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    )
    await expect(apiFetch('/api/v1/health')).rejects.toBeInstanceOf(AuthRequiredError)
  })

  it("surfaces Cezar's own { error } message", async () => {
    mockFetch(async () => json({ error: 'run not found' }, 404))
    const error = await apiFetch('/api/v1/p/x/runs/y').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).message).toBe('run not found')
    expect((error as ApiError).status).toBe(404)
  })

  it('falls back to the status when the error body is not JSON', async () => {
    mockFetch(async () => new Response('boom', { status: 502 }))
    await expect(apiFetch('/api/v1/health')).rejects.toThrow('HTTP 502')
  })

  it('turns a dead network into NetworkError, which is not an auth failure', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    const error = await apiFetch('/api/v1/health').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NetworkError)
    expect(error).not.toBeInstanceOf(AuthRequiredError)
  })

  it('gives up on a request that outlives its timeout', async () => {
    mockFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    )

    const pending = apiFetch('/api/v1/health', { timeoutMs: 10 }).catch((e: unknown) => e)
    await expect(pending).resolves.toBeInstanceOf(TimeoutError)
  })

  it('lets a caller-driven abort propagate as itself', async () => {
    // TanStack Query cancels queries; a cancellation must not be reported as a
    // broken network.
    mockFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    )

    const controller = new AbortController()
    const pending = apiFetch('/api/v1/health', { signal: controller.signal }).catch(
      (e: unknown) => e,
    )
    controller.abort()
    const error = await pending
    expect(error).not.toBeInstanceOf(NetworkError)
    expect((error as DOMException).name).toBe('AbortError')
  })

  it('serialises a write body as JSON', async () => {
    const fetchMock = mockFetch(async () => json({ ok: true }))
    await apiFetch('/api/v1/p/x/runs/y/messages', { method: 'POST', body: { text: 'hi' } })

    const init = fetchMock.mock.calls[0]![1]
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('{"text":"hi"}')
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
  })
})

describe('pushFetch', () => {
  // #31: an unrouted sidecar lets nginx's SPA fallback answer with the app shell. The gate let the
  // request through, so that is "unavailable" (reported like nginx's 502), not "no session".
  it.each([
    { status: 200, error: new ApiError('HTTP 200 (not JSON)', 502) },
    { status: 403, error: new AuthRequiredError(403) },
  ])('classifies an HTML $status as $error.name', async ({ status, error }) => {
    mockFetch(
      async () =>
        new Response('<!doctype html><title>Cezar</title>', {
          status,
          headers: { 'content-type': 'text/html' },
        }),
    )
    const caught = await pushFetch('/m/push/vapid-public-key').catch((e: unknown) => e)
    expect(caught).toBeInstanceOf(error.constructor)
    expect(caught).toMatchObject({ status: error.status, message: error.message })
  })
})
