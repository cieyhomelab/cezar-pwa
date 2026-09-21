import { deleteSubscription } from '../api/push.ts'
import { endSession } from '../api/session.ts'

/**
 * S-12 (FR-006): sign out — clear everything the app holds locally and stop notifications reaching
 * this device. The steps take their dependencies, like `subscription-sync.ts`, so the order and
 * the failure handling are tested without a browser.
 *
 * The order is the point:
 *
 *  1. **Notifications**, while there is still a session: `/m/push/` sits behind the gate, so the
 *     sidecar can only be told to forget this device before the cookie goes. The device then
 *     unsubscribes whatever the sidecar said — a device that asked to stop must stop, and an
 *     endpoint the sidecar kept answers 410 on its next push and is dropped (FR-044).
 *  2. **The session**, at the perimeter (`api/session.ts`).
 *  3. **Local data**: storage and databases. The service worker's precache is left alone: it
 *     holds the shell and nothing else (CLAUDE.md rule 4), and without it the app cannot open
 *     offline to show "Connect to Cezar". The query cache is memory — the caller drops it.
 *
 * No step stops the next one. The result says which halves did not happen, so Settings can say
 * so instead of claiming a sign-out that did not take.
 */

type Subscription = { endpoint: string; unsubscribe: () => Promise<boolean> }

export type SignOutDeps = {
  /** The push manager, or `undefined` where there is none (a browser tab, no service worker). */
  pushManager: () => Promise<{ getSubscription: () => Promise<Subscription | null> } | undefined>
  forgetDevice: (endpoint: string) => Promise<void>
  endSession: () => Promise<boolean>
  clearLocal: () => Promise<void>
}

export type SignOutResult = {
  /** The perimeter confirmed the cookie is gone. */
  sessionEnded: boolean
  /** Nothing will push to this device any more: the sidecar forgot it, or it unsubscribed. */
  notificationsStopped: boolean
}

export async function signOut(deps: SignOutDeps = browser): Promise<SignOutResult> {
  const notificationsStopped = await stopNotifications(deps)
  const sessionEnded = await deps.endSession().catch(() => false)
  await deps.clearLocal().catch(() => {})
  return { sessionEnded, notificationsStopped }
}

async function stopNotifications(deps: SignOutDeps): Promise<boolean> {
  let subscription: Subscription | null
  try {
    const pushManager = await deps.pushManager()
    if (!pushManager) return true
    subscription = await pushManager.getSubscription()
  } catch {
    // Unknown is not stopped.
    return false
  }
  if (!subscription) return true
  const forgotten = await deps.forgetDevice(subscription.endpoint).then(
    () => true,
    () => false,
  )
  const unsubscribed = await subscription.unsubscribe().catch(() => false)
  // Either half stops the pushes: the sidecar no longer sends, or the push service no longer
  // delivers. Only both failing leaves this device reachable.
  return forgotten || unsubscribed
}

/** Web Storage and every IndexedDB database of this origin. Nothing in there is a secret. */
export async function clearLocalData(): Promise<void> {
  try {
    localStorage.clear()
    sessionStorage.clear()
  } catch {
    // Storage can refuse; the rest still runs.
  }
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return
  const databases = await indexedDB.databases()
  await Promise.all(
    databases.map(
      ({ name }) =>
        new Promise<void>((resolve) => {
          if (!name) return resolve()
          const request = indexedDB.deleteDatabase(name)
          // `blocked` means another tab holds it open; it is deleted when that tab lets go.
          request.onsuccess = request.onerror = request.onblocked = () => resolve()
        }),
    ),
  )
}

const browser: SignOutDeps = {
  pushManager: async () => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined
    // `getRegistration`, not `ready`: `ready` never settles on a page with no worker.
    const registration = await navigator.serviceWorker.getRegistration()
    return registration?.pushManager
  },
  forgetDevice: deleteSubscription,
  endSession,
  clearLocal: clearLocalData,
}
