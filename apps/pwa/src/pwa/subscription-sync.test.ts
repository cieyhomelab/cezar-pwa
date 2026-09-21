import { describe, expect, it, vi } from 'vitest'
import { replaceSubscription, resyncSubscription, type SyncDeps } from './subscription-sync.ts'

const KEY = new Uint8Array([4, 5, 6]).buffer

function subscription(endpoint: string, key: ArrayBuffer | null = KEY) {
  return {
    endpoint,
    options: { applicationServerKey: key },
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'p', auth: 'a' } }),
  }
}

function deps() {
  const log: string[] = []
  const sidecar = {
    save: vi.fn(async (json: PushSubscriptionJSON) => {
      log.push(`save ${json.endpoint}`)
    }),
    remove: vi.fn(async (endpoint: string) => {
      log.push(`remove ${endpoint}`)
    }),
  } satisfies SyncDeps
  return { sidecar, log }
}

describe('resyncSubscription (on opening the app)', () => {
  it("tells the sidecar about this device's subscription again", async () => {
    const { sidecar, log } = deps()
    expect(await resyncSubscription({ getSubscription: async () => subscription('https://a/new') }, sidecar)).toBe(true)
    expect(log).toEqual(['save https://a/new'])
  })

  it('does nothing for a device with notifications off', async () => {
    const { sidecar, log } = deps()
    expect(await resyncSubscription({ getSubscription: async () => null }, sidecar)).toBe(false)
    expect(log).toEqual([])
  })
})

describe('replaceSubscription (pushsubscriptionchange)', () => {
  it('stores the replacement first, then drops the dead endpoint (FR-044)', async () => {
    const { sidecar, log } = deps()
    const subscribe = vi.fn()
    await replaceSubscription(
      { oldSubscription: subscription('https://a/old'), newSubscription: subscription('https://a/new') },
      { subscribe },
      sidecar,
    )
    expect(log).toEqual(['save https://a/new', 'remove https://a/old'])
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('subscribes again with the old key when the browser handed over no replacement', async () => {
    const { sidecar, log } = deps()
    const subscribe = vi.fn(async () => subscription('https://a/again'))
    await replaceSubscription({ oldSubscription: subscription('https://a/old'), newSubscription: null }, { subscribe }, sidecar)
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: KEY })
    expect(log).toEqual(['save https://a/again', 'remove https://a/old'])
  })

  it('drops the dead endpoint even when storing the new one fails', async () => {
    const { sidecar, log } = deps()
    sidecar.save.mockRejectedValueOnce(new Error('sidecar down'))
    await expect(
      replaceSubscription(
        { oldSubscription: subscription('https://a/old'), newSubscription: subscription('https://a/new') },
        { subscribe: vi.fn() },
        sidecar,
      ),
    ).rejects.toThrow('sidecar down')
    expect(log).toEqual(['remove https://a/old'])
  })

  it('never removes the endpoint it just stored', async () => {
    const { sidecar, log } = deps()
    const same = subscription('https://a/same')
    await replaceSubscription({ oldSubscription: same, newSubscription: same }, { subscribe: vi.fn() }, sidecar)
    await replaceSubscription(
      { oldSubscription: same, newSubscription: null },
      { subscribe: async () => subscription('https://a/same') },
      sidecar,
    )
    expect(log).toEqual(['save https://a/same', 'save https://a/same'])
  })

  it('with no old key and no replacement, stores nothing and drops the old endpoint', async () => {
    const { sidecar, log } = deps()
    const subscribe = vi.fn()
    await replaceSubscription(
      { oldSubscription: subscription('https://a/old', null), newSubscription: null },
      { subscribe },
      sidecar,
    )
    expect(subscribe).not.toHaveBeenCalled()
    expect(log).toEqual(['remove https://a/old'])
  })
})
