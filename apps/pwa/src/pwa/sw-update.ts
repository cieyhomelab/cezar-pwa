/**
 * FR-003's other half: a deploy has to be *found* before it can be offered.
 *
 * The browser checks for a new worker only on a navigation (or a worker event), and an installed
 * app on iOS is resumed from memory far more often than it is launched. Measured on the host
 * (2026-09-24): the operator's iPhone used the app all morning and last fetched `/m/sw.js` the
 * evening before, so no deploy since had reached it. This asks for the check itself — when the
 * app comes back to the foreground, and on an interval while it stays there.
 *
 * Only the check. A worker that is found still waits for the operator's "Refresh"
 * (`registerType: 'prompt'`), so nothing here can swap the app mid-use.
 */

/** Resuming twice in a minute is one check: iOS fires `visibilitychange` on every app switch. */
export const UPDATE_CHECK_MIN_INTERVAL_MS = 60_000

/** While the app stays open and visible. Hidden pages are not checked at all. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60_000

/** What is used of a `ServiceWorkerRegistration`; its `update()` resolves differently across DOM libs. */
type Registration = { update: () => Promise<unknown> }

const watched = new WeakSet<object>()

/**
 * Start checking `registration` for updates. Idempotent per registration, because the register
 * hook can call back more than once (React's development double effects). Returns the teardown.
 */
export function watchForUpdates(
  registration: Registration,
  { doc = document, now = Date.now }: { doc?: Document; now?: () => number } = {},
): () => void {
  if (watched.has(registration)) return () => {}
  watched.add(registration)

  // The registration itself just checked, so the first resume within the minute is not another.
  let lastCheck = now()
  const check = () => {
    if (doc.visibilityState !== 'visible') return
    if (now() - lastCheck < UPDATE_CHECK_MIN_INTERVAL_MS) return
    lastCheck = now()
    // Offline, or the gate in a mood: the next resume tries again. Never worth a message.
    registration.update().catch(() => {})
  }

  doc.addEventListener('visibilitychange', check)
  const timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS)
  return () => {
    doc.removeEventListener('visibilitychange', check)
    clearInterval(timer)
    watched.delete(registration)
  }
}
