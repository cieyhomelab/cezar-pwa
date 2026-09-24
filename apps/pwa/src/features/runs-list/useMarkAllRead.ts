import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { HEALTH_QUERY_KEY } from '../../api/health.ts'
import { AuthRequiredError } from '../../api/http.ts'
import { markProjectRead } from '../../api/run.ts'
import { RUNS_INDEX_QUERY_KEY } from '../../api/runs-index.ts'
import type { ReadAllPlan } from '../../domain/read-all.ts'
import { actionFailureMessage } from '../run/useRunActions.ts'

export interface ReadAllFailure {
  projectId: string
  /** In words, Cezar's own reason verbatim (FR-032). */
  message: string
}

export interface ReadAllOutcome {
  /** Runs Cezar reports it marked read, summed over the projects that answered. */
  read: number
  /** One entry per project whose sweep failed, in the order they were called. */
  failures: ReadAllFailure[]
}

export interface MarkAllRead {
  /**
   * The plan the operator is being asked about, frozen at the first tap (#67): the confirmation
   * names these projects, and these are the ones called — not whatever the stream has made of
   * the list since.
   */
  confirming?: ReadAllPlan
  busy: boolean
  outcome?: ReadAllOutcome
  ask: (plan: ReadAllPlan) => void
  back: () => void
  confirm: () => Promise<void>
}

/**
 * #67: clear the unread markers of the tasks on screen with one confirmation. Cezar's sweep is
 * per project, so one call goes to each project in view (`readAllPlan`), all at once. They
 * settle independently: a project that fails is named with its reason and keeps its markers,
 * which is the truth, and the others are done. Nothing is retried — the button is still there
 * for the projects that still have unread tasks.
 *
 * Nothing is written into the caches optimistically. The server stamps `seenAt`, the records ride
 * the `run` SSE event into the list, and the index and any open task are re-asked after the
 * attempt in case the stream is not live. The in-flight state lasts until that re-ask lands, so
 * the markers are gone when the button comes back.
 */
export function useMarkAllRead(): MarkAllRead {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<ReadAllPlan>()
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<ReadAllOutcome>()
  const inFlight = useRef(false)

  const confirm = useCallback(
    async () => {
      if (inFlight.current || confirming === undefined) return
      const { projects } = confirming
      inFlight.current = true
      setBusy(true)
      setOutcome(undefined)
      const settled = await Promise.allSettled(projects.map((projectId) => markProjectRead(projectId)))
      let read = 0
      const failures: ReadAllFailure[] = []
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') read += result.value.read
        else failures.push({ projectId: projects[index] as string, message: actionFailureMessage(result.reason) })
      })
      if (settled.some((result) => result.status === 'rejected' && result.reason instanceof AuthRequiredError)) {
        void queryClient.invalidateQueries({ queryKey: HEALTH_QUERY_KEY })
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: RUNS_INDEX_QUERY_KEY }),
        // Prefix match: a task opened earlier holds its own copy of `seenAt`.
        queryClient.invalidateQueries({ queryKey: ['run'] }),
      ]).catch(() => undefined)
      inFlight.current = false
      setConfirming(undefined)
      setBusy(false)
      setOutcome({ read, failures })
    },
    [confirming, queryClient],
  )

  return {
    ...(confirming ? { confirming } : {}),
    busy,
    ...(outcome ? { outcome } : {}),
    ask: useCallback((plan: ReadAllPlan) => {
      setOutcome(undefined)
      setConfirming(plan)
    }, []),
    back: useCallback(() => setConfirming(undefined), []),
    confirm,
  }
}
