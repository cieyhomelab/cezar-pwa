import type { ChangedFile, ChangesPayload } from '@cezar-pwa/cezar-contract/contract'
import { ApiError, apiFetch } from './http.ts'
import { RUN_REFETCH_MS } from './run.ts'

/**
 * S-09: what a task changed, per file (FR-031). `GET /api/v1/p/:projectId/runs/:id/changes` is
 * the structured sibling of `/diff`: `{ files: ChangedFile[], stat, repointedHead? }`, measured
 * against the same base the cockpit's Changes tab uses (`resolveTaskDiffBase`). `/diff` answers
 * one text blob, and for a run without a worktree it answers that sentence as a 200 — the phone
 * would render it as a diff. `/changes` answers that case as a `409` with the reason instead.
 *
 * As everywhere else, the contract's schemas are not run on the answer (rule 5: its `status` enum
 * is closed). Only what the screen reads is checked: `files` must be an array, or the answer is
 * an error rather than "no changes". A file without a path or a patch costs itself, not the list.
 */

export const changesQueryKey = (projectId: string, runId: string) => ['changes', projectId, runId] as const

/** A diff of a big task is a big answer: longer than a read's 10 s, still short of a write's. */
export const CHANGES_TIMEOUT_MS = 15_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFile(value: unknown): value is ChangedFile {
  return isRecord(value) && typeof value.path === 'string' && typeof value.patch === 'string'
}

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

export async function fetchChanges(projectId: string, runId: string, signal?: AbortSignal): Promise<ChangesPayload> {
  const body = await apiFetch<unknown>(
    `/api/v1/p/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/changes`,
    { signal, timeoutMs: CHANGES_TIMEOUT_MS },
  )
  if (!isRecord(body) || !Array.isArray(body.files)) {
    throw new ApiError('unexpected response shape', 200, 'unexpected-shape')
  }
  const files = body.files.filter(isFile).map((file) => ({
    ...file,
    adds: count(file.adds),
    dels: count(file.dels),
    binary: file.binary === true,
  }))
  const repointed = body.repointedHead
  return {
    files,
    // Summed here rather than trusted: the header must agree with the rows under it.
    stat: {
      files: files.length,
      adds: files.reduce((sum, file) => sum + file.adds, 0),
      dels: files.reduce((sum, file) => sum + file.dels, 0),
    },
    ...(isRecord(repointed) && typeof repointed.headBranch === 'string' && typeof repointed.taskBranch === 'string'
      ? { repointedHead: { headBranch: repointed.headBranch, taskBranch: repointed.taskBranch } }
      : {}),
  }
}

/**
 * The diff is re-read on the list's terms: on coming back to the app, never silently retried.
 * While the agent is still working it moves, so it is re-asked on the task screen's 30 s. Once
 * the task has settled it does not, and the interval stops.
 */
export function changesQueryOptions(projectId: string, runId: string, active: boolean) {
  return {
    queryKey: changesQueryKey(projectId, runId),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchChanges(projectId, runId, signal),
    refetchOnWindowFocus: 'always' as const,
    refetchOnReconnect: 'always' as const,
    refetchInterval: active ? RUN_REFETCH_MS : (false as const),
    retry: false,
  }
}
