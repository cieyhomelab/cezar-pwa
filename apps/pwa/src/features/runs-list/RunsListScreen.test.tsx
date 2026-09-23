import type { RunIndexEntry, RunsIndexResponse } from '@cezar-pwa/cezar-contract/contract'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from '../../../test/fixtures/runs-index.json'
import {
  jsonResponse,
  refusalResponse,
  renderWithQuery,
  routeFetch,
} from '../../../test/query.tsx'
import { pl } from '../../i18n/pl.ts'
import { FINISHED_VISIBLE, RunsListScreen } from './RunsListScreen.tsx'
import { PROJECT_FILTER_KEY } from './useProjectFilter.ts'

const index = fixture as RunsIndexResponse

const health = () =>
  jsonResponse({
    version: '0.11.0',
    projects: [
      { id: 'cezar-pwa', name: 'Cezar PWA' },
      { id: 'kai-phone', name: 'Kai Phone' },
      { id: 'notes', name: 'Notatki' },
    ],
  })

function renderList(runsIndex: () => Response | Promise<Response> = () => jsonResponse(index)) {
  const fetchMock = routeFetch({
    '/api/v1/health': health,
    '/api/v1/workspace/runs-index': runsIndex,
  })
  const calls = (path: string) =>
    fetchMock.mock.calls.filter(([input]) => String(input).includes(path)).length
  return { ...renderWithQuery(<RunsListScreen />), fetchMock, calls }
}

const section = (name: string) =>
  screen.getByRole('region', { name: new RegExp(`^${name} \\(`) })

const rowTexts = (name: string) =>
  within(section(name))
    .getAllByRole('listitem')
    .map((item) => item.getAttribute('data-run-id'))

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('RunsListScreen', () => {
  it('leads with how many tasks want the operator, then the four sections in order', async () => {
    renderList()

    expect(await screen.findByRole('heading', { name: '3 zadania wymagają uwagi' })).toBeInTheDocument()
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Wymaga uwagi (3)', 'W toku (2)', 'W kolejce (3)', 'Zakończone (3)'])
    expect(rowTexts('Wymaga uwagi')).toEqual(['run-waiting', 'run-review', 'run-failed'])
  })

  it('hides archived tasks', async () => {
    renderList()
    await screen.findByRole('heading', { name: /wymagają uwagi/ })
    expect(document.querySelector('[data-run-id="run-archived"]')).toBeNull()
  })

  it('says plainly when nothing is waiting', async () => {
    renderList(() =>
      jsonResponse({ ...index, runs: index.runs.filter((run) => run.status === 'done') }),
    )
    expect(await screen.findByRole('heading', { name: pl.runs.summary.none })).toBeInTheDocument()
  })

  it('makes each row readable without opening it (FR-009)', async () => {
    renderList()
    await screen.findByRole('heading', { name: /wymagają uwagi/ })

    const review = within(document.querySelector('[data-run-id="run-review"]') as HTMLElement)
    // Status in words, not only colour.
    expect(review.getByText('do przeglądu')).toBeInTheDocument()
    expect(review.getByText('PR #77')).toBeInTheDocument()
    // The `77: ` prefix is dropped because the chip already says 77 (cockpit #788).
    expect(review.getByText('removing the Hono scaffold route')).toBeInTheDocument()
    expect(review.getByText(/Kai Phone · od .+ · \$13/)).toBeInTheDocument()

    const unread = within(document.querySelector('[data-run-id="run-done-unread"]') as HTMLElement)
    expect(unread.getByText(`(${pl.runs.unread})`)).toBeInTheDocument()
    const read = within(document.querySelector('[data-run-id="run-done-read"]') as HTMLElement)
    expect(read.queryByText(`(${pl.runs.unread})`)).toBeNull()

    const queued = within(document.querySelector('[data-run-id="run-queued-second"]') as HTMLElement)
    expect(queued.getByText(/#2 w kolejce/)).toBeInTheDocument()

    const scheduled = within(document.querySelector('[data-run-id="run-scheduled"]') as HTMLElement)
    expect(scheduled.getByText('zaplanowane')).toBeInTheDocument()
    expect(scheduled.getByText(/wznowi o/)).toBeInTheDocument()

    const monitoring = within(document.querySelector('[data-run-id="run-monitoring"]') as HTMLElement)
    expect(monitoring.getByText('monitoruje')).toBeInTheDocument()
  })

  it('shows a status it has never heard of as itself, instead of failing', async () => {
    const odd = { ...index.runs[0], id: 'run-odd', status: 'paused' } as unknown as RunIndexEntry
    renderList(() => jsonResponse({ ...index, runs: [odd] }))

    const row = await screen.findByText('choosing the icon set')
    const item = row.closest('li') as HTMLElement
    // Not `anulowane`: deriveAttention's last rung is a catch-all that would say cancelled.
    expect(within(item).getByText('paused')).toBeInTheDocument()
    expect(within(item).queryByText('anulowane')).toBeNull()
  })

  it('refuses to call an unreadable answer an empty list', async () => {
    renderList(() => jsonResponse({ unexpected: true }))
    expect(await screen.findByText(pl.runs.loadFailed)).toBeInTheDocument()
    expect(screen.queryByText(pl.runs.summary.none)).toBeNull()
    // The detail line is the app's own judgement, so it is said in Polish rather than as the
    // developer-facing `ApiError.message` the code travels with.
    expect(screen.getByText(pl.apiError['unexpected-shape'])).toBeInTheDocument()
    expect(screen.queryByText('unexpected response shape')).toBeNull()
  })

  it('caps finished history behind a button', async () => {
    const finished = Array.from({ length: FINISHED_VISIBLE + 5 }, (_, i) => ({
      ...index.runs[9],
      id: `old-${i}`,
      createdAt: `2026-09-01T10:${String(i).padStart(2, '0')}:00.000Z`,
    }))
    renderList(() => jsonResponse({ ...index, runs: finished }))

    const more = await screen.findByRole('button', { name: pl.runs.showOlder(5) })
    expect(within(section('Zakończone')).getAllByRole('listitem')).toHaveLength(FINISHED_VISIBLE)
    fireEvent.click(more)
    expect(within(section('Zakończone')).getAllByRole('listitem')).toHaveLength(FINISHED_VISIBLE + 5)
  })

  it('names the projects whose history was cut off', async () => {
    renderList(() => jsonResponse({ ...index, truncated: ['kai-phone'] }))
    expect(await screen.findByText(pl.runs.truncated(200, 'Kai Phone'))).toBeInTheDocument()
  })
})

describe('project filter (FR-013)', () => {
  it('narrows the list to one project, and still says what waits elsewhere', async () => {
    renderList()
    const select = await screen.findByRole('combobox', { name: pl.runs.filter.label })

    fireEvent.change(select, { target: { value: 'kai-phone' } })

    expect(rowTexts('Wymaga uwagi')).toEqual(['run-review'])
    expect(screen.queryByRole('region', { name: /^W kolejce/ })).toBeNull()
    // The headline stays the whole truth; the filter only narrows the rows.
    expect(screen.getByRole('heading', { name: '3 zadania wymagają uwagi' })).toBeInTheDocument()
    expect(screen.getByText(pl.runs.summary.elsewhere(2))).toBeInTheDocument()
  })

  it('survives a restart', async () => {
    const first = renderList()
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'notes' } })
    expect(localStorage.getItem(PROJECT_FILTER_KEY)).toBe('notes')
    first.unmount()
    vi.restoreAllMocks()

    renderList()
    const select = await screen.findByRole('combobox')
    await waitFor(() => expect(select).toHaveValue('notes'))
    expect(rowTexts('W kolejce')).toEqual(['run-scheduled', 'run-queued-first'])
  })

  it('falls back to every project when the remembered one is gone', async () => {
    localStorage.setItem(PROJECT_FILTER_KEY, 'removed-project')
    renderList()
    const select = await screen.findByRole('combobox')
    await waitFor(() => expect(select).toHaveValue(''))
    expect(await screen.findByRole('heading', { name: 'Wymaga uwagi (3)' })).toBeInTheDocument()
  })

  it('says so when the chosen project has no tasks', async () => {
    renderList(() => jsonResponse({ ...index, runs: index.runs.filter((r) => r.projectId !== 'notes') }))
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'notes' } })
    expect(screen.getByText(pl.runs.empty.project)).toBeInTheDocument()
  })
})

