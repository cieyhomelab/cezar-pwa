import type { ApiRun, RunHistoryPage } from '@cezar-pwa/cezar-contract/contract'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeEventSource } from '../../../test/fake-event-source.ts'
import longPages from '../../../test/fixtures/history-pages.long.json'
import liveRun from '../../../test/fixtures/run.live-0.11.0.json'
import { jsonResponse, renderWithQuery } from '../../../test/query.tsx'
import { cockpitTaskPath } from '../../domain/cockpit-link.ts'
import { en } from '../../i18n/en.ts'
import { AppRoutes } from '../../routes.tsx'

/**
 * FR-049 (#64): scrolling up past the newest page reads the pages before it, in front of what is
 * on screen, without moving it. A page that fails offers a retry and the cockpit, never a blank.
 */

const RUN = { ...(liveRun as unknown as ApiRun), status: 'done', task: 'Make the transcript longer' } as ApiRun
const BASE = `/api/v1/p/cezar-pwa/runs/${RUN.id}`
const ts = '2026-09-21T10:00:00.000Z'

const answer = (seq: number, text: string) => ({
  seq,
  ts,
  type: 'item.completed',
  item: { kind: 'message', id: `m${seq}`, role: 'assistant', text },
})
const turn = (seq: number, text: string) => ({ seq, ts, type: 'user-message', text })

const newest: RunHistoryPage = {
  events: [turn(20, 'Second question'), answer(21, 'Second answer'), answer(22, 'Newest answer')],
  itemCount: 3,
  olderCursor: 'BEFORE-20',
  liveCursor: 'LIVE',
  asOfSeq: 22,
  hasOlder: true,
}
const oldest: RunHistoryPage = {
  events: [answer(1, 'Oldest answer'), turn(10, 'First question'), answer(11, 'First answer')],
  itemCount: 3,
  newerCursor: 'AFTER-11',
  liveCursor: 'LIVE',
  asOfSeq: 22,
  hasOlder: false,
}

type Answer = () => Response | Promise<Response>

/** Cezar, with the history route answering by cursor. */
function serve(pages: Record<string, Answer>) {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
    if (url.pathname === '/api/v1/health') {
      return jsonResponse({ version: '0.11.1', projects: [{ id: 'cezar-pwa', name: 'Cezar PWA' }] })
    }
    if (url.pathname === BASE || url.pathname === `${BASE}/read`) return jsonResponse(RUN)
    if (url.pathname === `${BASE}/history-context`) return jsonResponse({ contextEvents: [], asOfSeq: 22 })
    if (url.pathname === `${BASE}/history`) {
      const respond = pages[url.searchParams.get('cursor') ?? '']
      if (respond) return respond()
    }
    throw new Error(`unrouted fetch in test: ${url.pathname}${url.search}`)
  })
  const cursors = () =>
    fetchMock.mock.calls
      .map(([input]) => new URL(String(input), 'http://localhost'))
      .filter((url) => url.pathname === `${BASE}/history`)
      .map((url) => url.searchParams.get('cursor'))
  return { cursors }
}

