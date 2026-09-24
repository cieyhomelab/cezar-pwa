import type { RunsIndexResponse } from '@cezar-pwa/cezar-contract/contract'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from '../../../test/fixtures/runs-index.json'
import { jsonResponse, renderWithQuery, routeFetch } from '../../../test/query.tsx'
import { en } from '../../i18n/en.ts'
import { RunsListScreen } from './RunsListScreen.tsx'
import { PROJECT_FILTER_KEY } from './useProjectFilter.ts'

const index = fixture as RunsIndexResponse
const t = en.runs.readAll

// The fixture's unread rows: `run-failed` in Cezar PWA and `run-done-unread` in Kai Phone.
const readAllPath = (projectId: string) => `/api/v1/p/${projectId}/runs/read-all`

/** The index as Cezar would answer it once the given projects have been swept. */
const sweptIndex = (swept: Set<string>): RunsIndexResponse => ({
  ...index,
  runs: index.runs.map((run) =>
    swept.has(run.projectId) && run.finishedAt ? { ...run, seenAt: '2026-09-24T12:00:00.000Z' } : run,
  ),
})

function renderList(answers: Partial<Record<string, () => Response | Promise<Response>>> = {}) {
  const swept = new Set<string>()
  const sweep = (projectId: string) => async () => {
    const answer = answers[projectId]
    const response = answer ? await answer() : jsonResponse({ read: 1 })
    if (response.ok) swept.add(projectId)
    return response
  }
  const fetchMock = routeFetch({
    '/api/v1/health': () =>
      jsonResponse({
        version: '0.11.1',
        projects: [
          { id: 'cezar-pwa', name: 'Cezar PWA' },
          { id: 'kai-phone', name: 'Kai Phone' },
          { id: 'notes', name: 'Notatki' },
        ],
      }),
    '/api/v1/workspace/runs-index': () => jsonResponse(sweptIndex(swept)),
    [readAllPath('cezar-pwa')]: sweep('cezar-pwa'),
    [readAllPath('kai-phone')]: sweep('kai-phone'),
    [readAllPath('notes')]: sweep('notes'),
  })
  const sweeps = () =>
    fetchMock.mock.calls
      .map(([input, init]) => ({ path: new URL(String(input), 'http://localhost').pathname, method: init?.method }))
      .filter(({ path }) => path.endsWith('/runs/read-all'))
  return { ...renderWithQuery(<RunsListScreen />), sweeps }
}

const dialog = () => screen.getByRole('alertdialog', { name: t.confirmTitle(2) })

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('mark all read (#67)', () => {
  it('asks once, naming the projects in view, and sends nothing until confirmed', async () => {
    const { sweeps } = renderList()

    fireEvent.click(await screen.findByRole('button', { name: t.action(2) }))

    expect(within(dialog()).getByText(t.confirmBody('Cezar PWA, Kai Phone'))).toBeInTheDocument()
    fireEvent.click(within(dialog()).getByRole('button', { name: t.back }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(sweeps()).toEqual([])
  })

  it('shows the sweep in flight, then clears every marker on screen', async () => {
    let answer: (response: Response) => void = () => undefined
    const { sweeps } = renderList({
      'kai-phone': () => new Promise<Response>((resolve) => (answer = resolve)),
    })

    fireEvent.click(await screen.findByRole('button', { name: t.action(2) }))
    fireEvent.click(within(dialog()).getByRole('button', { name: t.confirm }))

    const working = await within(dialog()).findByRole('button', { name: t.working })
    expect(working).toBeDisabled()
    expect(within(dialog()).getByRole('button', { name: t.back })).toBeDisabled()
    await waitFor(() => expect(sweeps()).toHaveLength(2))
    expect(sweeps()).toEqual([
      { path: readAllPath('cezar-pwa'), method: 'POST' },
      { path: readAllPath('kai-phone'), method: 'POST' },
    ])

    answer(jsonResponse({ read: 1 }))

    expect(await screen.findByText(t.done(2))).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Mark all read/ })).not.toBeInTheDocument()
    expect(screen.queryByText(`(${en.runs.unread})`)).not.toBeInTheDocument()
  })

  it('names the project that failed, with its reason, and keeps its markers', async () => {
    renderList({ 'kai-phone': () => jsonResponse({ error: 'store is read-only' }, 500) })

    fireEvent.click(await screen.findByRole('button', { name: t.action(2) }))
    fireEvent.click(within(dialog()).getByRole('button', { name: t.confirm }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(t.failed('Kai Phone', 'Cezar refused: store is read-only'))
    expect(alert).not.toHaveTextContent('Cezar PWA')
    expect(screen.getByText(t.done(1))).toBeInTheDocument()
    // Cezar PWA's marker is gone; Kai Phone's is still there, and so is the way to try again.
    expect(await screen.findByRole('button', { name: t.action(1) })).toBeInTheDocument()
    expect(screen.getAllByText(`(${en.runs.unread})`)).toHaveLength(1)
  })

  it('reaches only the filtered project', async () => {
    localStorage.setItem(PROJECT_FILTER_KEY, 'kai-phone')
    const { sweeps } = renderList()

    fireEvent.click(await screen.findByRole('button', { name: t.action(1) }))
    const asked = screen.getByRole('alertdialog', { name: t.confirmTitle(1) })
    expect(within(asked).getByText(t.confirmBody('Kai Phone'))).toBeInTheDocument()
    fireEvent.click(within(asked).getByRole('button', { name: t.confirm }))

    expect(await screen.findByText(t.done(1))).toBeInTheDocument()
    expect(sweeps()).toEqual([{ path: readAllPath('kai-phone'), method: 'POST' }])
  })

  it('is not offered when nothing on screen is unread', async () => {
    localStorage.setItem(PROJECT_FILTER_KEY, 'notes')
    renderList()

    expect(await screen.findByRole('heading', { level: 3, name: /^Queued/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Mark all read/ })).not.toBeInTheDocument()
  })
})
