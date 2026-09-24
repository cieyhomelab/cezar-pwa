import type { GroupResponse, PickVariantResponse } from '@cezar-pwa/cezar-contract/contract'
import { isRunActive } from '../domain/answer.ts'
import { CHANGES_TIMEOUT_MS } from './changes.ts'
import { ApiError, apiFetch } from './http.ts'
import { RUN_REFETCH_MS, WRITE_TIMEOUT_MS } from './run.ts'

/**
 * S-21: a task's variant group (#71). Both routes are project routes (rule 2):
 *
 *  - `GET /api/v1/p/:projectId/groups/:groupId` — every run sharing the `groupId`, with its
 *    status, cost and the `git diff --stat` text of its worktree. `404` once no run carries it.
 *  - `POST /api/v1/p/:projectId/groups/:groupId/pick` `{ runId }` — keep that run. The others are
 *    cancelled if alive, archived, and their worktrees and branches removed. `409` while the kept
 *    run is still active, `404` for a run outside the group.
 *
 * Only the container is checked at runtime, as everywhere (rule 5); the rows are read field by
 * field in `domain/variants.ts`.
 */

export const groupQueryKey = (projectId: string, groupId: string) => ['group', projectId, groupId] as const

const groupPath = (projectId: string, groupId: string) =>
  `/api/v1/p/${encodeURIComponent(projectId)}/groups/${encodeURIComponent(groupId)}`

export async function fetchGroup(projectId: string, groupId: string, signal?: AbortSignal): Promise<GroupResponse> {
  // The server runs `git diff --stat` in every variant's worktree: a diff read's timeout, not a read's.
  const body = await apiFetch<unknown>(groupPath(projectId, groupId), { signal, timeoutMs: CHANGES_TIMEOUT_MS })
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { runs?: unknown }).runs)) {
    throw new ApiError('unexpected response shape', 200, 'unexpected-shape')
  }
  return body as GroupResponse
}

/**
 * Re-read on the task screen's terms: every 30 s while a variant may still be moving. Once every
 * variant has settled nothing changes on its own, and the interval stops.
 */
export function groupQueryOptions(projectId: string, groupId: string) {
  return {
    queryKey: groupQueryKey(projectId, groupId),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchGroup(projectId, groupId, signal),
    refetchOnWindowFocus: 'always' as const,
    refetchOnReconnect: 'always' as const,
    refetchInterval: ({ state }: { state: { data?: GroupResponse } }) =>
      state.data?.runs.some((run) => typeof run?.status === 'string' && isRunActive(run.status))
        ? RUN_REFETCH_MS
        : (false as const),
    retry: false,
  }
}

/** Not retried: a timed-out pick may already have archived the others. */
export function pickVariant(projectId: string, groupId: string, runId: string): Promise<PickVariantResponse> {
  return apiFetch<PickVariantResponse>(`${groupPath(projectId, groupId)}/pick`, {
    method: 'POST',
    body: { runId },
    timeoutMs: WRITE_TIMEOUT_MS,
  })
}
