import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { groupQueryKey, pickVariant } from '../../api/groups.ts'
import { HEALTH_QUERY_KEY } from '../../api/health.ts'
import { AuthRequiredError } from '../../api/http.ts'
import { invalidateRun } from '../../api/run.ts'
import { en } from '../../i18n/en.ts'
import { actionFailureMessage } from './useRunActions.ts'

export interface PickVariant {
  /** The first tap only asks (the pick archives the other variants and deletes their worktrees). */
  confirming: boolean
  pending: boolean
  /** The last failure, in words; Cezar's own reason verbatim (FR-032). */
  error?: string
  notice?: string
  ask: () => void
  back: () => void
  keep: () => Promise<void>
}

/**
 * S-21: keep the task on screen and archive its sibling variants (#71), one tap behind a
 * confirmation, in flight until Cezar answers, and never retried — a timed-out pick may already
 * have archived the others, which the operator is told instead.
 *
 * Afterwards the group, this run and the list are re-asked, and so is every run of the project:
 * the losers were archived, and a sibling's screen still in the cache would say otherwise.
 */
export function usePickVariant(projectId: string, runId: string, groupId: string, variant: string): PickVariant {
  // Called on every task screen; only a grouped task renders the panel that can tap it.
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const inFlight = useRef(false)

  const keep = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setConfirming(false)
    setPending(true)
    setError(undefined)
    setNotice(undefined)
    try {
      await pickVariant(projectId, groupId, runId)
      setNotice(en.run.variants.kept(variant))
    } catch (failure) {
      setError(actionFailureMessage(failure))
      if (failure instanceof AuthRequiredError) void queryClient.invalidateQueries({ queryKey: HEALTH_QUERY_KEY })
    } finally {
      inFlight.current = false
      setPending(false)
      // Success or a refusal alike: a 409 or 404 means the group moved under the operator.
      void queryClient.invalidateQueries({ queryKey: groupQueryKey(projectId, groupId) })
      void queryClient.invalidateQueries({ queryKey: ['run', projectId] })
      void invalidateRun(queryClient, projectId, runId)
    }
  }, [projectId, groupId, runId, variant, queryClient])

  return {
    confirming,
    pending,
    ...(error !== undefined ? { error } : {}),
    ...(notice !== undefined ? { notice } : {}),
    ask: useCallback(() => {
      setError(undefined)
      setNotice(undefined)
      setConfirming(true)
    }, []),
    back: useCallback(() => setConfirming(false), []),
    keep,
  }
}
