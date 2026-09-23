import type { MessageResponse } from '@cezar-pwa/cezar-contract/contract'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { HEALTH_QUERY_KEY } from '../../api/health.ts'
import { ApiError, AuthRequiredError, NetworkError, TimeoutError } from '../../api/http.ts'
import { continueRunWith, invalidateRun, sendRunMessage } from '../../api/run.ts'
import { type DeliveryMode, type DeliveryRun, deliveryMode, lastSessionId, resumeAfterIdleTeardown } from '../../domain/answer.ts'
import { apiErrorDetail } from '../../i18n/errors.ts'
import { en } from '../../i18n/en.ts'

/** Where a send came from, so a failure is shown where the operator acted. */
export type DeliverySource = 'ask' | 'composer'

export interface Delivery {
  mode: DeliveryMode
  /** A send is in flight. Every way to send is disabled until it settles. */
  pending: boolean
  /** The last failure, in words, and which control it belongs to. Cleared by the next send. */
  error?: { source: DeliverySource; message: string }
  /** `deferred`: the session is starting and the text is buffered until it opens. */
  notice?: string
  /** The ask this screen already answered, until the transcript catches up and resolves it. */
  answeredAskId?: string
  /** Resolves `true` once Cezar took the text. Never rejects. */
  send: (text: string, source: DeliverySource, askId?: string) => Promise<boolean>
}

/** A failure in the operator's language. Cezar's own reason is kept verbatim (FR-032). */
export function failureMessage(error: unknown): string {
  if (error instanceof AuthRequiredError) return en.run.compose.failed.auth
  if (error instanceof TimeoutError) return en.run.compose.failed.timeout
  if (error instanceof NetworkError) return en.run.compose.failed.network
  // A coded error carries no words of Cezar's, so its reason comes from `en` (see `errors.ts`).
  if (error instanceof ApiError) {
    return en.run.compose.failed.refused(apiErrorDetail(error) ?? `HTTP ${error.status}`)
  }
  return en.run.compose.failed.refused(error instanceof Error ? error.message : String(error))
}

/**
 * One delivery for the whole task screen, shared by the question card and the composer: two
 * sends in flight at once would reach the agent in an order nobody chose.
 *
 * The route follows the cockpit's `useAskAnswer`. A live run gets `POST …/messages`. A closed
 * one with a session gets `POST …/continue` with the text as its opening prompt. A `409` from the
 * live route means the record was stale (the session closed since it was fetched), so the text
 * is resumed rather than lost, when there is a session to resume.
 *
 * Nothing is retried on the operator's behalf except the idle-teardown refusal, whose meaning is
 * "try again in a moment". A timed-out write in particular is reported, not resent: it may
 * already have reached the agent.
 */
export function useDeliver(projectId: string, runId: string, run: DeliveryRun | undefined): Delivery {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<Delivery['error']>()
  const [notice, setNotice] = useState<string>()
  const [answeredAskId, setAnsweredAskId] = useState<string>()
  const inFlight = useRef(false)
  // The newest record, read at send time, not at render time.
  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
  }, [run])

  // Before the record has loaded there is nothing to send to.
  const mode = run === undefined ? 'unavailable' : deliveryMode(run)

  const send = useCallback(
    async (text: string, source: DeliverySource, askId?: string): Promise<boolean> => {
      if (inFlight.current) return false
      const current = runRef.current
      const route = current === undefined ? 'unavailable' : deliveryMode(current)
      if (current === undefined || route === 'unavailable') {
        setError({ source, message: en.run.compose.failed.unavailable })
        return false
      }
      inFlight.current = true
      setPending(true)
      setError(undefined)
      setNotice(undefined)
      const resume = () => resumeAfterIdleTeardown(() => continueRunWith(projectId, runId, text))
      try {
        let answer: MessageResponse | undefined
        if (route === 'resume') {
          await resume()
        } else {
          try {
            answer = await sendRunMessage(projectId, runId, text)
          } catch (sendError) {
            if (!(sendError instanceof ApiError && sendError.status === 409)) throw sendError
            if (lastSessionId(current) === undefined) throw sendError
            try {
              await resume()
            } catch {
              // The fallback was a guess about a stale record. When it fails too, the refusal
              // worth reading is the one for what the operator actually did.
              throw sendError
            }
          }
        }
        if (answer !== undefined && 'deferred' in answer) setNotice(en.run.compose.deferred)
        if (askId !== undefined) setAnsweredAskId(askId)
        return true
      } catch (failure) {
        setError({ source, message: failureMessage(failure) })
        // A lapsed session hands the screen to `AuthGate`, as a failed read does.
        if (failure instanceof AuthRequiredError) void queryClient.invalidateQueries({ queryKey: HEALTH_QUERY_KEY })
        return false
      } finally {
        inFlight.current = false
        setPending(false)
        // Success or a refusal alike: the record may have moved (a 409 means it certainly did).
        void invalidateRun(queryClient, projectId, runId)
      }
    },
    [projectId, runId, queryClient],
  )

  return {
    mode,
    pending,
    ...(error !== undefined ? { error } : {}),
    ...(notice !== undefined ? { notice } : {}),
    ...(answeredAskId !== undefined ? { answeredAskId } : {}),
    send,
  }
}
