import type { ApiRun } from '@cezar-pwa/cezar-contract/contract'
import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeEventSource } from '../../../test/fake-event-source.ts'
import liveRun from '../../../test/fixtures/run.live-0.11.0.json'
import { jsonResponse, renderWithQuery, routeFetch } from '../../../test/query.tsx'
import { en } from '../../i18n/en.ts'
import { AppRoutes } from '../../routes.tsx'

const RUN = { ...(liveRun as unknown as ApiRun), status: 'running' } as ApiRun
const BASE = `/api/v1/p/cezar-pwa/runs/${RUN.id}`
const ts = '2026-09-21T10:00:00.000Z'

const firstPage = {
  events: [
    { seq: 1, ts, type: 'turn.started', turnId: 't1' },
    { seq: 2, ts, type: 'item.completed', item: { kind: 'message', id: 'm1', role: 'assistant', text: 'First answer' } },
  ],
  itemCount: 1,
  liveCursor: 'CURSOR',
  asOfSeq: 2,
  hasOlder: false,
}

const message = (seq: number, type: string, text: string, id = 'm2') => ({
  seq,
  ts,
  type,
  item: { kind: 'message', id, role: 'assistant', text },
})

function renderLiveRun() {
  const fetchMock = routeFetch({
    '/api/v1/health': () =>
      jsonResponse({ version: '0.11.0', projects: [{ id: 'cezar-pwa', name: 'Cezar PWA' }] }),
    [BASE]: () => jsonResponse(RUN),
    [`${BASE}/history`]: () => jsonResponse(firstPage),
    [`${BASE}/history-context`]: () => jsonResponse({ contextEvents: [], asOfSeq: 2 }),
    [`${BASE}/read`]: () => jsonResponse(RUN),
  })
  const calls = (path: string) =>
    fetchMock.mock.calls.filter(([input]) => new URL(String(input), 'http://localhost').pathname === path).length
  return { ...renderWithQuery(<AppRoutes />, undefined, `/p/cezar-pwa/runs/${RUN.id}`), calls }
}

const liveStatus = () => document.querySelector('[data-live-state]') as HTMLElement
const params = (source: FakeEventSource) => new URL(source.url, 'http://localhost').searchParams

async function openStream() {
  await screen.findByText('First answer')
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
  act(() => FakeEventSource.latest.open())
  await waitFor(() => expect(liveStatus()).toHaveAttribute('data-live-state', 'live'))
}

