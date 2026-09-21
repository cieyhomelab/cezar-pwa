/// <reference lib="webworker" />
import { createHandlerBoundToURL, precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NAVIGATE_MESSAGE, notificationFor, pickAppWindow, readPushPayload } from './pwa/push-message.ts'

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

/**
 * S-10. The `cezar-push` sidecar sends a structured payload; `push-message.ts` turns it into the
 * notification — which task, which project, why, and nothing else (FR-038, FR-043).
 */
self.addEventListener('push', (event) => {
  let raw: unknown
  try {
    raw = event.data?.json()
  } catch {
    // Not JSON: shown as a bare "needs attention", never as whatever text arrived.
    raw = undefined
  }
  const { title, options } = notificationFor(readPushPayload(raw))
  event.waitUntil(self.registration.showNotification(title, options))
})

/**
 * FR-041: a tap opens that task's transcript, reusing an open window. The open window is told
 * where to go rather than navigated, so it routes in place and keeps what it already loaded; with
 * no window open, the task's URL is opened cold — the navigation route above serves the shell.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data as { url?: unknown } | undefined)?.url
  const url = typeof target === 'string' ? target : '/m/'

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = pickAppWindow(windows)
      if (existing) {
        const focused = await existing.focus().catch(() => existing)
        focused.postMessage({ type: NAVIGATE_MESSAGE, url })
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})
