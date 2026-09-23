import type { ApiRun, RunsIndexResponse } from '@cezar-pwa/cezar-contract/contract'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import liveContext from '../../../test/fixtures/history-context.live-0.11.0.json'
import livePage from '../../../test/fixtures/history.live-0.11.0.json'
import liveRun from '../../../test/fixtures/run.live-0.11.0.json'
import recording from '../../../test/fixtures/transcript.ndjson?raw'
import {
  createTestQueryClient,
  jsonResponse,
  refusalResponse,
  renderWithQuery,
  routeFetch,
} from '../../../test/query.tsx'
import { RUNS_INDEX_QUERY_KEY } from '../../api/runs-index.ts'
import { en } from '../../i18n/en.ts'
import { AppRoutes } from '../../routes.tsx'

const RUN = liveRun as unknown as ApiRun
const BASE = `/api/v1/p/cezar-pwa/runs/${RUN.id}`

const health = () =>
  jsonResponse({ version: '0.11.0', projects: [{ id: 'cezar-pwa', name: 'Cezar PWA' }] })

const recordingPage = () =>
  jsonResponse({
    events: recording
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line)),
    itemCount: 12,
    liveCursor: 'live',
    asOfSeq: 32,
    hasOlder: true,
  })

function renderRun(
  overrides: {
    run?: () => Response | Promise<Response>
    history?: () => Response | Promise<Response>
    context?: () => Response | Promise<Response>
    read?: () => Response | Promise<Response>
  } = {},
  client = createTestQueryClient(),
) {
  const fetchMock = routeFetch({
    '/api/v1/health': health,
    [BASE]: overrides.run ?? (() => jsonResponse(RUN)),
    [`${BASE}/history`]: overrides.history ?? (() => jsonResponse(livePage)),
    [`${BASE}/history-context`]: overrides.context ?? (() => jsonResponse(liveContext)),
    [`${BASE}/read`]: overrides.read ?? (() => jsonResponse({ ...RUN, seenAt: '2026-09-21T09:00:00.000Z' })),
  })
  const calls = (path: string, method = 'GET') =>
    fetchMock.mock.calls.filter(
      ([input, init]) => new URL(String(input), 'http://localhost').pathname === path && (init?.method ?? 'GET') === method,
    ).length
  return { ...renderWithQuery(<AppRoutes />, client, `/p/cezar-pwa/runs/${RUN.id}`), fetchMock, calls }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RunScreen — the header (FR-014)', () => {
  it('says status, workflow, agent, cost, tokens, branch and links the PR', async () => {
    renderRun()
    const title = await screen.findByRole('heading', { name: 'opening pull request', level: 2 })
    // Scoped to the header: the transcript below mentions the same branch and says "done" too.
    const header = within(title.closest('section')!)
    expect(header.getByText('done')).toBeInTheDocument()
    expect(header.getByText('Cezar PWA')).toBeInTheDocument()
    expect(header.getByText('quick-task')).toBeInTheDocument()
    expect(header.getByText('claude · opus[1m]')).toBeInTheDocument()
    expect(header.getByText('$3.13')).toBeInTheDocument()
    expect(header.getByText('in 52 · out 13.7k')).toBeInTheDocument()
    expect(header.getByText('cez/12d1b71c')).toBeInTheDocument()
    const pr = header.getByRole('link', { name: 'PR #9' })
    expect(pr).toHaveAttribute('href', 'https://github.com/cieyhomelab/cezar-pwa/pull/9')
    expect(pr).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('jumps to the same task in the full cockpit (FR-048)', async () => {
    renderRun()
    const link = await screen.findByRole('link', { name: en.shell.openTaskInCockpitLabel })
    // The cockpit's own route for a task, outside the app's /m/ scope.
    expect(link).toHaveAttribute('href', `/p/cezar-pwa/tasks/${RUN.id}`)
  })

  it('says the step in hand for a multi-step chain', async () => {
    renderRun({
      run: () =>
        jsonResponse({
          ...RUN,
          status: 'running',
          currentStepId: 'review',
          steps: [
            { id: 'task', name: 'Do the task', kind: 'agent', status: 'done', iterations: 1, tokensUsed: 1 },
            { id: 'review', name: 'Review', kind: 'agent', status: 'running', iterations: 1, tokensUsed: 0 },
            { id: 'lint', name: 'Lint', kind: 'check', status: 'pending', iterations: 0, tokensUsed: 0 },
          ],
        }),
    })
    expect(await screen.findByText('Step 2/3 · Review')).toBeInTheDocument()
  })
})

describe('RunScreen — the transcript (FR-015, FR-017)', () => {
  it('renders the live page with every tool collapsed to one line, once', async () => {
    const { container } = renderRun()
    await screen.findByRole('region', { name: en.run.transcript.heading })
    const toolIds = [...container.querySelectorAll('[data-tool-id]')].map((node) => node.getAttribute('data-tool-id'))
    expect(toolIds.length).toBeGreaterThan(0)
    expect(new Set(toolIds).size).toBe(toolIds.length)
    for (const details of container.querySelectorAll('details[data-tool-id]')) {
      expect(details).not.toHaveAttribute('open')
    }
    // The first page reaches the start of the run, so the prompt is on top.
    expect(screen.getByText(en.run.transcript.task)).toBeInTheDocument()
    expect(screen.getByText('there was .ai folder not commited')).toBeInTheDocument()
    expect(screen.getByText(en.run.transcript.footer.closed)).toBeInTheDocument()
  })

  it('expands a tool line to its input and output', async () => {
    const { container } = renderRun({ history: recordingPage })
    const summary = await screen.findByText('Ran npm test')
    const details = container.querySelector('details[data-tool-id="toolu_1"]')!
    fireEvent.click(summary)
    expect(details).toHaveAttribute('open')
    expect(within(details as HTMLElement).getByText('npm test', { selector: 'pre' })).toBeInTheDocument()
    expect(within(details as HTMLElement).getByText(/ok 1\s+ok 2/)).toBeInTheDocument()
  })

  it('nests sub-agent steps under their parent and leaves plan tools to the plan', async () => {
    const { container } = renderRun({ history: recordingPage })
    await screen.findByText('Task Explore the repo')
    const parent = container.querySelector('details[data-tool-id="toolu_2"]') as HTMLElement
    expect(within(parent).getByText(en.run.transcript.tool.children(1))).toBeInTheDocument()
    expect(container.querySelector('[data-tool-id="toolu_3"]')).toBeNull()
    expect(container.querySelector('[data-tool-id="toolu_4"]')).toBeNull()
  })

  it('renders agent markdown as text: a table, no raw HTML, no remote image, no script link', async () => {
    const hostile = [
      '| a | b |\n| - | - |\n| 1 | 2 |',
      '<img src="https://evil.example/pixel.png" onerror="alert(1)">',
      '![tracker](https://evil.example/t.png)',
      '![](https://evil.example/anon.png)',
      '[click](javascript:alert(1))',
    ].join('\n\n')
    const { container } = renderRun({
      history: () =>
        jsonResponse({
          events: [
            {
              seq: 1,
              ts: '2026-09-21T08:00:00.000Z',
              type: 'item.completed',
              item: { kind: 'message', id: 'm', role: 'assistant', text: hostile },
            },
          ],
          itemCount: 1,
          liveCursor: 'c',
          asOfSeq: 1,
          hasOlder: false,
        }),
    })
    await screen.findByRole('table')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[onerror]')).toBeNull()
    expect(screen.getByText('[tracker]')).toBeInTheDocument()
    // An image with no alt still says what it is, in the operator's language.
    expect(screen.getByText(`[${en.run.transcript.markdownImageAlt}]`)).toBeInTheDocument()
    const link = screen.getByText('click').closest('a')
    expect(link?.getAttribute('href') ?? '').not.toMatch(/javascript:/i)
  })

  it('says older entries live in the cockpit when the page does not reach the start (FR-049 parked)', async () => {
    renderRun({ history: recordingPage })
    expect(await screen.findByRole('link', { name: en.run.transcript.older })).toHaveAttribute(
      'href',
      `/p/cezar-pwa/tasks/${RUN.id}`,
    )
    expect(screen.queryByText(en.run.transcript.task)).not.toBeInTheDocument()
  })

  it('shows the ask card read-only, with the answer that resolved it', async () => {
    renderRun({ history: recordingPage })
    expect(await screen.findByText('Which branch should I use?')).toBeInTheDocument()
    expect(screen.getByText(en.run.transcript.ask.answered('Use dev.'))).toBeInTheDocument()
  })

  it('keeps the header when the transcript fails, and offers a retry', async () => {
    renderRun({ history: () => jsonResponse({ error: 'history exploded' }, 500) })
    expect(await screen.findByText(en.run.transcript.loadFailed)).toBeInTheDocument()
    expect(screen.getByText('history exploded')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'opening pull request' })).toBeInTheDocument()
  })
})

