import type { RunsIndexResponse } from '@cezar-pwa/cezar-contract/contract'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeEventSource } from '../../../test/fake-event-source.ts'
import fixture from '../../../test/fixtures/runs-index.json'
import { jsonResponse, renderWithQuery, routeFetch } from '../../../test/query.tsx'
import { pl } from '../../i18n/pl.ts'
import { RunsListScreen } from './RunsListScreen.tsx'

const index = fixture as RunsIndexResponse
const running = index.runs.find((row) => row.id === 'run-monitoring') ?? index.runs.find((row) => row.status === 'running')!

/** The server's `run` frame: the record, stamped with `project` instead of `projectId`. */
const runFrame = (over: Record<string, unknown>) => {
  const { projectId, usage: _usage, ...rest } = running
  return { ...rest, task: 'the prompt', steps: [], ...over, project: projectId }
}

function renderLive(runsIndex: () => Response = () => jsonResponse(index)) {
  const fetchMock = routeFetch({
    '/api/v1/health': () =>
      jsonResponse({ version: '0.11.0', projects: [{ id: 'cezar-pwa', name: 'Cezar PWA' }] }),
    '/api/v1/workspace/runs-index': runsIndex,
  })
  const calls = (path: string) =>
    fetchMock.mock.calls.filter(([input]) => String(input).includes(path)).length
  return { ...renderWithQuery(<RunsListScreen />), calls }
}

const liveStatus = () => document.querySelector('[data-live-state]') as HTMLElement
const row = (id: string) => document.querySelector(`[data-run-id="${id}"]`) as HTMLElement

/** Open the stream and wait for the gap-filling fetch that every open triggers. */
async function goLive(calls: (path: string) => number) {
  const before = calls('runs-index')
  act(() => FakeEventSource.latest.open())
  await waitFor(() => expect(calls('runs-index')).toBe(before + 1))
  await waitFor(() => expect(liveStatus()).toHaveTextContent(new RegExp(`^.?${pl.runs.live.live}$`)))
}

beforeEach(() => {
  localStorage.clear()
  FakeEventSource.reset()
  vi.stubGlobal('EventSource', FakeEventSource)
})

afterEach(() => {
  // TanStack's online manager is a process-wide singleton: an `offline` left behind pauses
  // every query in the tests after this one.
  window.dispatchEvent(new Event('online'))
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('live status (FR-010)', () => {
  it('moves a task into "Wymaga uwagi" the moment its status changes, without refetching', async () => {
    const { calls } = renderLive()
    await screen.findByRole('heading', { name: '3 zadania wymagają uwagi' })
    await goLive(calls)
    const fetched = calls('runs-index')

    act(() => FakeEventSource.latest.emit('run', runFrame({ status: 'waiting', activity: undefined })))

    // TanStack notifies observers on its own tick, so the render lands just after the frame.
    expect(await screen.findByRole('heading', { name: '4 zadania wymagają uwagi' })).toBeInTheDocument()
    expect(within(row(running.id)).getByText('czeka na Ciebie')).toBeInTheDocument()
    expect(calls('runs-index')).toBe(fetched)
  })

  it('shows a new task and drops a deleted one', async () => {
    const { calls } = renderLive()
    await screen.findByRole('heading', { name: /wymagają uwagi/ })
    await goLive(calls)

    act(() =>
      FakeEventSource.latest.emit('run', runFrame({ id: 'run-new', title: 'Brand new work', status: 'queued' })),
    )
    expect(await screen.findByText('Brand new work')).toBeInTheDocument()

    act(() => FakeEventSource.latest.emit('run-deleted', { id: 'run-new', project: running.projectId }))
    await waitFor(() => expect(screen.queryByText('Brand new work')).toBeNull())
  })

  it('shrugs off frames it cannot read', async () => {
    const { calls } = renderLive()
    await screen.findByRole('heading', { name: /wymagają uwagi/ })
    await goLive(calls)

    act(() => {
      FakeEventSource.latest.emit('run', '{broken')
      FakeEventSource.latest.emit('run', { nothing: 'useful' })
      FakeEventSource.latest.emit('usage', { project: 'cezar-pwa', usage: {} })
    })
    expect(screen.getByRole('heading', { name: '3 zadania wymagają uwagi' })).toBeInTheDocument()
  })
})

describe('connection health (FR-012)', () => {
  it('says it is connecting, then live — and while live, claims no age', async () => {
    const { calls } = renderLive()
    await screen.findByRole('heading', { name: /wymagają uwagi/ })
    expect(liveStatus()).toHaveAttribute('data-live-state', 'connecting')
    expect(liveStatus()).toHaveTextContent(pl.runs.live.connecting)
    // Not live yet: the list says how old it is.
    expect(liveStatus()).toHaveTextContent(/lista z \d/)

    await goLive(calls)
    expect(liveStatus()).not.toHaveTextContent(/lista z/)
  })

  it('on a drop, says reconnecting, keeps the age visible, and re-asks the session', async () => {
    const { calls } = renderLive()
    await screen.findByRole('heading', { name: /wymagają uwagi/ })
    await goLive(calls)
    const probes = calls('/api/v1/health')

    act(() => FakeEventSource.latest.fail())

    await waitFor(() => expect(liveStatus()).toHaveAttribute('data-live-state', 'reconnecting'))
    expect(liveStatus()).toHaveTextContent(pl.runs.live.reconnecting)
    expect(liveStatus()).toHaveTextContent(/lista z \d/)
    await waitFor(() => expect(calls('/api/v1/health')).toBe(probes + 1))
  })

  it('says lost at once when the phone goes offline', async () => {
    const { calls } = renderLive()
    await screen.findByRole('heading', { name: /wymagają uwagi/ })
    await goLive(calls)

    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    await waitFor(() => expect(liveStatus()).toHaveAttribute('data-live-state', 'lost'))
    expect(liveStatus()).toHaveTextContent(pl.runs.live.lost)
  })

  it('closes the stream when hidden and opens a fresh one when shown', async () => {
    const { calls } = renderLive()
    await screen.findByRole('heading', { name: /wymagają uwagi/ })
    await goLive(calls)
    const first = FakeEventSource.latest

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(first.closed).toBe(true)

    visibility.mockReturnValue('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(FakeEventSource.latest).not.toBe(first)
    // A frozen connection is never trusted on waking: not live until the new one opens.
    await waitFor(() => expect(liveStatus()).toHaveAttribute('data-live-state', 'connecting'))
    await goLive(calls)
  })

  it('is not "live" until the fetch after opening has landed', async () => {
    let hold: ((response: Response) => void) | null = null
    let calls = 0
    const { calls: count } = renderLive(() => {
      calls += 1
      // The first load answers at once; the gap-filling fetch after the open is held.
      if (calls === 1) return jsonResponse(index)
      return new Promise<Response>((resolve) => {
        hold = resolve
      }) as unknown as Response
    })
    await screen.findByRole('heading', { name: /wymagają uwagi/ })
    act(() => FakeEventSource.latest.open())
    await waitFor(() => expect(count('runs-index')).toBe(2))

    await waitFor(() => expect(liveStatus()).toHaveAttribute('data-live-state', 'live'))
    expect(liveStatus()).toHaveTextContent(pl.runs.refreshingInline)

    act(() => hold!(jsonResponse(index)))
    await waitFor(() => expect(liveStatus()).not.toHaveTextContent(pl.runs.refreshingInline))
    expect(liveStatus()).not.toHaveTextContent(/lista z/)
  })
})
