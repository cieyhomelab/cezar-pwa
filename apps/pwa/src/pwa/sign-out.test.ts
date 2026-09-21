import { afterEach, describe, expect, it, vi } from 'vitest'
import { type SignOutDeps, clearLocalData, signOut } from './sign-out.ts'

const ENDPOINT = 'https://web.push.apple.com/QGuQyavXutnMb'

/** Deps that record the order they were called in. */
function deps(overrides: Partial<SignOutDeps> & { subscribed?: boolean; unsubscribes?: boolean } = {}) {
  const calls: string[] = []
  const { subscribed = true, unsubscribes = true, ...rest } = overrides
  const subscription = {
    endpoint: ENDPOINT,
    unsubscribe: vi.fn(async () => {
      calls.push('unsubscribe')
      return unsubscribes
    }),
  }
  const base: SignOutDeps = {
    pushManager: async () => ({ getSubscription: async () => (subscribed ? subscription : null) }),
    forgetDevice: vi.fn(async (endpoint: string) => {
      calls.push(`forget ${endpoint}`)
    }),
    endSession: vi.fn(async () => {
      calls.push('end session')
      return true
    }),
    clearLocal: vi.fn(async () => {
      calls.push('clear local')
    }),
  }
  return { calls, subscription, deps: { ...base, ...rest } }
}

describe('signOut', () => {
  it('tells the sidecar while the session exists, then the device, then ends the session, then clears', async () => {
    const { calls, deps: d } = deps()
    await expect(signOut(d)).resolves.toEqual({ sessionEnded: true, notificationsStopped: true })
    expect(calls).toEqual([`forget ${ENDPOINT}`, 'unsubscribe', 'end session', 'clear local'])
  })

  it('unsubscribes the device even when the sidecar refuses', async () => {
    const { calls, deps: d } = deps({
      forgetDevice: async () => {
        throw new Error('502')
      },
    })
    await expect(signOut(d)).resolves.toEqual({ sessionEnded: true, notificationsStopped: true })
    expect(calls).toEqual(['unsubscribe', 'end session', 'clear local'])
  })

  it('has nothing to stop on a device that was never subscribed, or has no push at all', async () => {
    const unsubscribed = deps({ subscribed: false })
    await expect(signOut(unsubscribed.deps)).resolves.toEqual({ sessionEnded: true, notificationsStopped: true })
    expect(unsubscribed.deps.forgetDevice).not.toHaveBeenCalled()

    const noPush = deps({ pushManager: async () => undefined })
    await expect(signOut(noPush.deps)).resolves.toEqual({ sessionEnded: true, notificationsStopped: true })
  })

  it('counts the sidecar forgetting the device as stopped, even if the device will not unsubscribe', async () => {
    const { deps: d } = deps({ unsubscribes: false })
    await expect(signOut(d)).resolves.toEqual({ sessionEnded: true, notificationsStopped: true })
  })

  const sidecarDown = {
    forgetDevice: async () => {
      throw new Error('502')
    },
  }

  it.each([
    ['the sidecar refuses and the device will not unsubscribe', { ...sidecarDown, unsubscribes: false }],
    [
      'the sidecar refuses and unsubscribing throws',
      {
        ...sidecarDown,
        pushManager: async () => ({
          getSubscription: async () => ({
            endpoint: ENDPOINT,
            unsubscribe: async () => {
              throw new Error('InvalidStateError')
            },
          }),
        }),
      },
    ],
    [
      'the push manager cannot be read',
      {
        pushManager: async () => {
          throw new Error('SecurityError')
        },
      },
    ],
  ] as const)('reports notifications not stopped when %s — and still signs out', async (_, overrides) => {
    const { calls, deps: d } = deps(overrides)
    await expect(signOut(d)).resolves.toEqual({ sessionEnded: true, notificationsStopped: false })
    expect(calls.slice(-2)).toEqual(['end session', 'clear local'])
  })

  it.each([
    ['the perimeter did not confirm', async () => false],
    [
      'the perimeter was unreachable',
      async () => {
        throw new Error('offline')
      },
    ],
  ])('reports the session still open when %s — and still clears local data', async (_, endSession) => {
    const { calls, deps: d } = deps({ endSession })
    await expect(signOut(d)).resolves.toEqual({ sessionEnded: false, notificationsStopped: true })
    expect(calls.at(-1)).toBe('clear local')
  })

  it('never rejects, even when clearing fails', async () => {
    const { deps: d } = deps({
      clearLocal: async () => {
        throw new Error('quota')
      },
    })
    await expect(signOut(d)).resolves.toEqual({ sessionEnded: true, notificationsStopped: true })
  })
})

describe('clearLocalData', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('empties both storages', async () => {
    localStorage.setItem('cezar-mobile.theme', 'light')
    sessionStorage.setItem('x', '1')
    await clearLocalData()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('deletes every IndexedDB database, including one another tab holds open', async () => {
    const deleted: string[] = []
    vi.stubGlobal('indexedDB', {
      databases: async () => [{ name: 'keyval-store' }, { name: 'held' }, {}],
      deleteDatabase: (name: string) => {
        deleted.push(name)
        const request: Record<string, (() => void) | null> = { onsuccess: null, onerror: null, onblocked: null }
        queueMicrotask(() => (name === 'held' ? request.onblocked : request.onsuccess)?.())
        return request
      },
    })
    await clearLocalData()
    expect(deleted).toEqual(['keyval-store', 'held'])
  })
})
