import { useCallback, useState } from 'react'
import { type SignOutResult, signOut } from '../../pwa/sign-out.ts'
import { applyTheme } from '../../pwa/theme.ts'

export type SignOutState = {
  confirming: boolean
  busy: boolean
  /** Set only when something did not take; a full sign-out leaves the screen. */
  result: SignOutResult | undefined
  /**
   * Bumped by each sign-out that stayed on the screen. The sections that read local state (the
   * theme, the push subscription) are keyed on it, so they read it again after it was cleared.
   */
  attempt: number
  ask: () => void
  cancel: () => void
  confirm: () => void
}

/** Test seam: the app's fresh start after a sign-out that took. */
export const restart = {
  to: (url: string) => window.location.replace(url),
}

/**
 * FR-006 behind a confirmation — signing out costs the operator a trip to the access link.
 *
 * A sign-out that took restarts the app at `/m/`: that drops the query cache and everything else
 * in memory, and the session probe then lands on "Connect to Cezar" by itself. One that did not
 * take stays here and says which half is missing, and keeps the cache so that the warning is not
 * swapped out by a re-probe: when the session is still open, the app can read all of it again
 * anyway.
 */
export function useSignOut(): SignOutState {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SignOutResult>()
  const [attempt, setAttempt] = useState(0)

  const confirm = useCallback(() => {
    setBusy(true)
    setResult(undefined)
    void signOut().then((outcome) => {
      // The stored preference is gone with the rest of local storage.
      applyTheme('system')
      if (outcome.sessionEnded && outcome.notificationsStopped) {
        restart.to('/m/')
        return
      }
      setBusy(false)
      setConfirming(false)
      setResult(outcome)
      setAttempt((current) => current + 1)
    })
  }, [])

  return {
    confirming,
    busy,
    result,
    attempt,
    ask: useCallback(() => setConfirming(true), []),
    cancel: useCallback(() => setConfirming(false), []),
    confirm,
  }
}
