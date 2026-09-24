import type { RunHistoryPage } from '@cezar-pwa/cezar-contract/contract'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { fetchHistory, historyQueryKey } from '../../api/run.ts'
import { prependOlder } from '../../domain/live-transcript.ts'

export type OlderHistory = {
  /** The page before the held one can be asked for (`hasOlder` with a cursor). */
  available: boolean
  loading: boolean
  /** The last attempt failed; the screen offers a retry and the cockpit instead. */
  error: unknown
  /** Ask for the page before the held one. A no-op while one is on its way or none is left. */
  load: () => void
}

/**
 * FR-049: scrolling back past the newest page. Each older page is prepended to the page the
 * `['history', projectId, runId]` query holds (`prependOlder`), so the transcript still folds
 * from one list of raw lines, the stream keeps extending the same entry, and a refetch keeps
 * what was read back (`carryOver`).
 *
 * `beforePrepend` runs just before the cache write, while the screen still shows the shorter
 * transcript: the moment to note what the reader is looking at.
 *
 * Nothing retries on its own. A failure waits for the operator, like every read on this screen.
 */
export function useOlderHistory(
  projectId: string,
  runId: string,
  page: RunHistoryPage | undefined,
  beforePrepend: () => void,
): OlderHistory {
  const queryClient = useQueryClient()
  const cursor = page?.hasOlder === true ? page.olderCursor : undefined
  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: (from: string) => fetchHistory(projectId, runId, undefined, from),
    onSuccess: (older, from) => {
      const key = historyQueryKey(projectId, runId)
      const held = queryClient.getQueryData<RunHistoryPage>(key)
      if (held === undefined) return
      const next = prependOlder(held, older, from)
      if (next === held) return
      beforePrepend()
      queryClient.setQueryData(key, next)
    },
  })

  const load = useCallback(() => {
    if (cursor === undefined || isPending) return
    reset()
    mutate(cursor)
  }, [cursor, isPending, mutate, reset])

  return { available: cursor !== undefined, loading: isPending, error: error ?? undefined, load }
}
