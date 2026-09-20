import { hasAccessKey, stripAccessKey } from '../../domain/access-link.ts'

/**
 * The browser half of unlocking: navigating with the key, and cleaning up
 * after a navigation that did not do what we hoped.
 *
 * The app cannot know in advance whether the gateway's `?key=` guard covers
 * `/m/` — the shell is served from outside the gate, and whether the unlock
 * guard sits in the `server` block (so it runs for every path) or inside
 * `location /` (so it never sees `/m/`) is not visible from the client, and not
 * readable from here (the deploy key is a write-only rsync command). So the app
 * asks, and reads the answer off the URL it lands on:
 *
 *  - **Key gone** → the gateway consumed it, issued the cookie and redirected
 *    to the clean path. The session probe will now succeed, and FR-005 is
 *    satisfied in full: authorize from inside the app, land back in it.
 *  - **Key still there** → nothing in front of us matched it; we merely
 *    re-loaded the shell with a secret in the address bar. Strip it from the
 *    history entry at once and fall back to telling the operator to open the
 *    link in Safari and come back — which `useSession`'s visibility re-probe
 *    then picks up without them pressing anything.
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
