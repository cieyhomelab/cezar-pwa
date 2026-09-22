import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isPushServiceEndpoint, MAX_SUBSCRIPTIONS, SubscriptionStore, subscriptionSchema } from './store.ts'
import { APPLE, subscription } from './testing.ts'

describe('isPushServiceEndpoint', () => {
  it.each([
    [APPLE, true],
    ['https://fcm.googleapis.com/fcm/send/abc', true],
    ['https://updates.push.services.mozilla.com/wpush/v2/abc', true],
    ['http://web.push.apple.com/abc', false],
    ['https://push.apple.com.evil.example/abc', false],
    ['https://127.0.0.1:4322/api/v1/p/x/runs', false],
    ['https://cezar.ciey.studio/m/', false],
    ['not a url', false],
  ])('%s → %s', (endpoint, expected) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(expected)
  })
})

describe('subscriptionSchema', () => {
  it('accepts what PushSubscription.toJSON() produces, dropping unknown fields', () => {
    const parsed = subscriptionSchema.parse({ ...subscription(), extra: 1 })
    expect(parsed).toEqual(subscription())
  })

  it('refuses a subscription without keys', () => {
    expect(subscriptionSchema.safeParse({ endpoint: APPLE }).success).toBe(false)
  })
})

describe('SubscriptionStore', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cezar-push-'))
    file = join(dir, 'state', 'subscriptions.json')
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('starts empty when there is no file yet', async () => {
    const store = new SubscriptionStore(file)
    await store.load()
    expect(store.list()).toEqual([])
  })

  it('persists across restarts, mode 0600', async () => {
    const store = new SubscriptionStore(file)
    await store.upsert(subscription())
    expect((await stat(file)).mode & 0o777).toBe(0o600)

    const reloaded = new SubscriptionStore(file)
    await reloaded.load()
    expect(reloaded.find(APPLE)?.keys).toEqual(subscription().keys)
  })

  it('keys on the endpoint, so re-enabling the same device is not a second one', async () => {
    const store = new SubscriptionStore(file)
    await store.upsert(subscription())
    await store.upsert(subscription())
    expect(store.list()).toHaveLength(1)
  })

  it('removes by endpoint and says whether it was there', async () => {
    const store = new SubscriptionStore(file)
    await store.upsert(subscription())
    expect(await store.remove(APPLE)).toBe(true)
    expect(await store.remove(APPLE)).toBe(false)
    const reloaded = new SubscriptionStore(file)
    await reloaded.load()
    expect(reloaded.list()).toEqual([])
  })

  it('caps the list, making room by dropping the oldest', async () => {
    const store = new SubscriptionStore(file)
    for (let i = 0; i <= MAX_SUBSCRIPTIONS; i += 1) await store.upsert(subscription(`${APPLE}${i}`))
    expect(store.list()).toHaveLength(MAX_SUBSCRIPTIONS)
    expect(store.find(`${APPLE}0`)).toBeUndefined()
  })

  it('refuses to start over an unreadable file instead of wiping it', async () => {
    await new SubscriptionStore(file).upsert(subscription())
    await writeFile(file, '{ not json')
    await expect(new SubscriptionStore(file).load()).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe('{ not json')
  })

  it('refuses to start over a file with the wrong top-level shape', async () => {
    await new SubscriptionStore(file).upsert(subscription())
    await writeFile(file, '[]')
    await expect(new SubscriptionStore(file).load()).rejects.toThrow()
  })

  it('recovers after a failed write, and the next save brings the file level with memory', async () => {
    // The state directory is a regular file, so the first write cannot create it.
    await writeFile(dirname(file), '')
    const store = new SubscriptionStore(file)
    await expect(store.upsert(subscription(`${APPLE}a`))).rejects.toThrow()

    await rm(dirname(file))
    await store.upsert(subscription(`${APPLE}b`))
    const reloaded = new SubscriptionStore(file)
    await reloaded.load()
    expect(reloaded.list()).toEqual(store.list())
    expect(reloaded.list().map((entry) => entry.endpoint)).toEqual([`${APPLE}a`, `${APPLE}b`])
  })

  it('loads the valid entries and sets the invalid ones aside, without rewriting the file', async () => {
    const good = { ...subscription(), createdAt: '2026-09-22T00:00:00.000Z' }
    const bad = { ...subscription('https://push.example/abc'), createdAt: '2026-09-22T00:00:00.000Z' }
    await mkdir(dirname(file), { recursive: true })
    const raw = JSON.stringify({ subscriptions: [bad, good] })
    await writeFile(file, raw)

    const store = new SubscriptionStore(file)
    expect(await store.load()).toBe(1)
    expect(store.list()).toEqual([good])
    expect(await readFile(file, 'utf8')).toBe(raw)
    expect(JSON.parse(await readFile(store.rejectedFile, 'utf8'))).toEqual([bad])
    expect((await stat(store.rejectedFile)).mode & 0o777).toBe(0o600)

    // A second start adds nothing twice.
    expect(await new SubscriptionStore(file).load()).toBe(1)
    expect(JSON.parse(await readFile(store.rejectedFile, 'utf8'))).toEqual([bad])
  })
})
