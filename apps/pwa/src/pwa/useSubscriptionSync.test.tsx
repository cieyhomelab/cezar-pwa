import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSubscriptionSync } from './useSubscriptionSync.ts'

const ENDPOINT = 'https://web.push.apple.com/QGuQyavXutnMb'
let fetch: ReturnType<typeof vi.fn>
let permission: NotificationPermission

function device(subscribed: boolean) {
  const subscription = {
    endpoint: ENDPOINT,
    options: { applicationServerKey: null },
    toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: 'p', auth: 'a' } }),
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => (subscribed ? subscription : null) } }) },
  })
}

function Probe({ standalone }: { standalone: boolean }) {
  useSubscriptionSync(standalone)
  return null
}

beforeEach(() => {
  permission = 'granted'
  vi.stubGlobal(
    'Notification',
    class {
      static get permission() {
        return permission
      }
    },
  )
  fetch = vi.fn(async () => new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (navigator as { serviceWorker?: unknown }).serviceWorker
})

const posted = () => fetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')

describe('useSubscriptionSync', () => {
  it("re-registers the installed app's subscription with the sidecar on launch (S-11)", async () => {
    device(true)
    render(<Probe standalone />)
    await waitFor(() => expect(posted()).toHaveLength(1))
    const [path, init] = posted()[0] ?? []
    expect(path).toBe('/m/push/subscription')
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ endpoint: ENDPOINT })
  })

  it.each([
    ['a browser tab', false, 'granted' as const, true],
    ['permission not granted', true, 'default' as const, true],
    ['no subscription on the device', true, 'granted' as const, false],
  ])('stays quiet for %s', async (_, standalone, granted, subscribed) => {
    permission = granted
    device(subscribed)
    render(<Probe standalone={standalone} />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('swallows a sidecar that is down: Settings reports it when the operator looks', async () => {
    device(true)
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const onError = vi.fn()
    window.addEventListener('unhandledrejection', onError)
    render(<Probe standalone />)
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 20))
    window.removeEventListener('unhandledrejection', onError)
    expect(onError).not.toHaveBeenCalled()
  })
})