describe('refreshing (FR-011)', () => {
  it('refreshes from the button', async () => {
    const { calls } = renderList()
    await screen.findByRole('heading', { name: /wymagają uwagi/ })
    const before = calls('runs-index')

    fireEvent.click(screen.getByRole('button', { name: pl.runs.refresh }))
    await waitFor(() => expect(calls('runs-index')).toBe(before + 1))
  })

  it('refreshes by pulling down from the top of the list', async () => {
    const { calls } = renderList()
    await screen.findByRole('heading', { name: /wymagają uwagi/ })
    const before = calls('runs-index')

    const touch = (type: string, clientY: number) =>
      act(() => {
        window.dispatchEvent(
          Object.assign(new Event(type), { touches: type === 'touchend' ? [] : [{ clientY }] }),
        )
      })
    touch('touchstart', 100)
    touch('touchmove', 150)
    expect(screen.getByText(pl.runs.pull)).toBeInTheDocument()
    touch('touchmove', 300)
    expect(screen.getByText(pl.runs.release)).toBeInTheDocument()
    touch('touchend', 300)

    await waitFor(() => expect(calls('runs-index')).toBe(before + 1))
  })

  it('does not refresh on a short pull', async () => {
    const { calls } = renderList()
    await screen.findByRole('heading', { name: /wymagają uwagi/ })
    const before = calls('runs-index')

    act(() => {
      window.dispatchEvent(Object.assign(new Event('touchstart'), { touches: [{ clientY: 100 }] }))
      window.dispatchEvent(Object.assign(new Event('touchmove'), { touches: [{ clientY: 140 }] }))
      window.dispatchEvent(Object.assign(new Event('touchend'), { touches: [] }))
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls('runs-index')).toBe(before)
  })

  it('refreshes when the app returns to the foreground', async () => {
    const { calls } = renderList()
    await screen.findByRole('heading', { name: /wymagają uwagi/ })
    const before = calls('runs-index')

    // TanStack's focus manager listens for exactly this event.
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(calls('runs-index')).toBeGreaterThan(before))
  })

  it('keeps the list but says it is out of date when a refresh fails', async () => {
    let fail = false
    renderList(() => {
      if (fail) throw new TypeError('Failed to fetch')
      return jsonResponse(index)
    })
    await screen.findByRole('heading', { name: /wymagają uwagi/ })

    fail = true
    fireEvent.click(screen.getByRole('button', { name: pl.runs.refresh }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Nie udało się odświeżyć/)
    expect(rowTexts('Wymaga uwagi')).toHaveLength(3)
  })

  it('hands a lapsed session back to the gate by re-probing it', async () => {
    const { calls } = renderList(refusalResponse)
    await waitFor(() => expect(calls('/api/v1/health')).toBeGreaterThanOrEqual(2))
    // No second "not authorized" screen of its own, and no error claiming the list failed.
    expect(screen.queryByText(pl.runs.loadFailed)).toBeNull()
  })
})
