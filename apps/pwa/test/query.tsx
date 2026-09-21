import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'

/**
 * Helpers for the screens that read server state. Anything rendering a
 * component that calls `useQuery` needs a provider around it, and a client that
 * does not retry or carry results between tests.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // Retries would turn a deterministic failure into a timing test.
      queries: { retry: false, gcTime: 0 },
    },
  })
}

/** Rendered inside a router too, at `path` (relative to the app's `/m` basename). */
export function renderWithQuery(ui: ReactElement, client = createTestQueryClient(), path = '/') {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  return { client, ...render(ui, { wrapper }) }
}

/** Cezar answering the session probe. */
export function healthResponse(version = '0.11.1'): Response {
  return new Response(JSON.stringify({ version, projects: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** The gateway's bare refusal (`docs/CEZAR_API.md` § 1a). */
export function refusalResponse(): Response {
  return new Response('<html>403 Forbidden</html>', {
    status: 403,
    headers: { 'content-type': 'text/html' },
  })
}

/**
 * Replace `fetch` with a queue-free stub whose answer can change between calls,
 * which is how the "come back and it works now" paths are exercised.
 */
export function stubFetch(respond: () => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => respond())
}

/** A JSON answer from Cezar. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** An empty workspace: the runs index with nothing in it. */
export function emptyRunsIndexResponse(): Response {
  return jsonResponse({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] })
}

/**
 * Route `fetch` by API path, for screens that make more than one request. An unrouted path
 * fails the test loudly rather than answering with something plausible.
 */
export function routeFetch(routes: Record<string, () => Response | Promise<Response>>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = new URL(url, 'http://localhost').pathname
    const respond = routes[path]
    if (!respond) throw new Error(`unrouted fetch in test: ${path}`)
    return respond()
  })
}
