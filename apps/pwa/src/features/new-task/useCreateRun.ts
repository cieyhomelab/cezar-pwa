import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { HEALTH_QUERY_KEY } from '../../api/health.ts'
import { ApiError, AuthRequiredError, NetworkError, TimeoutError } from '../../api/http.ts'
import { createRun } from '../../api/new-task.ts'
import { RUNS_INDEX_QUERY_KEY } from '../../api/runs-index.ts'
import { createRunBody, createdRunId, type NewTaskForm } from '../../domain/new-task.ts'
import { runPath } from '../../domain/run-header.ts'
import { apiErrorDetail } from '../../i18n/errors.ts'
import { en } from '../../i18n/en.ts'

/** A failure in the operator's language. Cezar's own reason is kept verbatim (FR-032). */
export function createFailureMessage(error: unknown): string {
  const failed = en.newTask.failed
  if (error instanceof AuthRequiredError) return failed.auth
  if (error instanceof TimeoutError) return failed.timeout
  if (error instanceof NetworkError) return failed.network
  if (error instanceof ApiError) return failed.refused(apiErrorDetail(error) ?? `HTTP ${error.status}`)
  return failed.refused(error instanceof Error ? error.message : String(error))
}

/**
 * S-13: send the form once and open the task it made (FR-034). The list is re-asked either way;
 * the workspace stream would bring the new row too, but it may not be open.
 *
 * Nothing is retried: a timed-out create may have started a task, and a second tap is the
 * operator's decision once they have been told so.
 */
export function useCreateRun() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const inFlight = useRef(false)

  const submit = useCallback(
    async (projectId: string, form: NewTaskForm): Promise<void> => {
      if (inFlight.current) return
      inFlight.current = true
      setPending(true)
      setError(undefined)
      try {
        const runId = createdRunId(await createRun(projectId, createRunBody(form)))
        void queryClient.invalidateQueries({ queryKey: RUNS_INDEX_QUERY_KEY })
        if (runId === undefined) {
          setError(en.newTask.failed.noRun)
          return
        }
        // Replace: back from the new task goes to the list, not to a form that already sent.
        void navigate(runPath(projectId, runId), { replace: true })
      } catch (failure) {
        setError(createFailureMessage(failure))
        // A lapsed session hands the screen to `AuthGate`, as a failed read does.
        if (failure instanceof AuthRequiredError) void queryClient.invalidateQueries({ queryKey: HEALTH_QUERY_KEY })
        // A timeout may have started one after all.
        if (failure instanceof TimeoutError) void queryClient.invalidateQueries({ queryKey: RUNS_INDEX_QUERY_KEY })
      } finally {
        inFlight.current = false
        setPending(false)
      }
    },
    [queryClient, navigate],
  )

  return { pending, error, submit }
}
