import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { HEALTH_QUERY_KEY } from '../../api/health.ts'
import { ApiError, AuthRequiredError, NetworkError, TimeoutError } from '../../api/http.ts'
import {
  applyRunFlag,
  cancelRun,
  continueRun,
  createDraftPr,
  finishRun,
  invalidateRun,
  setRunArchived,
  setRunPinned,
} from '../../api/run.ts'
import type { ActionRun, RunActionId } from '../../domain/run-actions.ts'
import { pl } from '../../i18n/pl.ts'

export interface RunActions {
  /** The action in flight. Every action is disabled until it settles (FR-032). */
  pending?: RunActionId
  /** The last failure, in words. Cleared by the next action. */
  error?: string
  /** What a successful action did, when the record alone would not say it. */
  notice?: string
  /** Cancel is behind a confirmation (FR-025): the first tap only asks. */
  confirmingCancel: boolean
  askCancel: () => void
  keep: () => void
  run: (action: RunActionId) => Promise<void>
}

/** A failure in the operator's language. Cezar's own reason is kept verbatim (FR-032). */
export function actionFailureMessage(error: unknown): string {
  const failed = pl.run.actions.failed
  if (error instanceof AuthRequiredError) return failed.auth
  if (error instanceof TimeoutError) return failed.timeout
  if (error instanceof NetworkError) return failed.network
  if (error instanceof ApiError) return failed.refused(error.message)
  return failed.refused(error instanceof Error ? error.message : String(error))
}

/**
 * S-08: the task's own actions (FR-025 to FR-029), one at a time, each showing it is in flight
 * and, on failure, the reason the server gave (FR-032).
 *
 * After every attempt the run, its history and the list are re-asked, as after a send (S-07): a
 * cancel, finish, continue or draft PR moves the status, and the stream may not be open to carry
 * it. A pin or archive answer is written into the caches first, flag only, so the button flips
 * on the answer rather than on the refetch.
 *
 * Nothing is retried. A timed-out write may already have happened, and the operator is told that
 * instead of a second cancel or a second draft PR being sent for them.
 */
export function useRunActions(projectId: string, runId: string, run: ActionRun | undefined): RunActions {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<RunActionId>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const inFlight = useRef(false)
  // The flags toggle off the record the operator is looking at when they tap.
  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
  }, [run])

  const perform = useCallback(
    async (action: RunActionId): Promise<string | undefined> => {
      const done = pl.run.actions.done
      const current = runRef.current
      switch (action) {
        case 'cancel': {
          const answer = await cancelRun(projectId, runId)
          return answer.cancelled ? done.cancel : done.alreadySettled
        }
        case 'finish':
          await finishRun(projectId, runId)
          return current?.status === 'review' ? done.accepted : done.finished
        case 'draftPr': {
          const answer = await createDraftPr(projectId, runId)
          return answer.dryRun ? done.draftPrDryRun : done.draftPr
        }
        case 'continue':
          await continueRun(projectId, runId)
          return done.continued
        case 'pin': {
          const pinned = current?.pinned !== true
          await setRunPinned(projectId, runId, pinned)
          applyRunFlag(queryClient, projectId, runId, { pinned })
          return undefined
        }
        case 'archive': {
          const archived = current?.archived !== true
          await setRunArchived(projectId, runId, archived)
          applyRunFlag(queryClient, projectId, runId, { archived })
          return archived ? done.archived : undefined
        }
        default:
          return undefined
      }
    },
    [projectId, runId, queryClient],
  )

  const runAction = useCallback(
    async (action: RunActionId): Promise<void> => {
      if (inFlight.current) return
      inFlight.current = true
      setConfirmingCancel(false)
      setPending(action)
      setError(undefined)
      setNotice(undefined)
      try {
        setNotice(await perform(action))
      } catch (failure) {
        setError(actionFailureMessage(failure))
        // A lapsed session hands the screen to `AuthGate`, as a failed read does.
        if (failure instanceof AuthRequiredError) void queryClient.invalidateQueries({ queryKey: HEALTH_QUERY_KEY })
      } finally {
        inFlight.current = false
        setPending(undefined)
        // Success or a refusal alike: the record may have moved (a 409 means it certainly did).
        void invalidateRun(queryClient, projectId, runId)
      }
    },
    [perform, projectId, runId, queryClient],
  )

  return {
    ...(pending !== undefined ? { pending } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(notice !== undefined ? { notice } : {}),
    confirmingCancel,
    askCancel: useCallback(() => {
      setError(undefined)
      setNotice(undefined)
      setConfirmingCancel(true)
    }, []),
    keep: useCallback(() => setConfirmingCancel(false), []),
    run: runAction,
  }
}
