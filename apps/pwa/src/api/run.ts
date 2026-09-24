import type {
  ApiRun,
  CancelResponse,
  ContinueResponse,
  CreatePrResponse,
  EditQueuedMessageResponse,
  FinishResponse,
  MarkAllReadResponse,
  MessageResponse,
  QueuedMessage,
  RemoveQueuedMessageResponse,
  RunEvent,
  RunHistoryContext,
  RunHistoryPage,
  RunsIndexResponse,
} from '@cezar-pwa/cezar-contract/contract'
import type { QueryClient } from '@tanstack/react-query'
import { carryOver } from '../domain/live-transcript.ts'
import { dropQueuedMessage, replaceQueuedMessage } from '../domain/queued-messages.ts'
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
 * While the task's stream is not live, an open task re-asks this often (the S-05 behaviour).
 * TanStack pauses the interval while the page is hidden.
 */
export const RUN_REFETCH_MS = 30_000

/** While it is live, the record is re-asked only as a safety net for anything the stream cannot
 *  carry (the list's 5 min, S-04). The transcript is not re-asked at all: the stream replays. */
export const RUN_LIVE_REFETCH_MS = 5 * 60_000

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
    throw new ApiError('unexpected response shape', 200, 'unexpected-shape')
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
    throw new ApiError('unexpected response shape', 200, 'unexpected-shape')
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
    throw new ApiError('unexpected response shape', 200, 'unexpected-shape')
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

/** `live`: the task's event stream is open (S-06). */
export function runQueryOptions(projectId: string, runId: string, live = false) {
  return {
    queryKey: runQueryKey(projectId, runId),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchRun(projectId, runId, signal),
    ...liveish,
    refetchInterval: live ? RUN_LIVE_REFETCH_MS : RUN_REFETCH_MS,
  }
}

/**
 * The newest page, extended in the cache by the stream. A refetch landing over it keeps whatever
 * the stream delivered past it (`carryOver`). While live, nothing re-asks it on its own: coming
 * back to the app reconnects the stream, which replays the gap from the page's `asOfSeq`.
 */
export function historyQueryOptions(projectId: string, runId: string, live = false) {
  return {
    queryKey: historyQueryKey(projectId, runId),
    queryFn: async ({ signal, client }: { signal: AbortSignal; client: QueryClient }) =>
      carryOver(
        await fetchHistory(projectId, runId, signal),
        client.getQueryData<RunHistoryPage>(historyQueryKey(projectId, runId)),
      ),
    ...liveish,
    refetchOnWindowFocus: live ? false : ('always' as const),
    refetchOnReconnect: live ? false : ('always' as const),
    refetchInterval: live ? (false as const) : RUN_REFETCH_MS,
  }
}

export function historyContextQueryOptions(projectId: string, runId: string, live = false) {
  return {
    queryKey: historyContextQueryKey(projectId, runId),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchHistoryContext(projectId, runId, signal),
    ...liveish,
    // The pinned plan also folds the page, and the stream brings every new `plan.updated` there.
    refetchOnWindowFocus: live ? false : ('always' as const),
    refetchOnReconnect: live ? false : ('always' as const),
    refetchInterval: live ? (false as const) : RUN_REFETCH_MS,
  }
}

/** `POST …/read` (FR-020). Bodyless. It answers with the whole record. */
export async function markRunRead(projectId: string, runId: string): Promise<ApiRun> {
  return apiFetch<ApiRun>(`${runBase(projectId, runId)}/read`, { method: 'POST' })
}

/**
 * `POST /api/v1/p/:projectId/runs/read-all` (#67): stamps `seenAt` on every unread finished run
 * of the project and answers how many. Bodyless. The stamped records arrive again over the
 * `run` SSE event; there is no bulk undo (per task: `…/unread`).
 */
export async function markProjectRead(projectId: string): Promise<MarkAllReadResponse> {
  const body = await apiFetch<unknown>(`/api/v1/p/${encodeURIComponent(projectId)}/runs/read-all`, {
    method: 'POST',
    timeoutMs: WRITE_TIMEOUT_MS,
  })
  if (!isRecord(body) || typeof body.read !== 'number') {
    throw new ApiError('unexpected response shape', 200, 'unexpected-shape')
  }
  return { read: body.read }
}

/**
 * `POST …/messages` (S-07): text into the run's session. The server answers `delivered` (a live
 * session took it), `queued` (folded into a queued run's prompt) or `deferred` (buffered while
 * the session starts). A closed session is `409 session closed`.
 *
 * The timeout is longer than a read's: the server checks the provider before delivering, and a
 * timed-out write may still have landed, which the operator is told rather than a retry being
 * made for them.
 */
export async function sendRunMessage(projectId: string, runId: string, text: string): Promise<MessageResponse> {
  return apiFetch<MessageResponse>(`${runBase(projectId, runId)}/messages`, {
    method: 'POST',
    body: { text },
    timeoutMs: WRITE_TIMEOUT_MS,
  })
}

/**
 * `POST …/continue` with the text as the opening prompt (S-07): the route an answer takes once
 * the session that asked has closed. No runner or model rides along, so the server reopens the
 * run on its own engine, as the cockpit's ask card does.
 */
export async function continueRunWith(projectId: string, runId: string, text: string): Promise<ContinueResponse> {
  return apiFetch<ContinueResponse>(`${runBase(projectId, runId)}/continue`, {
    method: 'POST',
    body: { text },
    timeoutMs: WRITE_TIMEOUT_MS,
  })
}

