import type { PushPayload } from '@cezar-pwa/shared'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { LimitsCollector } from './limits/collector.ts'
import type { Pusher } from './push.ts'
import { subscriptionSchema, type SubscriptionStore } from './store.ts'
import type { Watcher } from './watcher.ts'

/**
 * The sidecar's HTTP surface, under `/m/push/` (REQUIREMENTS A6, § 6). nginx forwards it only for
 * a request that passes the same cookie gate as the cockpit, so everything here is already the
 * operator; the checks below are about what a page on another site could make their browser do.
 *
 * Errors are `{ error }`, Cezar's own shape, so the PWA's HTTP wrapper reads both alike.
 */
export type AppDeps = {
  store: SubscriptionStore
  pusher: Pusher
  watcher: Pick<Watcher, 'state' | 'statuses' | 'seededAt'>
  publicKey: string
  /** `PUBLIC_ORIGIN`, e.g. `https://cezar.example.com` — the only origin a write may come from (CLAUDE.md rule 1). */
  publicOrigin: string
  limits: Pick<LimitsCollector, 'snapshot'>
}

const endpointBody = z.object({ endpoint: z.string().min(1).max(2048) })

/** The test push (FR-045): says it is a test, carries nothing else. */
const TEST_PAYLOAD: PushPayload = { kind: 'test' }

export function createApp(deps: AppDeps): Hono {
  const app = new Hono().basePath('/m/push')

  // Same-origin writes only, like Cezar's own guard. A browser always sends `Origin` on a
  // cross-origin POST/DELETE; a missing one is a same-origin request or a non-browser client,
  // both already past the gate.
  app.use('*', async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return next()
    const origin = c.req.header('origin')
    if (origin !== undefined && origin !== deps.publicOrigin) {
      return c.json({ error: 'cross-origin write refused' }, 403)
    }
    return next()
  })
  app.use('*', bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json({ error: 'body too large' }, 413) }))

  app.get('/vapid-public-key', (c) => c.json({ publicKey: deps.publicKey }))

  app.post('/subscription', async (c) => {
    const parsed = subscriptionSchema.safeParse(await readJson(c.req.raw))
    if (!parsed.success) return c.json({ error: 'not a push subscription this service accepts' }, 400)
    await deps.store.upsert(parsed.data)
    return c.json({ ok: true }, 201)
  })

  app.delete('/subscription', async (c) => {
    const parsed = endpointBody.safeParse(await readJson(c.req.raw))
    if (!parsed.success) return c.json({ error: 'missing endpoint' }, 400)
    return c.json({ removed: await deps.store.remove(parsed.data.endpoint) })
  })

  // To this device only: the operator is checking the chain from the phone in their hand.
  app.post('/test', async (c) => {
    const parsed = endpointBody.safeParse(await readJson(c.req.raw))
    if (!parsed.success) return c.json({ error: 'missing endpoint' }, 400)
    const subscription = deps.store.find(parsed.data.endpoint)
    if (!subscription) return c.json({ error: 'unknown subscription' }, 404)
    const delivery = await deps.pusher.sendTo(subscription, TEST_PAYLOAD)
    if (delivery === 'sent') return c.json({ sent: true })
    if (delivery === 'gone') return c.json({ error: 'push service reports the subscription gone' }, 410)
    // A stall is the gateway's fault, not the device's: 504, which the app reads as "try later".
    if (delivery === 'timeout') return c.json({ error: 'push service did not answer in time' }, 504)
    return c.json({ error: 'push service refused the notification' }, 502)
  })

  // Counts and states only — never a task.
  app.get('/health', (c) =>
    c.json({
      ok: true,
      stream: deps.watcher.state,
      seededAt: deps.watcher.seededAt ?? null,
      runs: deps.watcher.statuses.size,
      subscriptions: deps.store.list().length,
    }),
  )

  // The collector's last pass (#92). Reading it starts no work: the sidecar polls on its own clock.
  app.get('/limits', (c) => {
    c.header('cache-control', 'no-store')
    return c.json(deps.limits.snapshot())
  })

  app.notFound((c) => c.json({ error: 'not found' }, 404))
  app.onError((_error, c) => c.json({ error: 'internal error' }, 500))
  return app
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}
