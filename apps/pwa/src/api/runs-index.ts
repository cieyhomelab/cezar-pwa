import type { RunsIndexResponse } from '@cezar-pwa/cezar-contract/contract'
import { ApiError, apiFetch } from './http.ts'

/** Query key, per CLAUDE.md → "Klucze query". */
export const RUNS_INDEX_QUERY_KEY = ['runs-index'] as const

/**
 * Until S-04 brings the event stream, the list re-asks this often while it is on screen.
 * TanStack pauses the interval while the page is hidden, so a phone in a pocket costs nothing.
 */
export const RUNS_INDEX_REFETCH_MS = 30_000

/**
 * Every task across every registered project (FR-007): `GET /api/v1/workspace/runs-index`,
 * newest first, capped per project (`docs/CEZAR_API.md` § 2).
 *
 * Workspace-level, so it has no `/p/:projectId/` variant — rule 2's project prefix applies to
 * project routes, and this is not one.
 */
export async function fetchRunsIndex(options?: {
  signal?: AbortSignal
}): Promise<RunsIndexResponse> {
  const body = await apiFetch<Partial<RunsIndexResponse> | null>('/api/v1/workspace/runs-index', {
    signal: options?.signal,
  })
  // Not validated with the contract's schema — its enums are closed and the vocabulary only
  // grows (CLAUDE.md rule 5), so a new status must reach the list as one odd row, not as a
  // failed parse. Only the container is checked, and a missing one is an ERROR rather than an
  // empty list: an empty list would say "nothing is waiting", which nobody can vouch for.
  if (!Array.isArray(body?.runs)) {
    throw new ApiError('Cezar odpowiedział w nieznanym formacie', 200)
  }
  return {
    runs: body.runs,
    referenceStatuses: body?.referenceStatuses ?? {},
    perProjectLimit: typeof body?.perProjectLimit === 'number' ? body.perProjectLimit : 0,
    truncated: Array.isArray(body?.truncated) ? body.truncated : [],
  }
}

export function runsIndexQueryOptions() {
  return {
    queryKey: RUNS_INDEX_QUERY_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchRunsIndex({ signal }),
    // FR-011: coming back to the app always re-asks, however fresh the cache thinks it is —
    // iOS may have frozen the app for hours, and the answer it holds is from before that.
    refetchOnWindowFocus: 'always' as const,
    refetchOnReconnect: 'always' as const,
    refetchInterval: RUNS_INDEX_REFETCH_MS,
    // No silent retries: a refusal is a stable answer, and a failed refresh must reach the
    // screen as "this list is from HH:MM" at once rather than after a hidden second attempt.
    // The interval above and the retry button are the recovery.
    retry: false,
  }
}
