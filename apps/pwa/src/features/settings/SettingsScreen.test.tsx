import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../../../test/query.tsx'
import { TESTED_CEZAR_VERSION } from '../../config/cezar-compat.ts'
import { en } from '../../i18n/en.ts'
import { THEME_STORAGE_KEY } from '../../pwa/theme.ts'
import { SettingsScreen } from './SettingsScreen.tsx'
import { restart } from './useSignOut.ts'

/**
 * S-12 in jsdom: the theme (FR-046), both versions (FR-047) and sign-out (FR-006), against a
 * stubbed Cezar, sidecar and perimeter. What a real cookie jar does with the perimeter's
 * `Set-Cookie` is the nginx rehearsal's (`deploy/nginx/rehearse.sh`) and the device's.
 */

const ENDPOINT = 'https://web.push.apple.com/QGuQyavXutnMb'
const t = en.settings

type Call = { method: string; path: string }
let calls: Call[]
let answers: Record<string, () => Response>
let subscription: { endpoint: string; unsubscribe: ReturnType<typeof vi.fn> } | null

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  calls = []
  subscription = null
  answers = {
    'GET /api/v1/health': () => json({ version: '0.11.0', projects: [] }),
    'DELETE /m/push/subscription': () => json({ removed: true }),
    'POST /m/session/end': () => new Response(null, { status: 204 }),
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      calls.push({ method, path })
      return (answers[`${method} ${path}`] ?? (() => json({ error: 'not found' }, 404)))()
    }),
  )
  const pushManager = { getSubscription: vi.fn(async () => subscription) }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve({ pushManager }),
      getRegistration: async () => ({ pushManager }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  })
  vi.spyOn(restart, 'to').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (navigator as { serviceWorker?: unknown }).serviceWorker
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

const render = () => renderWithQuery(<SettingsScreen />, undefined, '/settings')

function subscribe() {
  subscription = { endpoint: ENDPOINT, unsubscribe: vi.fn(async () => true) }
  return subscription
}

async function signOutConfirmed() {
  fireEvent.click(screen.getByRole('button', { name: t.signOut.action }))
  const dialog = screen.getByRole('alertdialog', { name: t.signOut.confirmTitle })
  fireEvent.click(within(dialog).getByRole('button', { name: t.signOut.confirm }))
}

describe('Settings → Motyw (FR-046)', () => {
  it('follows the system until the operator picks, then forces and keeps the choice', () => {
    render()
    const group = screen.getByRole('radiogroup', { name: t.theme.section })
    expect(within(group).getByRole('radio', { name: t.theme.options.system })).toBeChecked()
    expect(document.documentElement.dataset.theme).toBeUndefined()

    fireEvent.click(within(group).getByRole('radio', { name: t.theme.options.light }))
    expect(within(group).getByRole('radio', { name: t.theme.options.light })).toBeChecked()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')

    fireEvent.click(within(group).getByRole('radio', { name: t.theme.options.system }))
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('opens on the stored choice', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    render()
    expect(screen.getByRole('radio', { name: t.theme.options.dark })).toBeChecked()
  })
})

describe('Settings → Wersje (FR-047)', () => {
  it('shows the build, the Cezar version the probe reported, and the one this build was tested with', async () => {
    answers['GET /api/v1/health'] = () => json({ version: '0.11.3', projects: [] })
    render()
    const versions = within(screen.getByRole('region', { name: t.versions.section }))
    expect(await versions.findByText('0.11.3')).toBeInTheDocument()
    // Nothing stamps the build under Vitest.
    expect(versions.getByText('dev')).toBeInTheDocument()
    expect(versions.getByText(TESTED_CEZAR_VERSION)).toBeInTheDocument()
    // A newer Cezar is a fact here, not a warning (PRD Non-Goals).
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Settings → Wylogowanie (FR-006)', () => {
  it('asks first, and "Anuluj" changes nothing', () => {
    render()
    fireEvent.click(screen.getByRole('button', { name: t.signOut.action }))
    fireEvent.click(screen.getByRole('button', { name: t.signOut.keep }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([])
  })

  it('forgets the device at the sidecar, unsubscribes it, ends the session, clears storage and restarts', async () => {
    const device = subscribe()
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    document.documentElement.dataset.theme = 'light'
    render()
    await signOutConfirmed()

    await waitFor(() => expect(restart.to).toHaveBeenCalledWith('/m/'))
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([
      { method: 'DELETE', path: '/m/push/subscription' },
      { method: 'POST', path: '/m/session/end' },
    ])
    expect(device.unsubscribe).toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('stays and says so when the perimeter does not end the session — the endpoint is not installed', async () => {
    // The static shell's answer to a POST.
    answers['POST /m/session/end'] = () => new Response('<html>405</html>', { status: 405 })
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    render()
    await signOutConfirmed()

    expect(await screen.findByRole('alert')).toHaveTextContent(t.signOut.sessionKept)
    expect(restart.to).not.toHaveBeenCalled()
    // The local half still happened, and the theme control reads it again.
    expect(localStorage.length).toBe(0)
    expect(screen.getByRole('radio', { name: t.theme.options.system })).toBeChecked()
    expect(screen.getByRole('button', { name: t.signOut.retry })).toBeInTheDocument()
  })

  it('stops notifications even when the sidecar is down, because the device unsubscribes', async () => {
    const device = subscribe()
    answers['DELETE /m/push/subscription'] = () => new Response('bad gateway', { status: 502 })
    render()
    await signOutConfirmed()

    await waitFor(() => expect(restart.to).toHaveBeenCalledWith('/m/'))
    expect(device.unsubscribe).toHaveBeenCalled()
  })

  it('says notifications may still arrive when neither the sidecar nor the device let go', async () => {
    const device = subscribe()
    device.unsubscribe.mockResolvedValue(false)
    answers['DELETE /m/push/subscription'] = () => new Response('bad gateway', { status: 502 })
    render()
    await signOutConfirmed()

    expect(await screen.findByRole('alert')).toHaveTextContent(t.signOut.notificationsKept)
    expect(restart.to).not.toHaveBeenCalled()
  })
})
