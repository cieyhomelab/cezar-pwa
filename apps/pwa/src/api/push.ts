import { ApiError, pushFetch } from './http.ts'

/**
 * The push sidecar's endpoints (REQUIREMENTS § 6, `apps/push-sidecar/src/app.ts`). Not Cezar —
 * `cezar-push`, beside it on loopback, reached through nginx's `/m/push/` behind the same gate.
 */

/** Query key for the public VAPID key: fetched before the tap, so the tap goes straight to iOS. */
export const VAPID_KEY_QUERY_KEY = ['push-vapid-key'] as const

export async function fetchVapidKey(options?: { signal?: AbortSignal }): Promise<string> {
  const body = await pushFetch<{ publicKey?: unknown }>('/m/push/vapid-public-key', { signal: options?.signal })
  if (typeof body?.publicKey !== 'string' || body.publicKey === '') {
    throw new ApiError('Serwer powiadomień odpowiedział w nieznanym formacie', 200)
  }
  return body.publicKey
}

export function vapidKeyQueryOptions() {
  return {
    queryKey: VAPID_KEY_QUERY_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchVapidKey({ signal }),
    // The pair never rotates on its own (`apps/push-sidecar/src/vapid.ts`).
    staleTime: Infinity,
    retry: false,
  }
}

/** `PushSubscription.toJSON()`: endpoint and keys, nothing about the operator. */
export async function saveSubscription(subscription: PushSubscriptionJSON): Promise<void> {
  await pushFetch('/m/push/subscription', { method: 'POST', body: subscription })
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  await pushFetch('/m/push/subscription', { method: 'DELETE', body: { endpoint } })
}

/** A test notification to this device only (FR-045). 404: the sidecar does not know it. */
export async function sendTestPush(endpoint: string): Promise<void> {
  await pushFetch('/m/push/test', { method: 'POST', body: { endpoint } })
}