describe('RunScreen — the plan (FR-018)', () => {
  it('pins the latest plan above the transcript with its progress', async () => {
    renderRun({ history: recordingPage })
    const plan = await screen.findByTestId('plan')
    expect(within(plan).getByText(en.run.plan.progress(1, 3))).toBeInTheDocument()
    expect(within(plan).getByText('· Writing the reducer')).toBeInTheDocument()
    expect(within(plan).getAllByRole('listitem')).toHaveLength(4)
  })

  it('takes the plan from the history context when the page no longer holds it', async () => {
    renderRun({
      context: () =>
        jsonResponse({
          contextEvents: [
            {
              // Before the page's first line, as a plan that scrolled out of it would be.
              seq: 0,
              ts: '2026-09-20T19:31:52.000Z',
              type: 'plan.updated',
              entries: [{ content: 'From the context', status: 'in_progress' }],
            },
          ],
          asOfSeq: 148,
        }),
    })
    const plan = await screen.findByTestId('plan')
    expect(within(plan).getByText('From the context')).toBeInTheDocument()
  })

  it('shows no plan when there is none, and survives a failed context', async () => {
    renderRun({ context: () => jsonResponse({ error: 'nope' }, 500) })
    await screen.findByRole('region', { name: en.run.transcript.heading })
    expect(screen.queryByTestId('plan')).toBeNull()
  })
})

