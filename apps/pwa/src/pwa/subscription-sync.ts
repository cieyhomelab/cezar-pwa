import { deleteSubscription, saveSubscription } from '../api/push.ts'

/**
 * S-11: the sidecar's list of devices and the device's own subscription stay the same list.
 *
 * A push service can replace a subscription on its own. The old endpoint then answers 410 and the
 * sidecar drops it (FR-044) — but nothing would ever tell the sidecar the new one, and the device
 * would sit in Settings as "on" while nothing reached it. Both functions here close that gap. Used
 * by the service worker and by the page, so they take the push manager rather than finding one.
 */

export type SyncDeps = {
  save: (subscription: PushSubscriptionJSON) => Promise<void>
  remove: (endpoint: string) => Promise<void>
}

const sidecar: SyncDeps = { save: saveSubscription, remove: deleteSubscription }

type Subscription = Pick<PushSubscription, 'endpoint' | 'toJSON'> & {
  options: Pick<PushSubscriptionOptions, 'applicationServerKey'>
}

/**
 * On opening the app: tell the sidecar about this device's subscription again. Storing is an
 * upsert keyed on the endpoint, so for a device it already knows this changes nothing.
 *
 * @returns whether there was a subscription to tell it about.
 */
export async function resyncSubscription(
  pushManager: { getSubscription: () => Promise<Subscription | null> },
  deps: SyncDeps = sidecar,
): Promise<boolean> {
  const current = await pushManager.getSubscription()
  if (!current) return false
  await deps.save(current.toJSON())
  return true
}

/**
 * The worker's `pushsubscriptionchange`: store the replacement, then drop the old endpoint. When
 * the browser did not hand over a replacement, subscribe again with the key the old one used. The
 * old endpoint is dropped even if storing fails: it is dead either way.
 */
export async function replaceSubscription(
  change: { oldSubscription: Subscription | null; newSubscription: Subscription | null },
  pushManager: { subscribe: (options: PushSubscriptionOptionsInit) => Promise<Subscription> },
  deps: SyncDeps = sidecar,
): Promise<void> {
  const { oldSubscription } = change
  let next = change.newSubscription
  try {
    const key = oldSubscription?.options.applicationServerKey
    if (!next && key) next = await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    if (next) await deps.save(next.toJSON())
  } finally {
    if (oldSubscription && oldSubscription.endpoint !== next?.endpoint) {
      await deps.remove(oldSubscription.endpoint).catch(() => {})
    }
  }
}
