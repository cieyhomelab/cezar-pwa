/// <reference lib="webworker" />
import { createHandlerBoundToURL, precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope

/**
 * Service worker for the shell at /m/.
 *
 * Hard rule (CLAUDE.md #4): this worker never touches `/api/**` or an SSE
 * stream. It registers exactly two routes — the precache route (which only
 * matches build outputs) and a navigation fallback whose denylist keeps `/api/`
 * and `/m/push/` out. Everything else falls through to the network with no
 * `respondWith`, which is what SSE needs to stay unbuffered.
 */

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Deep links like /m/run/<projectId>/<runId> must resolve offline too, or a
// notification tap on a cold app yields a white screen.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/m/index.html'), {
    // `?key=` is the unlock navigation (S-02). It MUST reach the network: the
    // gateway can only issue the session cookie for a request it actually
    // sees, and answering this one from the precache would make unlocking
    // silently impossible — the app would come back with the key unconsumed
    // every time, no matter how the gateway is configured. Denylist patterns
    // are tested against pathname + search, so this matches.
    denylist: [/^\/api\//, /^\/m\/push\//, /[?&]key=/],
  }),
)

// F-PWA-5: the page asks the user before the new worker takes over.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

/** Payload written by the `cezar-push` sidecar (F-PUSH-4). */
type PushPayload = {
  title?: string
  body?: string
  projectId?: string
  runId?: string
  /** Number of runs needing attention, for the icon badge (F-PUSH-8). */
  attentionCount?: number
}

function readPayload(event: PushEvent): PushPayload {
  if (!event.data) return {}
  try {
    // Unknown fields are ignored on purpose — the vocabulary is append-only
    // (CLAUDE.md rule 5).
    return event.data.json() as PushPayload
  } catch {
    return { body: event.data.text() }
  }
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event)
  const url =
    payload.projectId && payload.runId
      ? `/m/run/${payload.projectId}/${payload.runId}`
      : '/m/'

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(payload.title ?? 'Cezar', {
        body: payload.body,
        // One notification per run: a newer one replaces the previous
        // (F-PUSH-7).
        tag: payload.runId ?? 'cezar',
        icon: '/m/icons/icon-192.png',
        badge: '/m/icons/icon-192.png',
        data: { url },
      })

      if (typeof payload.attentionCount === 'number' && 'setAppBadge' in self.navigator) {
        await self.navigator.setAppBadge(payload.attentionCount).catch(() => {})
      }
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data as { url?: string } | undefined)?.url ?? '/m/'

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      // Focus an open window and route it, rather than opening a second one
      // (F-PUSH-6).
      for (const client of clients) {
        if (new URL(client.url).pathname.startsWith('/m/')) {
          await client.focus()
          if ('navigate' in client) await client.navigate(target).catch(() => {})
          return
        }
      }
      await self.clients.openWindow(target)
    })(),
  )
})
