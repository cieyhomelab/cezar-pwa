/**
 * S-10: whether this device can have notifications turned on, and what to show instead when it
 * cannot. Pure, so every branch is a table row.
 */

/** What the browser offers. Read once by the hook; plain booleans here. */
export type PushEnvironment = {
  /** Launched from the home-screen icon (`useStandalone`). */
  standalone: boolean
  serviceWorker: boolean
  pushManager: boolean
  notification: boolean
}

/** `Notification.permission`, plus "no Notification API at all". */
export type PushPermission = NotificationPermission | 'unsupported'

/**
 * - `install` — a browser tab. On iOS a tab has no Web Push at all, so the operator is shown how
 *   to install instead of a button that cannot work (FR-037). Checked FIRST: Safari in a tab
 *   exposes no `PushManager`, and "unsupported" would wrongly read as "this phone cannot".
 * - `unsupported` — installed, but the platform has no Web Push (iOS before 16.4).
 * - `denied` — the operator refused once; only the system settings can undo it.
 * - `available` — the enable button may be offered.
 */
export type PushAvailability = 'install' | 'unsupported' | 'denied' | 'available'

export function pushAvailability(env: PushEnvironment, permission: PushPermission): PushAvailability {
  if (!env.standalone) return 'install'
  if (!env.serviceWorker || !env.pushManager || !env.notification || permission === 'unsupported') {
    return 'unsupported'
  }
  if (permission === 'denied') return 'denied'
  return 'available'
}

/** The sidecar's public VAPID key (base64url) as `pushManager.subscribe` wants it. */
export function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Whether an existing subscription was made with this key. A subscription is bound to the key it
 * was made with; after the sidecar's pair changed, subscribing again with the new key throws until
 * the old one is dropped.
 */
export function sameKey(existing: ArrayBuffer | null | undefined, key: Uint8Array): boolean {
  if (!existing) return true
  const bytes = new Uint8Array(existing)
  return bytes.length === key.length && bytes.every((byte, i) => byte === key[i])
}
