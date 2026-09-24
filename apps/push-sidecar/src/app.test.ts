import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PushPayload } from '@cezar-pwa/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.ts'
import { Pusher, PUSH_TIMEOUT_MS, PUSH_TTL_SECONDS, topicFor, type SendNotification } from './push.ts'
import { SubscriptionStore } from './store.ts'
import { APPLE, subscription } from './testing.ts'

const ORIGIN = 'https://cezar.example.test'
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
    expect(options).toMatchObject({
      TTL: PUSH_TTL_SECONDS,
      urgency: 'high',
      // So the real web-push request lets go of a silent socket too, not just the promise.
      timeout: PUSH_TIMEOUT_MS,
      vapidDetails: { subject: ORIGIN },
    })
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

describe('a push service that accepts the connection and then stalls (#37)', () => {
  /** The push service that answers neither yes nor no. */
  const stall = () => new Promise<never>(() => {})

  beforeEach(async () => {
    await store.upsert(subscription())
    send.mockImplementation(stall)
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('gives up on the send at the deadline and keeps the device', async () => {
    const log = vi.fn()
    const pusher = new Pusher({ store, vapid, subject: ORIGIN, send, log })
    const delivery = pusher.sendTo(store.list()[0]!, { kind: 'test' })
    await vi.advanceTimersByTimeAsync(PUSH_TIMEOUT_MS)
    expect(await delivery).toBe('timeout')
    // A stalled service says nothing about the device: it is still ours to push to.
    expect(store.list()).toHaveLength(1)
    // How long, never where.
    expect(log.mock.calls.flat().join(' ')).not.toContain(APPLE)
  })

  it('stays pending right up to the deadline, rather than giving up early', async () => {
    const settled = vi.fn()
    void new Pusher({ store, vapid, subject: ORIGIN, send }).sendTo(store.list()[0]!, { kind: 'test' }).then(settled)
    await vi.advanceTimersByTimeAsync(PUSH_TIMEOUT_MS - 1)
    expect(settled).not.toHaveBeenCalled()
  })

  it('answers a test push with 504, which the app reads as "the push service is unavailable"', async () => {
    const response = call('POST', '/test', { endpoint: APPLE })
    await vi.advanceTimersByTimeAsync(PUSH_TIMEOUT_MS)
    expect((await response).status).toBe(504)
    expect(store.find(APPLE)).toBeDefined()
  })
})

describe('Pusher.sendTo, staying honest (S-11)', () => {
  const attention = (runId: string, projectId = 'cezar-pwa'): PushPayload => ({ kind: 'attention', projectId, runId })

  it('gives every push about one task the same topic, so the push service keeps only the newest (FR-039)', async () => {
    await store.upsert(subscription())
    const pusher = new Pusher({ store, vapid, subject: ORIGIN, send })
    await pusher.sendTo(subscription(), { ...attention('r1'), reason: 'needs you' })
    await pusher.sendTo(subscription(), { ...attention('r1'), reason: 'failed' })
    await pusher.sendTo(subscription(), attention('r2'))
    const topics = send.mock.calls.map(([, , options]) => options.topic)
    expect(topics[0]).toBe(topics[1])
    expect(topics[2]).not.toBe(topics[0])
  })

  it('keeps topics inside what the Web Push protocol allows, and the task out of them', () => {
    const topic = topicFor(attention('run-with-a-rather-long-identifier', 'a-project-with-a-long-name'))
    expect(topic).toMatch(/^[A-Za-z0-9_-]{1,32}$/)
    expect(topic).not.toContain('run')
    // Same run id, another project: another task, another topic.
    expect(topicFor(attention('r1', 'kai-phone'))).not.toBe(topicFor(attention('r1')))
  })

  it('sends the test without a topic: it must not replace a real notification waiting to be delivered', async () => {
    await store.upsert(subscription())
    await new Pusher({ store, vapid, subject: ORIGIN, send }).sendTo(subscription(), { kind: 'test' })
    expect(send.mock.calls[0]?.[2]).not.toHaveProperty('topic')
  })

  it('drops a subscription past its expiration time without calling the push service (FR-044)', async () => {
    const expired = { ...subscription(), expirationTime: 1_000 }
    await store.upsert(expired)
    await store.upsert(subscription(`${APPLE}-2`))
    const log = vi.fn()
    const pusher = new Pusher({ store, vapid, subject: ORIGIN, send, log, now: () => 2_000 })
    expect(await pusher.sendToAll(attention('r1'))).toEqual(['gone', 'sent'])
    expect(send).toHaveBeenCalledOnce()
    expect(store.list().map((entry) => entry.endpoint)).toEqual([`${APPLE}-2`])
    expect(log).toHaveBeenCalledWith('dropped an expired subscription')
  })

  it('keeps a subscription whose expiration time is still ahead', async () => {
    await store.upsert({ ...subscription(), expirationTime: 3_000 })
    const pusher = new Pusher({ store, vapid, subject: ORIGIN, send, now: () => 2_000 })
    expect(await pusher.sendTo(store.list()[0]!, attention('r1'))).toBe('sent')
    expect(store.list()).toHaveLength(1)
  })

  it('answers a test to an expired device with 410, so the app drops its own copy too', async () => {
    await store.upsert({ ...subscription(), expirationTime: 1 })
    const response = await call('POST', '/test', { endpoint: APPLE })
    expect(response.status).toBe(410)
    expect(send).not.toHaveBeenCalled()
    expect(store.list()).toHaveLength(0)
  })
})
