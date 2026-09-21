import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PushPayload } from '@cezar-pwa/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.ts'
import { Pusher, PUSH_TTL_SECONDS, type SendNotification } from './push.ts'
import { SubscriptionStore } from './store.ts'
import { APPLE, subscription } from './testing.ts'

const ORIGIN = 'https://cezar.ciey.studio'
const vapid = { publicKey: 'BPublicKey', privateKey: 'private' }

let dir: string
let store: SubscriptionStore
let send: ReturnType<typeof vi.fn<SendNotification>>
let app: ReturnType<typeof createApp>

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cezar-push-'))
  store = new SubscriptionStore(join(dir, 'subscriptions.json'))
  send = vi.fn<SendNotification>(async () => ({}))
  const pusher = new Pusher({ store, vapid, subject: ORIGIN, send })
  const watcher = { state: 'live' as const, statuses: new Map([['cezar-pwa/r1', 'waiting' as const]]), seededAt: 'now' }
  app = createApp({ store, pusher, watcher, publicKey: vapid.publicKey, publicOrigin: ORIGIN })
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(`/m/push${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

describe('the /m/push/ surface', () => {
  it('hands out the public VAPID key', async () => {
    const response = await call('GET', '/vapid-public-key')
    expect(await response.json()).toEqual({ publicKey: 'BPublicKey' })
  })

  it('stores a subscription, then removes it', async () => {
    expect((await call('POST', '/subscription', subscription(), { origin: ORIGIN })).status).toBe(201)
    expect(store.find(APPLE)).toBeDefined()
    expect(await (await call('DELETE', '/subscription', { endpoint: APPLE })).json()).toEqual({ removed: true })
    expect(store.list()).toEqual([])
  })

  it('refuses a subscription to anything but a push service', async () => {
    const response = await call('POST', '/subscription', subscription('https://127.0.0.1:4322/api/v1/x'))
    expect(response.status).toBe(400)
    expect(await response.json()).toHaveProperty('error')
    expect(store.list()).toEqual([])
  })

  it('refuses a write from another origin, with Cezar-shaped errors', async () => {
    const response = await call('POST', '/subscription', subscription(), { origin: 'https://evil.example' })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'cross-origin write refused' })
  })

  it('refuses an oversized body', async () => {
    const response = await call('POST', '/subscription', { ...subscription(), pad: 'x'.repeat(10_000) })
    expect(response.status).toBe(413)
  })

  it('sends a test to the asking device only, carrying nothing but "test" (FR-045)', async () => {
    await store.upsert(subscription())
    await store.upsert(subscription(`${APPLE}-laptop`))
    const response = await call('POST', '/test', { endpoint: APPLE })
    expect(await response.json()).toEqual({ sent: true })
    expect(send).toHaveBeenCalledOnce()
    const [target, payload, options] = send.mock.calls[0]!
    expect(target.endpoint).toBe(APPLE)
    expect(JSON.parse(payload) as PushPayload).toEqual({ kind: 'test' })
    expect(options).toMatchObject({ TTL: PUSH_TTL_SECONDS, urgency: 'high', vapidDetails: { subject: ORIGIN } })
  })

  it('says when the device is unknown, so the app can offer to re-enable', async () => {
    const response = await call('POST', '/test', { endpoint: APPLE })
    expect(response.status).toBe(404)
  })

  it('drops a device the push service reports gone, and says so (FR-044)', async () => {
    await store.upsert(subscription())
    send.mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410, body: 'payload echo' }))
    const response = await call('POST', '/test', { endpoint: APPLE })
    expect(response.status).toBe(410)
    expect(store.list()).toEqual([])
  })

  it('reports counts and states on /health, never a task', async () => {
    await store.upsert(subscription())
    const body = await (await call('GET', '/health')).json()
    expect(body).toEqual({ ok: true, stream: 'live', seededAt: 'now', runs: 1, subscriptions: 1 })
  })

  it('answers an unknown path with a JSON 404', async () => {
    const response = await call('GET', '/nope')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not found' })
  })
})

describe('Pusher.sendToAll', () => {
  it('delivers to every device and keeps the ones that merely failed', async () => {
    await store.upsert(subscription())
    await store.upsert(subscription(`${APPLE}-2`))
    await store.upsert(subscription(`${APPLE}-3`))
    send
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(Object.assign(new Error('Not Found'), { statusCode: 404 }))
      .mockRejectedValueOnce(Object.assign(new Error('Server'), { statusCode: 500 }))
    const log = vi.fn()
    const pusher = new Pusher({ store, vapid, subject: ORIGIN, send, log })
    expect(await pusher.sendToAll({ kind: 'attention', runId: 'r1' })).toEqual(['sent', 'gone', 'failed'])
    expect(store.list().map((entry) => entry.endpoint)).toEqual([APPLE, `${APPLE}-3`])
    // The status only: the push service's body can echo the payload.
    expect(log.mock.calls.flat().join(' ')).not.toContain('payload')
  })
})
