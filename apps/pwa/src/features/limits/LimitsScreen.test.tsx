import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LimitsResponse } from '@cezar-pwa/shared'
import { jsonResponse, renderWithQuery } from '../../../test/query.tsx'
import { NetworkError } from '../../api/http.ts'
import { en } from '../../i18n/en.ts'
import { RunActionBar } from '../run/RunActionBar.tsx'
import type { RunActions } from '../run/useRunActions.ts'
import { LimitsSection } from '../settings/LimitsSection.tsx'
import { LimitsScreen } from './LimitsScreen.tsx'

/**
 * #93: the card states — ok, stale, not reported, off, unavailable with the sidecar's reason — and
 * a sidecar that fails, before and after a reading is on screen. Never a white screen.
 */

const t = en.limits
const MIN = 60_000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString()

const reading: LimitsResponse = {
  observedAt: ago(MIN),
  providers: [
    {
      provider: 'codex',
      account: 'default',
      status: 'ok',
      observedAt: ago(20 * MIN + 30_000),
      // The 5-hour row is missing: Codex's `primary` was the weekly one.
      windows: [{ kind: 'weekly', usedPercent: 12, resetsAt: ahead(3 * 24 * 60 * MIN + 30 * MIN) }],
    },
    {
      provider: 'claude',
      account: 'default',
      status: 'ok',
      observedAt: ago(2 * MIN + 30_000),
      windows: [
        { kind: 'five_hour', usedPercent: 42, resetsAt: ahead(134 * MIN + 30_000) },
        { kind: 'weekly', usedPercent: 71.6, resetsAt: ahead(26 * 60 * MIN + 30_000) },
        { kind: 'weekly_model', model: 'opus', usedPercent: 93, resetsAt: ahead(26 * 60 * MIN + 30_000) },
      ],
    },
    {
      provider: 'claude',
      account: 'work',
      status: 'unavailable',
      reason: 'off in the sidecar config (LIMITS_CLAUDE)',
      observedAt: ago(MIN),
      windows: [],
    },
    {
      provider: 'codex',
      account: 'spare',
      status: 'unavailable',
      reason: 'codex not installed',
      observedAt: ago(MIN),
      windows: [],
    },
  ],
}

function serveLimits(respond: () => Response | Promise<Response>) {
  const paths: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = new URL(url, 'http://localhost').pathname
    paths.push(path)
    if (path === '/m/push/limits') return respond()
    throw new Error(`unrouted fetch in test: ${path}`)
  })
  return paths
}

