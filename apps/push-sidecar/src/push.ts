import { createHash } from 'node:crypto'
import { runKey, type PushPayload } from '@cezar-pwa/shared'
import webpush from 'web-push'
import type { Subscription, SubscriptionStore } from './store.ts'
import type { VapidKeys } from './vapid.ts'

/** `webpush.sendNotification`'s shape, so tests can stand in for the push service. */
export type SendNotification = (
  subscription: Subscription,
  payload: string,
  options: webpush.RequestOptions,
) => Promise<unknown>

/**
 * What happened to one delivery. `gone` means the push service no longer knows the device;
 * `timeout` means it never answered, which says nothing about the device.
 */
export type Delivery = 'sent' | 'gone' | 'failed' | 'timeout'

/**
 * A day: a phone that is off overnight still gets told in the morning. Anything older is noise —
 * the list says it better by then.
 */
export const PUSH_TTL_SECONDS = 24 * 60 * 60

/**
 * How long one send may take. A push service that accepts the connection and then stalls would
 * otherwise hold the promise — and, under the watcher, one per device per status change — for as
 * long as it likes. Ten seconds is far past a healthy APNs or FCM answer and still inside nginx's
 * read timeout, so `/m/push/test` answers the operator rather than the proxy answering for it.
 */
export const PUSH_TIMEOUT_MS = 10_000

/** Raised by `withDeadline` only: the send is still out there, nobody is waiting for it. */
class PushTimeout extends Error {}

/**
 * Settle as a timeout when `promise` has not settled within `ms`.
 *
 * web-push's own `timeout` option is a *socket* timeout — inactivity, not a total deadline — and it
 * cannot bound an injected `send` at all, so the deadline lives here and the option below is what
 * makes the abandoned request let go of its socket.
 */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  // Past the deadline nobody is listening, and a late rejection must not crash the process.
  promise.catch(() => {})
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PushTimeout('push timed out')), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** 404 and 410 are the push service saying the subscription is dead (RFC 8030 § 7.3). */
const isGone = (error: unknown) => {
  const status = (error as { statusCode?: unknown } | null)?.statusCode
  return status === 404 || status === 410
}

/**
 * FR-039 before the phone even sees it. A push service holds an undelivered message per `Topic`
 * and replaces it with a newer one on the same topic (RFC 8030 § 5.4), so a phone that was off
 * while a task went `waiting` and then `failed` wakes to one notification about it, not two.
 * The tag does the same on the phone for what was already shown.
 *
 * A topic is at most 32 URL-safe base64 characters, and it travels in the clear to the push
 * service, so it is a hash of the task's key rather than the key itself.
 */
export function topicFor(payload: PushPayload): string | undefined {
  if (payload.kind !== 'attention' || !payload.projectId || !payload.runId) return undefined
  return createHash('sha256').update(runKey(payload.projectId, payload.runId)).digest('base64url').slice(0, 32)
}

/** A subscription past the `expirationTime` its push service gave it is as gone as a 410. */
export function isExpired(subscription: Subscription, now: number): boolean {
  return typeof subscription.expirationTime === 'number' && subscription.expirationTime <= now
}

export type PusherOptions = {
  store: SubscriptionStore
  vapid: VapidKeys
  subject: string
  send?: SendNotification
  log?: (message: string) => void
  now?: () => number
}

export class Pusher {
  private readonly options: PusherOptions
  private readonly send: SendNotification

  constructor(options: PusherOptions) {
    this.options = options
    this.send = options.send ?? ((subscription, payload, requestOptions) => webpush.sendNotification(subscription, payload, requestOptions))
  }

  /**
   * Deliver to one device. A device the push service reports gone, or whose subscription has
   * expired, is dropped from the store (FR-044), so nothing keeps targeting it. A send that runs
   * past `PUSH_TIMEOUT_MS` is a transient fault of the service, not of the device: it is given up
   * on, and the subscription stays.
   */
  async sendTo(subscription: Subscription, payload: PushPayload): Promise<Delivery> {
    const { vapid, subject, store, log } = this.options
    if (isExpired(subscription, (this.options.now ?? Date.now)())) {
      await store.remove(subscription.endpoint)
      log?.('dropped an expired subscription')
      return 'gone'
    }
    const topic = topicFor(payload)
    try {
      await withDeadline(
        this.send(subscription, JSON.stringify(payload), {
          vapidDetails: { subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
          TTL: PUSH_TTL_SECONDS,
          // The whole point is reaching a locked phone; `high` asks the service not to batch it.
          urgency: 'high',
          timeout: PUSH_TIMEOUT_MS,
          ...(topic ? { topic } : {}),
        }),
        PUSH_TIMEOUT_MS,
      )
      return 'sent'
    } catch (error) {
      if (error instanceof PushTimeout) {
        // How long, never where: the endpoint names the device (CLAUDE.md rule 6).
        log?.(`push timed out after ${PUSH_TIMEOUT_MS} ms`)
        return 'timeout'
      }
      if (isGone(error)) {
        await store.remove(subscription.endpoint)
        log?.('dropped a subscription the push service reports gone')
        return 'gone'
      }
      // The status only — the response body may echo the payload back.
      const status = (error as { statusCode?: unknown } | null)?.statusCode
      log?.(`push failed${typeof status === 'number' ? ` (${status})` : ''}`)
      return 'failed'
    }
  }

  async sendToAll(payload: PushPayload): Promise<Delivery[]> {
    const targets = [...this.options.store.list()]
    return Promise.all(targets.map((subscription) => this.sendTo(subscription, payload)))
  }
}
