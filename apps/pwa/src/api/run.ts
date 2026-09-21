import type {
  ApiRun,
  RunEvent,
  RunHistoryContext,
  RunHistoryPage,
  RunsIndexResponse,
} from '@cezar-pwa/cezar-contract/contract'
import type { QueryClient } from '@tanstack/react-query'
import { ApiError, apiFetch } from './http.ts'
import { RUNS_INDEX_QUERY_KEY } from './runs-index.ts'

/**
 * One task's record and the newest stretch of its transcript (S-05). All three reads are
 * project routes, so they always go through `/api/v1/p/:projectId/…` (CLAUDE.md rule 2).
 *
 * As with the index, nothing is parsed with the contract's schemas at runtime. Their enums are
 * closed and the vocabulary only grows (rule 5). Only the containers the screen iterates are
 * checked, and a missing one is an error rather than an empty transcript.
 */

/** Query keys, per CLAUDE.md → "Klucze query". The context rides under the history key. */
export const runQueryKey = (projectId: string, runId: string) => ['run', projectId, runId] as const
export const historyQueryKey = (projectId: string, runId: string) => ['history', projectId, runId] as const
export const historyContextQueryKey = (projectId: string, runId: string) =>
  ['history', projectId, runId, 'context'] as const

/**
 * Until S-06 streams the transcript, an open task re-asks this often while it is on screen.
 * TanStack pauses the interval while the page is hidden.
 */
export const RUN_REFETCH_MS = 30_000

function runBase(projectId: string, runId: string): string {
  return `/api/v1/p/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Lines the fold can use. Anything without the envelope costs itself, not the page. */
function envelopes(events: unknown[]): RunEvent[] {
  return events.filter(
    (event): event is RunEvent =>
      isRecord(event) && typeof event.seq === 'number' && typeof event.type === 'string',
  )
}

/** `GET /api/v1/p/:projectId/runs/:id`, the record plus its live `usage` sample. */
export async function fetchRun(projectId: string, runId: string, signal?: AbortSignal): Promise<ApiRun> {
  const body = await apiFetch<unknown>(runBase(projectId, runId), { signal })
  if (!isRecord(body) || typeof body.id !== 'string' || typeof body.status !== 'string') {
    throw new ApiError('Cezar odpowiedział w nieznanym formacie', 200)
  }
  return body as ApiRun
}

/** `GET …/history` without a cursor: the newest page (FR-015). Older pages are FR-049, parked. */
export async function fetchHistory(
  projectId: string,
  runId: string,
  signal?: AbortSignal,
): Promise<RunHistoryPage> {
  const body = await apiFetch<unknown>(`${runBase(projectId, runId)}/history`, { signal })
  if (!isRecord(body) || !Array.isArray(body.events)) {
    throw new ApiError('Cezar odpowiedział w nieznanym formacie', 200)
  }
  return {
    ...(body as RunHistoryPage),
    events: envelopes(body.events),
    hasOlder: body.hasOlder === true,
  }
}

/**
 * `GET …/history-context`: the latest plan snapshot, turn boundaries and open items, wherever
 * they sit in the file. It exists because the newest plan can be older than the newest page.
 */
export async function fetchHistoryContext(
  projectId: string,
  runId: string,
  signal?: AbortSignal,
): Promise<RunHistoryContext> {
  const body = await apiFetch<unknown>(`${runBase(projectId, runId)}/history-context`, { signal })
  if (!isRecord(body) || !Array.isArray(body.contextEvents)) {
    throw new ApiError('Cezar odpowiedział w nieznanym formacie', 200)
  }
  return {
    contextEvents: envelopes(body.contextEvents),
    asOfSeq: typeof body.asOfSeq === 'number' ? body.asOfSeq : 0,
  }
}

/** Shared by the three reads: coming back to the app always re-asks, and nothing retries
 *  silently (the same reasoning as `runsIndexQueryOptions`). */
const liveish = {
  refetchOnWindowFocus: 'always' as const,
  refetchOnReconnect: 'always' as const,
  refetchInterval: RUN_REFETCH_MS,
  retry: false,
}

export function runQueryOptions(projectId: string, runId: string) {
  return {
    queryKey: runQueryKey(projectId, runId),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchRun(projectId, runId, signal),
    ...liveish,
  }
}

export function historyQueryOptions(projectId: string, runId: string) {
  return {
    queryKey: historyQueryKey(projectId, runId),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchHistory(projectId, runId, signal),
    ...liveish,
  }
}

export function historyContextQueryOptions(projectId: string, runId: string) {
  return {
    queryKey: historyContextQueryKey(projectId, runId),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchHistoryContext(projectId, runId, signal),
    ...liveish,
  }
}

/** `POST …/read` (FR-020). Bodyless. It answers with the whole record. */
export async function markRunRead(projectId: string, runId: string): Promise<ApiRun> {
  return apiFetch<ApiRun>(`${runBase(projectId, runId)}/read`, { method: 'POST' })
}

/**
 * Write a receipt's answer into the caches: `seenAt` only. The answer is a snapshot from before
 * anything that changed while it was in flight, so writing it wholesale would revert those
 * fields until the next fetch. The cockpit's `useMarkRunSeen` learned this the hard way (see its
 * test, "takes only the receipt from the answer").
 */
export function applyReadReceipt(
  queryClient: QueryClient,
  projectId: string,
  runId: string,
  answer: Pick<ApiRun, 'seenAt'>,
): void {
  const seenAt = answer.seenAt
  if (typeof seenAt !== 'string') return
  queryClient.setQueryData<ApiRun>(runQueryKey(projectId, runId), (run) => (run ? { ...run, seenAt } : run))
  queryClient.setQueryData<RunsIndexResponse>(RUNS_INDEX_QUERY_KEY, (index) =>
    index
      ? {
          ...index,
          runs: index.runs.map((run) =>
            run.projectId === projectId && run.id === runId ? { ...run, seenAt } : run,
          ),
        }
      : index,
  )
}