const card = async (provider: string, account: string) => {
  const items = await screen.findAllByRole('listitem', { name: provider })
  const match = items.find((item) => within(item).queryByText(t.account(account)))
  if (!match) throw new Error(`no ${provider}/${account} card`)
  return within(match)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LimitsScreen', () => {
  it('shows every window with its percentage in text, the reset countdown and the reading age', async () => {
    const paths = serveLimits(() => jsonResponse(reading))
    renderWithQuery(<LimitsScreen />, undefined, '/limits')

    const claude = await card('Claude', 'default')
    const meters = claude.getAllByRole('meter')
    expect(meters.map((meter) => [meter.getAttribute('aria-valuenow'), meter.getAttribute('aria-valuetext')])).toEqual([
      ['42', t.used(42)],
      ['72', t.used(72)],
      ['93', t.used(93)],
    ])
    expect(claude.getByRole('meter', { name: t.window.five_hour })).toBeTruthy()
    expect(claude.getByRole('meter', { name: 'Weekly · Opus' })).toBeTruthy()
    expect(claude.getByText(t.used(42))).toBeTruthy()
    expect(claude.getByText(t.resetsIn('2h 14m'))).toBeTruthy()
    expect(claude.getAllByText(t.resetsIn('1d 2h'))).toHaveLength(2)
    expect(claude.getByText(t.read(en.age.minutes(2)))).toBeTruthy()
    expect(claude.queryByText(t.stale)).toBeNull()
    // Read once on open: nothing polls.
    expect(paths).toEqual(['/m/push/limits'])
  })

  it('says "not reported" for a missing window and dims a reading older than 10 minutes', async () => {
    serveLimits(() => jsonResponse(reading))
    renderWithQuery(<LimitsScreen />, undefined, '/limits')

    const codex = await card('Codex', 'default')
    expect(codex.getByText(t.notReported)).toBeTruthy()
    expect(codex.getAllByRole('meter')).toHaveLength(1)
    expect(codex.queryByText(/^0%|^100%/)).toBeNull()
    expect(codex.getByText(t.stale)).toBeTruthy()
    expect(codex.getByText(new RegExp(t.staleHint))).toBeTruthy()
  })

  it('shows a switched-off provider as off and a failed one with its reason, without numbers', async () => {
    serveLimits(() => jsonResponse(reading))
    renderWithQuery(<LimitsScreen />, undefined, '/limits')

    const off = await card('Claude', 'work')
    expect(off.getByText(t.off)).toBeTruthy()
    expect(off.getByText('off in the sidecar config (LIMITS_CLAUDE)')).toBeTruthy()
    expect(off.queryByRole('meter')).toBeNull()

    const missing = await card('Codex', 'spare')
    expect(missing.getByText(t.unavailable)).toBeTruthy()
    expect(missing.getByText('codex not installed')).toBeTruthy()
    expect(missing.queryByText(t.notReported)).toBeNull()
  })

  it('says so when the sidecar has not read anything yet', async () => {
    serveLimits(() => jsonResponse({ observedAt: null, providers: [] }))
    renderWithQuery(<LimitsScreen />, undefined, '/limits')
    expect(await screen.findByText(t.empty)).toBeTruthy()
  })

  it('explains a missing sidecar and offers a retry instead of a white screen', async () => {
    let answer = () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } })
    serveLimits(() => answer())
    renderWithQuery(<LimitsScreen />, undefined, '/limits')

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(t.loadFailed)).toBeTruthy()
    expect(within(alert).getByText(en.apiError['not-routed'])).toBeTruthy()

    answer = () => jsonResponse(reading)
    fireEvent.click(within(alert).getByRole('button', { name: t.retry }))
    expect(await card('Claude', 'default')).toBeTruthy()
  })

  it('refuses an answer that is not the limits shape', async () => {
    serveLimits(() => jsonResponse({ nope: true }))
    renderWithQuery(<LimitsScreen />, undefined, '/limits')
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(en.apiError['unexpected-shape'])).toBeTruthy()
  })

  it('keeps the last reading on screen when a refresh fails', async () => {
    let fail = false
    serveLimits(() => {
      if (fail) throw new NetworkError('offline')
      return jsonResponse(reading)
    })
    const { client } = renderWithQuery(<LimitsScreen />, undefined, '/limits')
    await card('Claude', 'default')

    fail = true
    await client.refetchQueries({ queryKey: ['limits'] }).catch(() => undefined)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(t.refreshFailed))
    expect(await card('Claude', 'default')).toBeTruthy()
  })
})

describe('the ways in', () => {
  it('Settings links to the screen', () => {
    renderWithQuery(<LimitsSection />, undefined, '/settings')
    expect(screen.getByRole('link', { name: t.open }).getAttribute('href')).toBe('/limits')
  })

  const actions = { run: vi.fn(), ask: vi.fn(), keep: vi.fn() } as unknown as RunActions

  it('a task waiting for a limit reset links to the screen', () => {
    renderWithQuery(
      <RunActionBar run={{ status: 'failed', autoResumeAt: ahead(60 * MIN), steps: [] } as never} actions={actions} busy={false} />,
    )
    expect(screen.getByRole('link', { name: en.run.actions.seeLimits }).getAttribute('href')).toBe('/limits')
  })

  it('a failed task with no booked resume does not', () => {
    renderWithQuery(<RunActionBar run={{ status: 'failed', steps: [] } as never} actions={actions} busy={false} />)
    expect(screen.queryByRole('link', { name: en.run.actions.seeLimits })).toBeNull()
  })
})
