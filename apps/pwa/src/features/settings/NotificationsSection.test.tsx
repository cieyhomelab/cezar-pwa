import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../../../test/query.tsx'
import { SettingsScreen } from './SettingsScreen.tsx'

/**
 * S-10 in jsdom: the Settings section across the device's states (FR-036, FR-037), and the
 * enable / test / disable round trips against a stubbed sidecar. The real prompt, the real push
 * service and the lock screen are the device checklist's.
 */

const KEY = 'BPpbtCsdAm_BdyJwV812MSbdh2qolBEg8jHCrz_gn-ukYsPfNenr1sKDy6sMZDkOTMDZ2EhZwPH8f6Zw9ZQ2Pv4'
const ENDPOINT = 'https://web.push.apple.com/QGuQyavXutnMb'

type Call = { method: string; path: string; body: unknown }
let calls: Call[]
let answers: Record<string, () => Response>

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function fakeSubscription() {
  return {
    endpoint: ENDPOINT,
    options: { applicationServerKey: null as ArrayBuffer | null },
    toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn(async () => true),
  }
}

let existing: ReturnType<typeof fakeSubscription> | null
let pushManager: { getSubscription: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }
let permission: NotificationPermission
let requestPermission: ReturnType<typeof vi.fn>

function install({ standalone = true, push = true } = {}) {
  Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => standalone })
  pushManager = {
    getSubscription: vi.fn(async () => existing),
    subscribe: vi.fn(async () => {
      existing = fakeSubscription()
      return existing
    }),
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }), addEventListener: vi.fn(), removeEventListener: vi.fn() },
  })
  requestPermission = vi.fn(async () => permission)
  vi.stubGlobal(
    'Notification',
    class {
      static get permission() {
        return permission
      }
      static requestPermission = requestPermission
    },
  )
  if (push) vi.stubGlobal('PushManager', class {})
}

beforeEach(() => {
  calls = []
  existing = null
  permission = 'default'
  answers = {
    'GET /m/push/vapid-public-key': () => json({ publicKey: KEY }),
    'POST /m/push/subscription': () => json({ ok: true }, 201),
    'DELETE /m/push/subscription': () => json({ removed: true }),
    'POST /m/push/test': () => json({ sent: true }),
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined })
      return (answers[`${method} ${path}`] ?? (() => json({ error: 'not found' }, 404)))()
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (navigator as { standalone?: unknown }).standalone
  delete (navigator as { serviceWorker?: unknown }).serviceWorker
})

const render = () => renderWithQuery(<SettingsScreen />, undefined, '/settings')
const section = () => screen.getByRole('region', { name: 'Powiadomienia' })

