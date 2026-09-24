import type {
  GithubMergeMethod,
  GithubMergeResponse,
  GithubPrMergeStateResponse,
} from '@cezar-pwa/cezar-contract/contract'
import { ApiError, apiFetch } from './http.ts'
import { RUN_REFETCH_MS, WRITE_TIMEOUT_MS } from './run.ts'

/**
 * S-19: merge a task's pull request from the phone (#69). Both routes are project routes (rule 2):
 *
 *  - `GET /api/v1/p/:projectId/github/prs/:number/merge-state[?refresh=1]` — always `200`; a forge
 *    the server cannot reach is `available: false` + `reason`. The server caches it for 15 s;
 *    `refresh=1` asks GitHub again. It carries the PR's checks, so the lighter
 *    `GET …/github/checks?prs=` (one glyph per PR) is not needed here.
 *  - `POST …/github/prs/:number/merge` `{ method, expectedHeadSha, overrideRules? }` → `200
 *    { merged: true, … }`. The server re-reads the state first and refuses (`409`, its reason
 *    verbatim) a moved head, a method no longer allowed, or a PR no longer eligible; `403`, `404`
 *    and `502` carry GitHub's refusal.
 *
 * Only the container is checked at runtime (rule 5); `domain/merge.ts` reads the rest.
 */

export const mergeStateQueryKey = (projectId: string, number: number) => ['merge-state', projectId, number] as const

const prPath = (projectId: string, number: number) =>
  `/api/v1/p/${encodeURIComponent(projectId)}/github/prs/${encodeURIComponent(String(number))}`

export async function fetchMergeState(
  projectId: string,
  number: number,
  options: { refresh?: boolean; signal?: AbortSignal } = {},
): Promise<GithubPrMergeStateResponse> {
  const query = options.refresh ? '?refresh=1' : ''
  const body = await apiFetch<unknown>(`${prPath(projectId, number)}/merge-state${query}`, {
    ...(options.signal ? { signal: options.signal } : {}),
  })
  if (typeof body !== 'object' || body === null || typeof (body as { available?: unknown }).available !== 'boolean') {
    throw new ApiError('unexpected response shape', 200, 'unexpected-shape')
  }
  return body as GithubPrMergeStateResponse
}

/** Merged or closed: nothing about the PR will change. */
function settled(data: GithubPrMergeStateResponse | undefined): boolean {
  const state = data?.available === true ? data.mergeState?.state : undefined
  return state === 'merged' || state === 'closed'
}

/**
 * Re-read while the screen is open, so a check finishing shows up. A merged or closed PR stops
 * being re-asked: nothing about it will change.
 */
export function mergeStateQueryOptions(projectId: string, number: number) {
  type Observed = { state: { data: GithubPrMergeStateResponse | undefined } }
  return {
    queryKey: mergeStateQueryKey(projectId, number),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchMergeState(projectId, number, { signal }),
    refetchOnWindowFocus: (query: Observed) => (settled(query.state.data) ? false : ('always' as const)),
    refetchOnReconnect: (query: Observed) => (settled(query.state.data) ? false : ('always' as const)),
    refetchInterval: (query: Observed) => (settled(query.state.data) ? false : RUN_REFETCH_MS),
    retry: false,
  }
}

export interface MergeRequest {
  method: GithubMergeMethod
  /** The head the operator saw. A push since then is refused rather than merged unseen. */
  expectedHeadSha: string
  overrideRules?: true
}

/** Not retried: a timed-out merge may already have happened. */
export function mergePullRequest(projectId: string, number: number, request: MergeRequest): Promise<GithubMergeResponse> {
  return apiFetch<GithubMergeResponse>(`${prPath(projectId, number)}/merge`, {
    method: 'POST',
    body: request,
    timeoutMs: WRITE_TIMEOUT_MS,
  })
}
