import type { GithubMergeMethod } from '@cezar-pwa/cezar-contract/contract'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { HEALTH_QUERY_KEY } from '../../api/health.ts'
import { AuthRequiredError, TimeoutError } from '../../api/http.ts'
import { fetchMergeState, mergePullRequest, mergeStateQueryKey } from '../../api/merge.ts'
import { invalidateRun } from '../../api/run.ts'
import { RUNS_INDEX_QUERY_KEY } from '../../api/runs-index.ts'
import { en } from '../../i18n/en.ts'
import { actionFailureMessage } from './useRunActions.ts'

export interface MergeAttempt {
  method: GithubMergeMethod
  headSha: string
  override: boolean
}

export interface MergeActions {
  /** The merge (or a refresh) in flight. Every control of the panel waits for it. */
  pending?: 'merge' | 'refresh'
  /** The merge is behind a confirmation naming the PR (brief R03): the first tap only asks. */
  confirming: boolean
  /**
   * The head the confirmation was opened on. The merge names this one, never a head a later poll
   * brought in, so a push while the operator reads the confirmation is refused, not merged unseen.
   */
  confirmedHead?: string
  /** The last failure in words, Cezar's or GitHub's reason verbatim (FR-032). */
  error?: string
  notice?: string
  ask: (headSha: string) => void
  back: () => void
  refresh: () => Promise<void>
  merge: (attempt: MergeAttempt) => Promise<void>
}

/**
 * S-19 (#69): merging the task's pull request, and asking GitHub again.
 *
 * Never optimistic. Whatever the answer — merged, refused, timed out — the merge state is re-read
 * with `refresh=1`, past the server's 15-second cache, and that answer is what the panel shows.
 * Nothing is retried: a timed-out merge may already have happened. The task and the list are
 * re-asked too, because a merged PR changes the reference chip they show.
 */
export function useMerge(projectId: string, runId: string, number: number): MergeActions {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<MergeActions['pending']>()
  const [confirming, setConfirming] = useState(false)
  const [confirmedHead, setConfirmedHead] = useState<string>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const inFlight = useRef(false)

  const reread = useCallback(async () => {
    const key = mergeStateQueryKey(projectId, number)
    await queryClient.cancelQueries({ queryKey: key })
    try {
      queryClient.setQueryData(key, await fetchMergeState(projectId, number, { refresh: true }))
    } catch {
      // The panel keeps its last answer and its own query reports the failure on the next read.
      void queryClient.invalidateQueries({ queryKey: key })
    }
  }, [projectId, number, queryClient])

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setError(undefined)
    setNotice(undefined)
    setPending('refresh')
    try {
      await reread()
    } finally {
      inFlight.current = false
      setPending(undefined)
    }
  }, [reread])

  const merge = useCallback(
    async ({ method, headSha, override }: MergeAttempt) => {
      if (inFlight.current) return
      inFlight.current = true
      setError(undefined)
      setNotice(undefined)
      setPending('merge')
      try {
        await mergePullRequest(projectId, number, {
          method,
          expectedHeadSha: headSha,
          ...(override ? { overrideRules: true as const } : {}),
        })
        setConfirming(false)
        setNotice(en.run.merge.merged(number))
      } catch (failure) {
        setConfirming(false)
        setError(failure instanceof TimeoutError ? en.run.merge.failed.timeout : actionFailureMessage(failure))
        if (failure instanceof AuthRequiredError) void queryClient.invalidateQueries({ queryKey: HEALTH_QUERY_KEY })
      } finally {
        await reread()
        inFlight.current = false
        setPending(undefined)
        void invalidateRun(queryClient, projectId, runId)
        void queryClient.invalidateQueries({ queryKey: RUNS_INDEX_QUERY_KEY })
      }
    },
    [projectId, runId, number, queryClient, reread],
  )

  return {
    ...(pending ? { pending } : {}),
    confirming,
    ...(confirming && confirmedHead !== undefined ? { confirmedHead } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(notice !== undefined ? { notice } : {}),
    ask: useCallback((headSha: string) => {
      setError(undefined)
      setNotice(undefined)
      setConfirmedHead(headSha)
      setConfirming(true)
    }, []),
    back: useCallback(() => setConfirming(false), []),
    refresh,
    merge,
  }
}
