import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import {
  type AutomationActionId,
  automationLogQueryKey,
  automationsQueryKey,
  enableAutomation,
  pauseAutomation,
  runAutomation,
} from '../../api/automations.ts'
import { HEALTH_QUERY_KEY } from '../../api/health.ts'
import { AuthRequiredError } from '../../api/http.ts'
import { RUNS_INDEX_QUERY_KEY } from '../../api/runs-index.ts'
import { en } from '../../i18n/en.ts'
import { actionFailureMessage } from '../run/useRunActions.ts'

export interface AutomationOutcome {
  automationId: string
  /** The last failure in words, Cezar's own reason verbatim (FR-032). */
  error?: string
  notice?: string
  /** The task a Run now started. */
  runId?: string
}

export interface AutomationActions {
  /** The action in flight. Every button on the screen waits for it. */
  pending?: { automationId: string; action: AutomationActionId }
  /** Run now is behind a confirmation (brief R03): the first tap only asks. */
  confirmingRun?: string
  outcome?: AutomationOutcome
  askRun: (automationId: string) => void
  back: () => void
  perform: (automationId: string, name: string, action: AutomationActionId) => Promise<void>
}

/**
 * S-20 (#70): Pause, Enable and Run now, one at a time, each showing it is in flight and, on
 * failure, the reason Cezar gave. Nothing is retried: a timed-out Run now may already have
 * started a task, which the operator is told instead of a second one being launched.
 *
 * After every attempt the list and the log are re-asked (a refusal usually means the definition
 * moved under the operator), and after a Run now the task list too.
 */
export function useAutomationActions(projectId: string): AutomationActions {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<AutomationActions['pending']>()
  const [confirmingRun, setConfirmingRun] = useState<string>()
  const [outcome, setOutcome] = useState<AutomationOutcome>()
  const inFlight = useRef(false)

  const perform = useCallback(
    async (automationId: string, name: string, action: AutomationActionId) => {
      if (inFlight.current) return
      inFlight.current = true
      setConfirmingRun(undefined)
      setOutcome(undefined)
      setPending({ automationId, action })
      const done = en.automations.done
      try {
        switch (action) {
          case 'pause':
            await pauseAutomation(projectId, automationId)
            setOutcome({ automationId, notice: done.paused(name) })
            break
          case 'enable':
            await enableAutomation(projectId, automationId)
            setOutcome({ automationId, notice: done.enabled(name) })
            break
          case 'run': {
            const answer = await runAutomation(projectId, automationId)
            const runId = typeof answer?.runId === 'string' ? answer.runId : undefined
            setOutcome({ automationId, notice: done.started(name), ...(runId ? { runId } : {}) })
            break
          }
          default:
            break
        }
      } catch (failure) {
        setOutcome({ automationId, error: actionFailureMessage(failure) })
        if (failure instanceof AuthRequiredError) void queryClient.invalidateQueries({ queryKey: HEALTH_QUERY_KEY })
      } finally {
        inFlight.current = false
        setPending(undefined)
        void queryClient.invalidateQueries({ queryKey: automationsQueryKey(projectId) })
        void queryClient.invalidateQueries({ queryKey: automationLogQueryKey(projectId) })
        if (action === 'run') void queryClient.invalidateQueries({ queryKey: RUNS_INDEX_QUERY_KEY })
      }
    },
    [projectId, queryClient],
  )

  return {
    ...(pending ? { pending } : {}),
    ...(confirmingRun ? { confirmingRun } : {}),
    ...(outcome ? { outcome } : {}),
    askRun: useCallback((automationId: string) => {
      setOutcome(undefined)
      setConfirmingRun(automationId)
    }, []),
    back: useCallback(() => setConfirmingRun(undefined), []),
    perform,
  }
}
