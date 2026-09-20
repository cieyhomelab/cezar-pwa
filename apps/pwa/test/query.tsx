import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
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

export function renderWithQuery(ui: ReactElement, client = createTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
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