describe('Settings → Powiadomienia', () => {
  it('in a browser tab, shows how to install instead of a button that cannot work (FR-037)', () => {
    install({ standalone: false, push: false })
    render()
    expect(screen.getByRole('note')).toHaveTextContent('Najpierw dodaj Cezara do ekranu początkowego')
    // S-12's sign-out button sits below, so "no button" is this section's; and Versions asks
    // Cezar for its version, so "no calls" is the sidecar's.
    expect(within(section()).queryByRole('button')).toBeNull()
    expect(calls.filter((call) => call.path.startsWith('/m/push/'))).toEqual([])
  })

  it('says what a notification carries — and that it carries no code or transcript (FR-043)', () => {
    install({ standalone: false, push: false })
    render()
    expect(section()).toHaveTextContent('bez kodu i bez treści rozmowy')
  })

  it('installed on a phone without Web Push, says so', () => {
    install({ push: false })
    render()
    expect(section()).toHaveTextContent('potrzebny iOS 16.4')
    expect(within(section()).queryByRole('button')).toBeNull()
  })

  it('refused once, points at the system settings', () => {
    install()
    permission = 'denied'
    render()
    expect(section()).toHaveTextContent('Ustawieniach iOS')
    expect(within(section()).queryByRole('button')).toBeNull()
  })

  it('turns notifications on from a tap: prompt, subscribe with the key, register (FR-036)', async () => {
    install()
    render()
    const enable = await screen.findByRole('button', { name: 'Włącz powiadomienia' })
    await waitFor(() => expect(calls.map((c) => c.path)).toContain('/m/push/vapid-public-key'))
    requestPermission.mockImplementationOnce(async () => {
      permission = 'granted'
      return permission
    })
    fireEvent.click(enable)

    await screen.findByText('Powiadomienia są włączone na tym urządzeniu.')
    expect(requestPermission).toHaveBeenCalledOnce()
    const options = pushManager.subscribe.mock.calls[0]?.[0]
    expect(options.userVisibleOnly).toBe(true)
    expect(options.applicationServerKey).toHaveLength(65)
    expect(calls.find((c) => c.method === 'POST')).toEqual({
      method: 'POST',
      path: '/m/push/subscription',
      body: { endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: 'p', auth: 'a' } },
    })
  })

  it('a subscription made with an old key is dropped on the sidecar too, not left to bounce (S-11)', async () => {
    install()
    render()
    const enable = await screen.findByRole('button', { name: 'Włącz powiadomienia' })
    await waitFor(() => expect(calls.map((c) => c.path)).toContain('/m/push/vapid-public-key'))
    const stale = { ...fakeSubscription(), endpoint: `${ENDPOINT}-old`, options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer } }
    existing = stale
    permission = 'granted'
    fireEvent.click(enable)

    await screen.findByText('Powiadomienia są włączone na tym urządzeniu.')
    expect(stale.unsubscribe).toHaveBeenCalledOnce()
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([
      { method: 'DELETE', path: '/m/push/subscription', body: { endpoint: `${ENDPOINT}-old` } },
      { method: 'POST', path: '/m/push/subscription', body: { endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: 'p', auth: 'a' } } },
    ])
  })

  it('a dismissed prompt subscribes nothing and says why', async () => {
    install()
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Włącz powiadomienia' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nie udzielono zgody')
    expect(pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('a device the sidecar could not register does not look enabled', async () => {
    install()
    permission = 'granted'
    answers['POST /m/push/subscription'] = () =>
      new Response('<html>403</html>', { status: 403, headers: { 'content-type': 'text/html' } })
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Włącz powiadomienia' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sesja z Cezarem wygasła')
    expect(existing?.unsubscribe).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Włącz powiadomienia' })).toBeEnabled()
  })

  it('says the notification server is down when nginx answers for it', async () => {
    install()
    permission = 'granted'
    answers['POST /m/push/subscription'] = () =>
      new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } })
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Włącz powiadomienia' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Serwer powiadomień nie odpowiada')
  })

  it('says the notification server is down, not that the session expired, when the app shell answers for it (#31)', async () => {
    install()
    permission = 'granted'
    // /m/push/ not routed to the sidecar: the SPA fallback serves index.html with a 200.
    answers['GET /m/push/vapid-public-key'] = () =>
      new Response('<!doctype html><title>Cezar</title>', { status: 200, headers: { 'content-type': 'text/html' } })
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Włącz powiadomienia' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Serwer powiadomień nie odpowiada')
    expect(alert).not.toHaveTextContent('Sesja z Cezarem wygasła')
    expect(pushManager.subscribe).not.toHaveBeenCalled()
  })

  describe('when this device is subscribed', () => {
    beforeEach(() => {
      install()
      permission = 'granted'
      existing = fakeSubscription()
    })

    it('sends a test to this device only (FR-045)', async () => {
      render()
      fireEvent.click(await screen.findByRole('button', { name: 'Wyślij powiadomienie testowe' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Wysłane')
      expect(calls.find((c) => c.path === '/m/push/test')?.body).toEqual({ endpoint: ENDPOINT })
    })

    it('a test the sidecar cannot place tells the operator to re-enable', async () => {
      answers['POST /m/push/test'] = () => json({ error: 'unknown subscription' }, 404)
      render()
      fireEvent.click(await screen.findByRole('button', { name: 'Wyślij powiadomienie testowe' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Serwer nie zna tego urządzenia')
    })

    it('a device the push service disowned is switched off here too', async () => {
      answers['POST /m/push/test'] = () => json({ error: 'gone' }, 410)
      const subscription = existing
      render()
      fireEvent.click(await screen.findByRole('button', { name: 'Wyślij powiadomienie testowe' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('nie zna już tego urządzenia')
      expect(subscription?.unsubscribe).toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Włącz powiadomienia' })).toBeInTheDocument()
    })

    it('turns off: the device stops, and the sidecar forgets it', async () => {
      const subscription = existing
      render()
      fireEvent.click(await screen.findByRole('button', { name: 'Wyłącz powiadomienia' }))
      await screen.findByRole('button', { name: 'Włącz powiadomienia' })
      expect(subscription?.unsubscribe).toHaveBeenCalled()
      expect(calls.find((c) => c.method === 'DELETE')?.body).toEqual({ endpoint: ENDPOINT })
    })
  })

  it('links back to the list', () => {
    install({ standalone: false, push: false })
    render()
    expect(screen.getByRole('link', { name: /Lista zadań/ })).toHaveAttribute('href', '/')
  })
})