function setVisibility(state: 'hidden' | 'visible', spy: ReturnType<typeof vi.spyOn>) {
  spy.mockReturnValue(state)
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

beforeEach(() => {
  // jsdom has no layout: following the bottom is covered in WebKit (`test/e2e/live-transcript.spec.ts`).
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  FakeEventSource.reset()
  vi.stubGlobal('EventSource', FakeEventSource)
})

afterEach(() => {
  window.dispatchEvent(new Event('online'))
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('RunScreen — live transcript (FR-016)', () => {
  it('connects from the page: its live cursor and its high-water mark', async () => {
    renderLiveRun()
    await openStream()
    const source = FakeEventSource.latest
    expect(new URL(source.url, 'http://localhost').pathname).toBe(`${BASE}/events`)
    expect(params(source).get('cursor')).toBe('CURSOR')
    expect(params(source).get('afterSeq')).toBe('2')
    expect(liveStatus()).toHaveTextContent(new RegExp(`^.?${en.runs.live.live}$`))
  })

  it('says it is connecting until the stream opens, and how old the screen is', async () => {
    renderLiveRun()
    await screen.findByText('First answer')
    expect(liveStatus()).toHaveAttribute('data-live-state', 'connecting')
    expect(liveStatus()).toHaveTextContent(/state from \d/)
  })

  it('streams a new answer word by word', async () => {
    const { calls } = renderLiveRun()
    await openStream()
    const fetched = calls(`${BASE}/history`)

    act(() => FakeEventSource.latest.emit('ui-event', message(3, 'item.started', '')))
    act(() => FakeEventSource.latest.emit('ui-event', { seq: 4, ts, type: 'item.delta', itemId: 'm2', field: 'text', delta: 'Second ' }))
    expect(await screen.findByText('Second')).toBeInTheDocument()
    act(() => FakeEventSource.latest.emit('ui-event', { seq: 5, ts, type: 'item.delta', itemId: 'm2', field: 'text', delta: 'answer' }))
    expect(await screen.findByText('Second answer')).toBeInTheDocument()
    // Nothing was refetched: the stream carried it.
    expect(calls(`${BASE}/history`)).toBe(fetched)
  })

  it('renders v1 lines off the stream too (a user message opens a turn)', async () => {
    renderLiveRun()
    await openStream()
    act(() => FakeEventSource.latest.emit('run-event', { seq: 3, ts, type: 'user-message', text: 'Keep going' }))
    expect(await screen.findByText('Keep going')).toBeInTheDocument()
  })

  it('never shows a replayed line twice', async () => {
    renderLiveRun()
    await openStream()
    // v2 items would dedupe by id in the fold anyway; v1 lines have no id, only their seq.
    const note = { seq: 3, ts, type: 'note', message: 'Worktree ready' }
    const said = { seq: 4, ts, type: 'user-message', text: 'Keep going' }
    for (const line of [note, said, note, said]) act(() => FakeEventSource.latest.emit('run-event', line))
    await screen.findByText('Keep going')
    expect(screen.getAllByText('Worktree ready')).toHaveLength(1)
    expect(screen.getAllByText('Keep going')).toHaveLength(1)
  })

  it('updates the header and the footer from a `run` frame', async () => {
    renderLiveRun()
    await openStream()
    act(() => FakeEventSource.latest.emit('run', { ...RUN, usage: undefined, status: 'waiting' }))
    expect(await screen.findByText(en.run.transcript.footer.waiting)).toBeInTheDocument()
  })

  it('ignores a frame it cannot read and a `run` frame for another task', async () => {
    renderLiveRun()
    await openStream()
    act(() => FakeEventSource.latest.emit('ui-event', '{not json'))
    act(() => FakeEventSource.latest.emit('ui-event', { type: 'no.seq' }))
    act(() => FakeEventSource.latest.emit('run', { ...RUN, id: 'someone-else', status: 'waiting' }))
    expect(screen.getByText('First answer')).toBeInTheDocument()
    expect(screen.queryByText(en.run.transcript.footer.waiting)).not.toBeInTheDocument()
    expect(liveStatus()).toHaveAttribute('data-live-state', 'live')
  })
})

describe('RunScreen — resume after a suspension (FR-021)', () => {
  it('closes while hidden and resumes after the last line it had: nothing lost, nothing twice', async () => {
    renderLiveRun()
    await openStream()
    act(() => FakeEventSource.latest.emit('ui-event', message(3, 'item.completed', 'Before the freeze')))
    await screen.findByText('Before the freeze')

    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    setVisibility('hidden', visibility)
    const frozen = FakeEventSource.latest
    expect(frozen.closed).toBe(true)

    setVisibility('visible', visibility)
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2))
    const resumed = FakeEventSource.latest
    expect(params(resumed).get('afterSeq')).toBe('3')
    expect(params(resumed).get('cursor')).toBe('CURSOR')

    act(() => resumed.open())
    // The server replays from afterSeq; an overlapping line is dropped, the missed one lands.
    act(() => resumed.emit('ui-event', message(3, 'item.completed', 'Before the freeze')))
    act(() => resumed.emit('run-event', { seq: 3, ts, type: 'note', message: 'Replayed overlap' }))
    act(() => resumed.emit('ui-event', message(4, 'item.completed', 'While frozen', 'm3')))
    expect(await screen.findByText('While frozen')).toBeInTheDocument()
    expect(screen.getAllByText('Before the freeze')).toHaveLength(1)
    expect(screen.queryByText('Replayed overlap')).not.toBeInTheDocument()
  })

  it('keeps an answer caught mid-stream whole: no deltas past the gap until its snapshot', async () => {
    renderLiveRun()
    await openStream()
    act(() => FakeEventSource.latest.emit('ui-event', message(3, 'item.started', '')))
    act(() => FakeEventSource.latest.emit('ui-event', { seq: 4, ts, type: 'item.delta', itemId: 'm2', field: 'text', delta: 'Hello' }))
    await screen.findByText('Hello')

    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    setVisibility('hidden', visibility)
    setVisibility('visible', visibility)
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2))
    const resumed = FakeEventSource.latest
    act(() => resumed.open())
    // ", wor" went out while the phone was frozen; it is never replayed.
    act(() => resumed.emit('ui-event', { seq: 9, ts, type: 'item.delta', itemId: 'm2', field: 'text', delta: 'ld' }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('Hellold')).not.toBeInTheDocument()
    expect(screen.getByText('Hello')).toBeInTheDocument()

    act(() => resumed.emit('ui-event', message(10, 'item.completed', 'Hello, world')))
    expect(await screen.findByText('Hello, world')).toBeInTheDocument()
  })

  it('drops the cursor after an attempt that never opened (the server may have refused it)', async () => {
    renderLiveRun()
    await screen.findByText('First answer')
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    act(() => FakeEventSource.latest.fail())
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2), { timeout: 2_000 })
    expect(params(FakeEventSource.latest).get('cursor')).toBeNull()
    expect(params(FakeEventSource.latest).get('afterSeq')).toBe('2')
    expect(liveStatus()).toHaveAttribute('data-live-state', 'reconnecting')
  })
})