/**
 * `PATCH …/queued-messages/:msgId` (#66): new text for a message stacked onto a queued task. Its
 * attachments are left as they are (no `images` key). The server checks the text against the
 * prompt's length limit and answers with the replaced entry. `404` means the message is no
 * longer on the stack, `409 run already started` that the task took it.
 */
export async function editQueuedMessage(
  projectId: string,
  runId: string,
  msgId: string,
  text: string,
): Promise<EditQueuedMessageResponse> {
  const body = await apiFetch<unknown>(`${runBase(projectId, runId)}/queued-messages/${encodeURIComponent(msgId)}`, {
    method: 'PATCH',
    body: { text },
    timeoutMs: WRITE_TIMEOUT_MS,
  })
  if (!isRecord(body) || !isRecord(body.message) || typeof body.message.id !== 'string' || typeof body.message.text !== 'string') {
    throw new ApiError('unexpected response shape', 200, 'unexpected-shape')
  }
  return body as EditQueuedMessageResponse
}

/** `DELETE …/queued-messages/:msgId` (#66): `{ removed: true }`, with the same 404 and 409. */
export function removeQueuedMessage(projectId: string, runId: string, msgId: string): Promise<RemoveQueuedMessageResponse> {
  return apiFetch<RemoveQueuedMessageResponse>(
    `${runBase(projectId, runId)}/queued-messages/${encodeURIComponent(msgId)}`,
    { method: 'DELETE', timeoutMs: WRITE_TIMEOUT_MS },
  )
}

/**
 * Write an edit or removal into the run's record: that one stack entry only, for the reason
 * `applyReadReceipt` gives below. The `run` SSE event carries the whole stack a moment later.
 */
export function applyQueuedMessage(
  queryClient: QueryClient,
  projectId: string,
  runId: string,
  change: { replaced: QueuedMessage } | { removed: string },
): void {
  queryClient.setQueryData<ApiRun>(runQueryKey(projectId, runId), (run) => {
    if (!run?.queuedMessages) return run
    const next =
      'replaced' in change
        ? replaceQueuedMessage(run.queuedMessages, change.replaced)
        : dropQueuedMessage(run.queuedMessages, change.removed)
    return next === run.queuedMessages ? run : { ...run, queuedMessages: [...next] }
  })
}

export const WRITE_TIMEOUT_MS = 20_000

/**
 * S-08's writes (FR-025 to FR-029). Each is bodyless or takes one flag, and each refusal is a
 * `{ error }` the screen shows verbatim (FR-032). Like the sends above, none is retried: a
 * timed-out cancel or draft PR may already have happened.
 */
const write = <T>(projectId: string, runId: string, action: string, body?: unknown): Promise<T> =>
  apiFetch<T>(`${runBase(projectId, runId)}/${action}`, {
    method: 'POST',
    ...(body === undefined ? {} : { body }),
    timeoutMs: WRITE_TIMEOUT_MS,
  })

/** `POST …/cancel`. `{ cancelled: false }` is a 200 too: the run had already settled. */
export function cancelRun(projectId: string, runId: string): Promise<CancelResponse> {
  return write(projectId, runId, 'cancel')
}

/** `POST …/finish`: accept a review, or close a waiting session. `409 no open session` otherwise. */
export function finishRun(projectId: string, runId: string): Promise<FinishResponse> {
  return write(projectId, runId, 'finish')
}

/** `POST …/continue` with no body: reopen the last session on the run's own engine. */
export function continueRun(projectId: string, runId: string): Promise<ContinueResponse> {
  return write(projectId, runId, 'continue')
}

/**
 * `POST …/pr` (201): push the branch and open a draft PR. The run then completes as `done` with
 * `pullRequestUrl` set. `409` carries the forge's reason, `400` a run without a worktree.
 */
export function createDraftPr(projectId: string, runId: string): Promise<CreatePrResponse> {
  return write(projectId, runId, 'pr')
}

/** `POST …/pin`: `{}` pins, `{ pinned: false }` unpins. Answers with the record. */
export function setRunPinned(projectId: string, runId: string, pinned: boolean): Promise<ApiRun> {
  return write(projectId, runId, 'pin', pinned ? {} : { pinned: false })
}

/** `POST …/archive`: `{}` archives, `{ archived: false }` restores. Answers with the record. */
export function setRunArchived(projectId: string, runId: string, archived: boolean): Promise<ApiRun> {
  return write(projectId, runId, 'archive', archived ? {} : { archived: false })
}

/**
 * Write a pin or archive answer into the caches: that flag only, for the reason
 * `applyReadReceipt` gives below. The list hides archived rows (FR-008), so the index row takes
 * `archived` at once. It has no `pinned` to take.
 */
export function applyRunFlag(
  queryClient: QueryClient,
  projectId: string,
  runId: string,
  flag: { pinned: boolean } | { archived: boolean },
): void {
  queryClient.setQueryData<ApiRun>(runQueryKey(projectId, runId), (run) => (run ? { ...run, ...flag } : run))
  if (!('archived' in flag)) return
  queryClient.setQueryData<RunsIndexResponse>(RUNS_INDEX_QUERY_KEY, (index) =>
    index
      ? {
          ...index,
          runs: index.runs.map((run) =>
            run.projectId === projectId && run.id === runId ? { ...run, archived: flag.archived } : run,
          ),
        }
      : index,
  )
}

/** After a write, every read of this run and the list are out of date. */
export function invalidateRun(queryClient: QueryClient, projectId: string, runId: string): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: runQueryKey(projectId, runId) }),
    // Prefix match: the page and its context.
    queryClient.invalidateQueries({ queryKey: historyQueryKey(projectId, runId) }),
    queryClient.invalidateQueries({ queryKey: RUNS_INDEX_QUERY_KEY }),
  ])
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
