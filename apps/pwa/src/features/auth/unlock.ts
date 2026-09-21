import { hasAccessKey, stripAccessKey } from '../../domain/access-link.ts'

/**
 * The browser half of unlocking: navigating with the key, and cleaning up
 * after a navigation that did not do what we hoped.
 *
 * Whether the unlock works depends on the server, not on this code: the
 * gateway's `?key=` guard lives in the vhost's `location /`, which never sees
 * `/m/`, so it needs a copy inside the `/m/` location (`deploy/nginx/`,
 * installed by `install.sh`). The app reads the outcome off the URL it lands on:
 *
 *  - **Key gone** → the gateway consumed it, issued the cookie and redirected
 *    to the clean path. The session probe now succeeds: FR-005 in full.
 *  - **Key still there** → nothing in front of us matched it — the link is
 *    wrong or incomplete, or the server has no unlock at `/m/` yet. Strip it
 *    from the history entry at once and say so. There is no "open it in Safari
 *    instead" for the installed app: it keeps its own cookies (R-AUTH-1), so a
 *    session opened anywhere else never reaches it. That advice is only offered
 *    in a browser tab, where it is true.
 *
 * Either way the key is never written anywhere: no storage, no cache, no log.
 */

/** Memoised because the first read is destructive — it rewrites the history entry. */
let outcome: boolean | undefined

/**
 * True when this load came back from an unlock attempt the gateway ignored.
 *
 * Call it as early as the UI needs it and as often as it likes; the strip
 * happens once. Idempotent by memo rather than by accident, because React
 * StrictMode renders twice and the second read would otherwise see a cleaned
 * URL and report success.
 */
export function consumeUnlockOutcome(): boolean {
  if (outcome === undefined) {
    outcome = hasAccessKey(window.location.search)
    if (outcome) {
      window.history.replaceState(
        window.history.state,
        '',
        stripAccessKey(window.location.href),
      )
    }
  }
  return outcome
}

/** Test seam: forget what was read, so a case can set up its own URL. */
export function resetUnlockOutcome(): void {
  outcome = undefined
}

/**
 * Hand the key to the gateway.
 *
 * A full-page navigation in the *current* context, never a new tab or window:
 * on iOS the installed app has its own cookie jar, so a session created
 * anywhere else does not reach it (R-AUTH-1). `replace` rather than `assign`
 * keeps the key-bearing URL out of the back stack.
 */
export function navigateToUnlock(url: string): void {
  window.location.replace(url)
}