const open = () => renderWithQuery(<AppRoutes />, undefined, `/p/cezar-pwa/runs/${RUN.id}`)
const transcript = () => within(screen.getByRole('region', { name: en.run.transcript.heading }))

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  FakeEventSource.reset()
  vi.stubGlobal('EventSource', FakeEventSource)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('RunScreen — older history (FR-049)', () => {
  it('reads the page before with the cursor and puts it in front, then says the transcript starts', async () => {
    const { cursors } = serve({ '': () => jsonResponse(newest), 'BEFORE-20': () => jsonResponse(oldest) })
    open()
    await screen.findByText('Newest answer')
    expect(screen.queryByText('First answer')).toBeNull()
    expect(screen.queryByText(en.run.transcript.start)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.run.transcript.showOlder }))

    expect(await screen.findByText('First answer')).toBeInTheDocument()
    expect(cursors()).toContain('BEFORE-20')
    const text = transcript().getByText(en.run.transcript.start).closest('section')!.textContent!
    const order = [en.run.transcript.start, RUN.task!, 'Oldest answer', 'First question', 'Second question', 'Newest answer']
    const at = order.map((part) => text.indexOf(part))
    expect(at.every((index) => index >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(screen.queryByRole('button', { name: en.run.transcript.showOlder })).toBeNull()
  })

  it('asks on its own when the top comes into view', async () => {
    const observed: { callback: IntersectionObserverCallback; target?: Element }[] = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          observed.push({ callback })
        }
        observe(target: Element) {
          observed.at(-1)!.target = target
        }
        disconnect() {}
      },
    )
    const { cursors } = serve({ '': () => jsonResponse(newest), 'BEFORE-20': () => jsonResponse(oldest) })
    open()
    await screen.findByText('Newest answer')
    await waitFor(() => expect(observed.at(-1)?.target).toBeDefined())
    expect(cursors()).not.toContain('BEFORE-20')

    const { callback, target } = observed.at(-1)!
    act(() => callback([{ isIntersecting: true, target } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(await screen.findByText('First answer')).toBeInTheDocument()
    expect(cursors().filter((cursor) => cursor === 'BEFORE-20')).toHaveLength(1)
  })

  it('keeps the entry being read where it was on screen while the older page lands above', async () => {
    // jsdom has no layout: every entry is 50 px tall, stacked in document order.
    const ENTRY = 50
    let scrollY = 0
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY)
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(((_x: number, y: number) => {
      scrollY += y
    }) as typeof window.scrollBy)
    const layout = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const entries = [...document.querySelectorAll('[data-entry-key]')]
      const index = entries.indexOf(this)
      const top = index < 0 ? 0 : index * ENTRY - scrollY
      return { top, bottom: top + ENTRY, left: 0, right: 0, width: 0, height: ENTRY, x: 0, y: top, toJSON: () => ({}) }
    })

    serve({ '': () => jsonResponse(newest), 'BEFORE-20': () => jsonResponse(oldest) })
    open()
    await screen.findByText('Newest answer')
    const reading = () => screen.getByText('Newest answer').closest('[data-entry-key]')!
    const before = reading().getBoundingClientRect().top

    fireEvent.click(screen.getByRole('button', { name: en.run.transcript.showOlder }))
    await screen.findByText('First answer')

    expect(scrollBy).toHaveBeenCalledWith(0, 3 * ENTRY)
    expect(reading().getBoundingClientRect().top).toBe(before)
    // Older content arriving above is not "new messages".
    expect(screen.queryByRole('button', { name: new RegExp(en.run.newMessages) })).toBeNull()
    layout.mockRestore()
  })

  it('shows a retry and the cockpit when the page fails, keeping the transcript on screen', async () => {
    let fail = true
    serve({
      '': () => jsonResponse(newest),
      'BEFORE-20': () => (fail ? jsonResponse({ error: 'history read failed' }, 500) : jsonResponse(oldest)),
    })
    open()
    await screen.findByText('Newest answer')

    fireEvent.click(screen.getByRole('button', { name: en.run.transcript.showOlder }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.run.transcript.olderFailed)
    expect(within(alert).getByRole('link', { name: en.run.transcript.olderInCockpit })).toHaveAttribute(
      'href',
      cockpitTaskPath('cezar-pwa', RUN.id),
    )
    expect(screen.getByText('Newest answer')).toBeInTheDocument()

    fail = false
    fireEvent.click(within(alert).getByRole('button', { name: en.run.retry }))
    expect(await screen.findByText('First answer')).toBeInTheDocument()
    expect(screen.queryByText(en.run.transcript.olderFailed)).toBeNull()
  })

  it('reads a long recorded run back to its start, one page per cursor', async () => {
    const recorded = longPages as { cursor: string | null; page: RunHistoryPage }[]
    const { cursors } = serve(
      Object.fromEntries(recorded.map(({ cursor, page }) => [cursor ?? '', () => jsonResponse(page)])),
    )
    open()
    await screen.findByText('Turn 30 done: 90 checks green.')

    for (let loaded = 1; loaded < recorded.length; loaded += 1) {
      fireEvent.click(await screen.findByRole('button', { name: en.run.transcript.showOlder }))
      await waitFor(() => expect(cursors()).toContain(recorded[loaded]!.cursor))
    }
    expect(await screen.findByText(en.run.transcript.start)).toBeInTheDocument()
    expect(screen.getByText('Checkpoint 40: still reading, nothing broken so far.')).toBeInTheDocument()
    // The long first turn is whole again: one run of its answers, none twice.
    expect(screen.getAllByText('First pass done.', { exact: false })).toHaveLength(1)
    expect(screen.getAllByText('Turn 30 done: 90 checks green.')).toHaveLength(1)
  })
})