describe('RunScreen — opening marks it read (FR-020)', () => {
  it('sends the receipt for an unread task, once, and writes back only seenAt', async () => {
    const client = createTestQueryClient()
    // The list is not mounted here, so nothing observes the index: keep it from being collected.
    client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity } })
    const unread = { ...RUN, seenAt: undefined }
    const index: RunsIndexResponse = {
      runs: [{ ...unread, projectId: 'cezar-pwa' } as unknown as RunsIndexResponse['runs'][number]],
      referenceStatuses: {},
      perProjectLimit: 200,
      truncated: [],
    }
    client.setQueryData(RUNS_INDEX_QUERY_KEY, index)
    const { calls } = renderRun(
      {
        run: () => jsonResponse(unread),
        // A stale snapshot in the answer: its title must not overwrite the cached one.
        read: () => jsonResponse({ ...RUN, title: 'stale title', seenAt: '2026-09-21T09:00:00.000Z' }),
      },
      client,
    )
    await waitFor(() => expect(calls(`${BASE}/read`, 'POST')).toBe(1))
    await waitFor(() =>
      expect(client.getQueryData<ApiRun>(['run', 'cezar-pwa', RUN.id])?.seenAt).toBe('2026-09-21T09:00:00.000Z'),
    )
    expect(client.getQueryData<ApiRun>(['run', 'cezar-pwa', RUN.id])?.title).toBe(RUN.title)
    expect(client.getQueryData<RunsIndexResponse>(RUNS_INDEX_QUERY_KEY)?.runs[0]?.seenAt).toBe(
      '2026-09-21T09:00:00.000Z',
    )
    expect(calls(`${BASE}/read`, 'POST')).toBe(1)
  })

  it('sends nothing for a task already read, or one still running', async () => {
    const first = renderRun()
    await screen.findByRole('region', { name: en.run.transcript.heading })
    expect(first.calls(`${BASE}/read`, 'POST')).toBe(0)
    first.unmount()

    const running = renderRun({ run: () => jsonResponse({ ...RUN, status: 'running', seenAt: undefined }) })
    await screen.findByRole('region', { name: en.run.transcript.heading })
    expect(running.calls(`${BASE}/read`, 'POST')).toBe(0)
  })
})

describe('RunScreen — failures', () => {
  it('says a missing task plainly and offers the way back', async () => {
    renderRun({ run: () => jsonResponse({ error: 'not found' }, 404) })
    expect(await screen.findByText(en.run.notFound)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: en.run.back })).toHaveAttribute('href', '/')
    // The cockpit may still know it (a task archived there, or listed under another project).
    expect(screen.getByRole('link', { name: en.shell.openTaskInCockpitLabel })).toHaveAttribute(
      'href',
      `/p/cezar-pwa/tasks/${RUN.id}`,
    )
  })

  it('hands a lapsed session to the gate: "Connect to Cezar", not an error', async () => {
    let authorized = true
    routeFetch({
      '/api/v1/health': () => (authorized ? health() : refusalResponse()),
      [BASE]: () => {
        authorized = false
        return refusalResponse()
      },
      [`${BASE}/history`]: refusalResponse,
      [`${BASE}/history-context`]: refusalResponse,
    })
    renderWithQuery(<AppRoutes />, createTestQueryClient(), `/p/cezar-pwa/runs/${RUN.id}`)
    expect(await screen.findByRole('heading', { name: en.auth.title })).toBeInTheDocument()
  })
})
