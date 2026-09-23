import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { ApiError, AuthRequiredError, NetworkError } from '../../api/http.ts'
import { deleteSubscription, saveSubscription, sendTestPush, vapidKeyQueryOptions } from '../../api/push.ts'
import {
  applicationServerKey,
  type PushAvailability,
  type PushPermission,
  pushAvailability,
  sameKey,
} from '../../domain/push-setup.ts'
import { en } from '../../i18n/en.ts'
import { isStandalone } from '../../pwa/useStandalone.ts'

type Busy = 'enable' | 'disable' | 'test'

export type PushSettings = {
  availability: PushAvailability
  /** `undefined` while the worker is asked; `null` when this device is not subscribed. */
  subscription: PushSubscription | null | undefined
  busy: Busy | undefined
  error: string | undefined
  notice: string | undefined
  enable: () => void
  disable: () => void
  test: () => void
}

function readPermission(): PushPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

function readEnvironment() {
  return {
    standalone: isStandalone(),
    serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    pushManager: typeof PushManager !== 'undefined',
    notification: typeof Notification !== 'undefined',
  }
}

/** A failed step, in the operator's words. The sidecar's own reason is shown verbatim. */
function describe(error: unknown): string {
  if (error instanceof AuthRequiredError) return en.push.errors.auth
  if (error instanceof ApiError) {
    if (error.status === 404) return en.push.errors.unknownDevice
    if (error.status === 410) return en.push.errors.gone
    // The sidecar answered, but not in its own shape — its words are not in there to show.
    if (error.code === 'unexpected-shape' || error.code === 'invalid-json') {
      return en.push.errors.unexpectedShape
    }
    // nginx's own answer while the sidecar is down, not the sidecar's — or the app shell answering
    // for an unrouted /m/push/, which pushFetch reports as `not-routed` (#31). Either way the
    // error carries a code rather than the sidecar's own reason.
    if (error.status === 502 && error.code !== undefined) return en.push.errors.unavailable
    if (error.status === 503 || error.status === 504) return en.push.errors.unavailable
    return en.push.errors.failed(error.message)
  }
  if (error instanceof NetworkError) return en.push.errors.unavailable
  return en.push.errors.failed(error instanceof Error ? error.message : String(error))
}

/**
 * S-10, the device half: turn notifications on from a deliberate tap (FR-036), off again, and send
 * a test (FR-045). The sidecar is the other half; this hook keeps the two agreeing — a device the
 * sidecar could not store is unsubscribed again rather than left looking enabled.
 */
export function usePushSubscription(): PushSettings {
  const queryClient = useQueryClient()
  const [permission, setPermission] = useState(readPermission)
  const [environment] = useState(readEnvironment)
  const availability = pushAvailability(environment, permission)
  const [subscription, setSubscription] = useState<PushSubscription | null | undefined>(undefined)
  const [busy, setBusy] = useState<Busy>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  // Fetched before the tap: iOS only honours the permission request as a direct result of it, so
  // the tap must not wait on the network first.
  const vapidKey = useQuery({ ...vapidKeyQueryOptions(), enabled: availability === 'available' })

  useEffect(() => {
    if (availability !== 'available') return
    let cancelled = false
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then(
        (existing) => {
          if (!cancelled) setSubscription(existing)
        },
        () => {
          if (!cancelled) setSubscription(null)
        },
      )
    return () => {
      cancelled = true
    }
  }, [availability])

  const run = useCallback(async (kind: Busy, step: () => Promise<void>) => {
    setBusy(kind)
    setError(undefined)
    setNotice(undefined)
    try {
      await step()
    } catch (caught) {
      setError(describe(caught))
    } finally {
      setBusy(undefined)
    }
  }, [])

  const enable = useCallback(() => {
    void run('enable', async () => {
      // First, and before any await: the prompt must come straight from the tap.
      const granted = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
      setPermission(granted)
      if (granted !== 'granted') {
        if (granted === 'default') setError(en.push.errors.dismissed)
        return
      }
      const key = applicationServerKey(vapidKey.data ?? (await queryClient.fetchQuery(vapidKeyQueryOptions())))
      const registration = await navigator.serviceWorker.ready
      let current = await registration.pushManager.getSubscription()
      if (current && !sameKey(current.options?.applicationServerKey, key)) {
        await current.unsubscribe()
        // S-11: that endpoint is dead now; the sidecar should not keep it until a push bounces.
        await deleteSubscription(current.endpoint).catch(() => {})
        current = null
      }
      const next = current ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }))
      try {
        await saveSubscription(next.toJSON())
      } catch (caught) {
        // The sidecar does not know this device, so nothing would ever reach it: do not look on.
        await next.unsubscribe().catch(() => {})
        setSubscription(null)
        throw caught
      }
      setSubscription(next)
    })
  }, [queryClient, run, vapidKey.data])

  const disable = useCallback(() => {
    const current = subscription
    if (!current) return
    void run('disable', async () => {
      // The device stops first, whatever the sidecar says: a device that asked to stop must stop.
      // An entry the sidecar keeps is dropped the first time the push service calls it gone.
      await current.unsubscribe().catch(() => {})
      setSubscription(null)
      await deleteSubscription(current.endpoint)
    })
  }, [run, subscription])

  const test = useCallback(() => {
    const current = subscription
    if (!current) return
    void run('test', async () => {
      try {
        await sendTestPush(current.endpoint)
      } catch (caught) {
        // The push service disowned this device: the local subscription is dead too.
        if (caught instanceof ApiError && caught.status === 410) {
          await current.unsubscribe().catch(() => {})
          setSubscription(null)
        }
        throw caught
      }
      setNotice(en.push.testSent)
    })
  }, [run, subscription])

  return { availability, subscription, busy, error, notice, enable, disable, test }
}
