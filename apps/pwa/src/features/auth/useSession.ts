import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { healthQueryOptions } from '../../api/health.ts'
import { AuthRequiredError } from '../../api/http.ts'

/**
 * `checking` — the first probe is in flight and nothing is known yet.
 * `connected` — Cezar answered; there is a session.
 * `unauthorized` — the gateway refused; offer re-unlocking (FR-004).
 * `unreachable` — the request never got an answer. Not the same thing, and
 *   showing "Connect to Cezar" here would send the operator hunting for a link
 *   they do not need.
 */
export type SessionStatus = 'checking' | 'connected' | 'unauthorized' | 'unreachable'

export type Session = {
  status: SessionStatus
  /** The instance's version, once it has answered. S-12 (FR-047) surfaces it. */
  version?: string
  /** A probe is in flight — including a re-probe over an already-known answer. */
  isProbing: boolean
  recheck: () => void
}

/**
 * Whether the product is talking to Cezar, kept honest across the phone
 * freezing the app.
 *
 * The session is a 30-day non-sliding cookie the app can never read
 * (`HttpOnly`), so "am I still authorized" has exactly one answer: ask
 * (`docs/CEZAR_API.md` § 1a). Every return to the foreground re-asks, because
 * iOS suspends the app for hours at a time and the answer may have changed
 * while it was frozen — the session may have expired. In a browser tab it also
 * completes the "open the link in this browser and come back" route without a
 * button press; the installed app has no such route (its cookies are its own).
 */
export function useSession(): Session {
  const query = useQuery(healthQueryOptions())
  // Stable across renders (it is bound to the query observer), so the listener
  // attaches once rather than on every render.
  const { refetch } = query

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refetch()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [refetch])

  let status: SessionStatus = 'checking'
  if (query.isSuccess) status = 'connected'
  else if (query.error instanceof AuthRequiredError) status = 'unauthorized'
  else if (query.error) status = 'unreachable'

  return {
    status,
    version: query.data?.version,
    isProbing: query.isFetching,
    recheck: () => void refetch(),
  }
}
