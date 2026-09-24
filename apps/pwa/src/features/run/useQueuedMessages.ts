import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { HEALTH_QUERY_KEY } from '../../api/health.ts'
import { ApiError, AuthRequiredError } from '../../api/http.ts'
import { applyQueuedMessage, editQueuedMessage, invalidateRun, removeQueuedMessage } from '../../api/run.ts'
import { queuedMessageRefusal } from '../../domain/queued-messages.ts'
import { en } from '../../i18n/en.ts'
import { actionFailureMessage } from './useRunActions.ts'

export interface QueuedMessages {
  /** The message a write is in flight for. Every edit and removal waits until it settles. */
  pending?: { id: string; kind: 'edit' | 'remove' }
  /** The last failure, in words, and the message it belongs to (FR-032). */
  error?: { id: string; message: string }
  /** The message was already delivered when the operator acted: said calmly, not as an error. */
  notice?: string
  /** Resolves `true` when the editor can close: saved, or already sent. Never rejects. */
  edit: (id: string, text: string) => Promise<boolean>
  /** Resolves `true` once the message is off the stack, either way. Never rejects. */
  remove: (id: string) => Promise<boolean>
}

/**
 * #66: edit or remove a message stacked onto a queued task, one write at a time.
 *
 * The answer goes into `['run', …]` straight away; the `run` SSE event carries the same stack a
 * moment later. A 404 or 409 means the task started and took the message, which the operator is
 * told as a fact rather than an error, and the record is re-asked. Nothing is retried: a
 * timed-out write may already have applied.
 */
export function useQueuedMessages(projectId: string, runId: string): QueuedMessages {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<QueuedMessages['pending']>()
  const [error, setError] = useState<QueuedMessages['error']>()
  const [notice, setNotice] = useState<string>()
  const inFlight = useRef(false)

  const run = useCallback(
    async (id: string, kind: 'edit' | 'remove', write: () => Promise<void>): Promise<boolean> => {
      if (inFlight.current) return false
      inFlight.current = true
      setPending({ id, kind })
      setError(undefined)
      setNotice(undefined)
      try {
        await write()
        return true
      } catch (failure) {
        void invalidateRun(queryClient, projectId, runId)
        if (failure instanceof ApiError && failure.code === undefined && queuedMessageRefusal(failure.status) === 'already-sent') {
          if (failure.status === 404) applyQueuedMessage(queryClient, projectId, runId, { removed: id })
          setNotice(en.run.compose.queue.alreadySent)
          return true
        }
        setError({ id, message: actionFailureMessage(failure) })
        // A lapsed session hands the screen to `AuthGate`, as a failed read does.
        if (failure instanceof AuthRequiredError) void queryClient.invalidateQueries({ queryKey: HEALTH_QUERY_KEY })
        return false
      } finally {
        inFlight.current = false
        setPending(undefined)
      }
    },
    [projectId, runId, queryClient],
  )

  const edit = useCallback(
    (id: string, text: string) =>
      run(id, 'edit', async () => {
        const { message } = await editQueuedMessage(projectId, runId, id, text)
        applyQueuedMessage(queryClient, projectId, runId, { replaced: message })
      }),
    [run, projectId, runId, queryClient],
  )

  const remove = useCallback(
    (id: string) =>
      run(id, 'remove', async () => {
        await removeQueuedMessage(projectId, runId, id)
        applyQueuedMessage(queryClient, projectId, runId, { removed: id })
      }),
    [run, projectId, runId, queryClient],
  )

  return {
    ...(pending !== undefined ? { pending } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(notice !== undefined ? { notice } : {}),
    edit,
    remove,
  }
}
