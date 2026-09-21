import type { PushPayload } from '@cezar-pwa/shared'
import webpush from 'web-push'
import type { Subscription, SubscriptionStore } from './store.ts'
import type { VapidKeys } from './vapid.ts'

/** `webpush.sendNotification`'s shape, so tests can stand in for the push service. */
export type SendNotification = (
  subscription: Subscription,
  payload: string,
  options: webpush.RequestOptions,
) => Promise<unknown>

/** What happened to one delivery. `gone` means the push service no longer knows the device. */
export type Delivery = 'sent' | 'gone' | 'failed'

/**
 * A day: a phone that is off overnight still gets told in the morning. Anything older is noise —
 * the list says it better by then.
 */
export const PUSH_TTL_SECONDS = 24 * 60 * 60

/** 404 and 410 are the push service saying the subscription is dead (RFC 8030 § 7.3). */
const isGone = (error: unknown) => {
  const status = (error as { statusCode?: unknown } | null)?.statusCode
  return status === 404 || status === 410
}

export type PusherOptions = {
  store: SubscriptionStore
  vapid: VapidKeys
  subject: string
  send?: SendNotification
  log?: (message: string) => void
}

export class Pusher {
  private readonly options: PusherOptions
  private readonly send: SendNotification

  constructor(options: PusherOptions) {
    this.options = options
    this.send = options.send ?? ((subscription, payload, requestOptions) => webpush.sendNotification(subscription, payload, requestOptions))
  }

  /**
   * Deliver to one device. A device the push service reports gone is dropped from the store
   * (FR-044), so nothing keeps targeting it.
   */
  async sendTo(subscription: Subscription, payload: PushPayload): Promise<Delivery> {
    const { vapid, subject, store, log } = this.options
    try {
      await this.send(subscription, JSON.stringify(payload), {
        vapidDetails: { subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
        TTL: PUSH_TTL_SECONDS,
        // The whole point is reaching a locked phone; `high` asks the service not to batch it.
        urgency: 'high',
      })
      return 'sent'
    } catch (error) {
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
