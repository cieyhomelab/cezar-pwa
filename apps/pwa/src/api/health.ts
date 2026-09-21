import { apiFetch } from './http.ts'
import type { HealthResponse } from '@cezar-pwa/cezar-contract/contract'

/** Query key, per CLAUDE.md → "Klucze query". */
export const HEALTH_QUERY_KEY = ['health'] as const

/**
 * The session probe (`docs/CEZAR_API.md` § 1a — "Tania sonda stanu sesji").
 *
 * With a session it answers JSON carrying the instance's version; without one
 * the gateway refuses it exactly as it refuses every other path. It is the
 * cheapest request on the surface and it carries no task data, which makes it
 * the right thing to ask before showing anything.
 */
export function fetchHealth(options?: { signal?: AbortSignal }): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/api/v1/health', {
    signal: options?.signal,
    // The probe gates the whole screen, so it must fail visibly rather than
    // hang: half the default budget.
    timeoutMs: 5_000,
  })
}

export function healthQueryOptions() {
  return {
    queryKey: HEALTH_QUERY_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchHealth({ signal }),
    // No retries: a refusal is a stable answer, not a blip, and three silent
    // attempts would only delay the "Connect to Cezar" screen by seconds the
    // operator spends looking at a spinner. Recovery is explicit instead — the
    // retry button and the visibility re-probe in `useSession`.
    retry: false,
    staleTime: 30_000,
  }
}
