import type { ApiRun } from '@cezar-pwa/cezar-contract/contract'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import liveRun from '../../../test/fixtures/run.live-0.11.0.json'
import { jsonResponse, renderWithQuery } from '../../../test/query.tsx'
import { AuthRequiredError, NetworkError, TimeoutError } from '../../api/http.ts'
import { pl } from '../../i18n/pl.ts'
import { AppRoutes } from '../../routes.tsx'
import { failureMessage } from './useDeliver.ts'

/**
 * S-07 on the task screen: answering the agent's question (FR-022), messaging the task (FR-023),
 * and every send saying it is in flight and why it failed (FR-032).
 */

const BASE_RUN = liveRun as unknown as ApiRun
const BASE = `/api/v1/p/cezar-pwa/runs/${BASE_RUN.id}`

const withSession = [
  { id: 'task', name: 'Do the task', kind: 'agent', status: 'running', iterations: 1, tokensUsed: 1, sessionId: 's-1' },
]
const withoutSession = [{ id: 'task', name: 'Do the task', kind: 'agent', status: 'done', iterations: 1, tokensUsed: 1 }]

const runAs = (status: string, steps: unknown[] = withSession, extra: Record<string, unknown> = {}) =>
  ({ ...BASE_RUN, status, steps, currentStepId: 'task', ...extra }) as ApiRun

const ev = (seq: number, type: string, fields: Record<string, unknown> = {}) => ({
  seq,
  ts: `2026-09-21T08:00:${String(seq).padStart(2, '0')}.000Z`,
  type,
  stepId: 'task',
  ...fields,
})

const branch = {
  header: 'Branch',
  question: 'Which branch should I use?',
  options: [{ label: 'main', description: 'the default' }, { label: 'dev' }],
}
const checks = {
  header: 'Checks',
  question: 'Which checks should run?',
  multiSelect: true,
  options: [{ label: 'lint' }, { label: 'test' }],
}

const page = (events: unknown[]) => ({ events, itemCount: events.length, liveCursor: 'live', asOfSeq: 99, hasOlder: false })
const opening = [ev(1, 'turn.started', { turnId: 't1' }), ev(2, 'item.completed', { item: { kind: 'message', id: 'm1', role: 'assistant', text: 'Before I start:' } })]
const askPage = (questions: unknown[] = [branch]) =>
  page([...opening, ev(3, 'ask.requested', { requestId: 'ask-1', questions })])

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>

/** Routes by path and method, and records every write's body. */
function serve(opts: { run: ApiRun; history: () => unknown; messages?: Handler; continue?: Handler }) {
  const writes: { path: string; body: unknown }[] = []
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = new URL(url, 'http://localhost').pathname
    const method = init?.method ?? 'GET'
    if (method === 'POST') writes.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (path === '/api/v1/health') return jsonResponse({ version: '0.11.0', projects: [{ id: 'cezar-pwa', name: 'Cezar PWA' }] })
    if (path === '/api/v1/workspace/runs-index') return jsonResponse({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] })
    if (path === BASE) return jsonResponse(opts.run)
    if (path === `${BASE}/history`) return jsonResponse(opts.history())
    if (path === `${BASE}/history-context`) return jsonResponse({ contextEvents: [], asOfSeq: 0 })
    if (path === `${BASE}/read`) return jsonResponse(opts.run)
    if (path === `${BASE}/messages`) return (opts.messages ?? (() => jsonResponse({ delivered: true })))(init)
    if (path === `${BASE}/continue`) return (opts.continue ?? (() => jsonResponse({ continued: true })))(init)
    throw new Error(`unrouted fetch in test: ${method} ${path}`)
  })
  const writesTo = (suffix: string) => writes.filter((write) => write.path === `${BASE}${suffix}`)
  renderWithQuery(<AppRoutes />, undefined, `/p/cezar-pwa/runs/${BASE_RUN.id}`)
  return { fetchMock, writesTo }
}

const askCard = async () => (await screen.findByText(pl.run.transcript.ask.title)).closest('section')!

afterEach(() => {
  vi.restoreAllMocks()
})

describe('answering a question (FR-022)', () => {
  it('a single question answers on one tap, as the cockpit formats it, and resolves', async () => {
    let answered = false
    const { writesTo } = serve({
      run: runAs('waiting'),
      history: () =>
        answered ? page([...askPage().events, ev(4, 'user-message', { text: 'Branch: dev' })]) : askPage(),
      messages: () => {
        answered = true
        return jsonResponse({ delivered: true })
      },
    })
    const card = within(await askCard())
    expect(card.getByText(pl.run.transcript.ask.pickOrWrite)).toBeInTheDocument()

    fireEvent.click(card.getByRole('button', { name: 'dev' }))

    await waitFor(() => expect(writesTo('/messages')).toEqual([{ path: `${BASE}/messages`, body: { text: 'Branch: dev' } }]))
    // The refetch lands the operator's message, which resolves the card.
    expect(await screen.findByText(pl.run.transcript.ask.answered('Branch: dev'))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'main' })).not.toBeInTheDocument()
  })

  it('several questions send once, together, and only when each has an answer', async () => {
    const { writesTo } = serve({ run: runAs('waiting'), history: () => askPage([branch, checks]) })
    const card = within(await askCard())
    const send = card.getByRole('button', { name: pl.run.transcript.ask.send })
    expect(send).toBeDisabled()

    fireEvent.click(card.getByRole('button', { name: /main/ }))
    expect(send).toBeDisabled()
    fireEvent.click(card.getByRole('button', { name: 'lint' }))
    fireEvent.click(card.getByRole('button', { name: 'test' }))
    expect(card.getByRole('button', { name: 'test' })).toHaveAttribute('aria-pressed', 'true')
    expect(writesTo('/messages')).toHaveLength(0)

    fireEvent.click(send)
    await waitFor(() =>
      expect(writesTo('/messages').map((write) => write.body)).toEqual([{ text: 'Branch: main\nChecks: lint, test' }]),
    )
    expect(await card.findByText(pl.run.transcript.ask.sent)).toBeInTheDocument()
  })

  it('shows the send in flight and blocks a second one (FR-032)', async () => {
    let release: (response: Response) => void = () => {}
    const { writesTo } = serve({
      run: runAs('waiting'),
      history: () => askPage(),
      messages: () => new Promise<Response>((resolve) => (release = resolve)),
    })
    const card = within(await askCard())
    fireEvent.click(card.getByRole('button', { name: 'dev' }))

    expect(await card.findByText(pl.run.compose.sending)).toBeInTheDocument()
    expect(card.getByRole('button', { name: /main/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: pl.run.compose.sending })).toBeDisabled()
    fireEvent.click(card.getByRole('button', { name: /main/ }))
    expect(writesTo('/messages')).toHaveLength(1)

    release(jsonResponse({ delivered: true }))
    expect(await card.findByText(pl.run.transcript.ask.sent)).toBeInTheDocument()
  })

  it("says the server's own reason when it refuses, and lets the operator try again", async () => {
    serve({
      run: runAs('waiting', withoutSession),
      history: () => askPage(),
      messages: () => jsonResponse({ error: 'provider claude is not connected' }, 409),
    })
    const card = within(await askCard())
    fireEvent.click(card.getByRole('button', { name: 'dev' }))

    expect(await card.findByRole('alert')).toHaveTextContent('Cezar odmówił: provider claude is not connected')
    expect(card.getByRole('button', { name: 'dev' })).toBeEnabled()
  })

  it('a stale "live" record: the 409 turns into a resume, so the answer is not lost', async () => {
    const { writesTo } = serve({
      run: runAs('waiting'),
      history: () => askPage(),
      messages: () => jsonResponse({ error: 'session closed' }, 409),
    })
    fireEvent.click(within(await askCard()).getByRole('button', { name: 'dev' }))

    await waitFor(() => expect(writesTo('/continue').map((write) => write.body)).toEqual([{ text: 'Branch: dev' }]))
    expect(await screen.findByText(pl.run.transcript.ask.sent)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a question whose session closed says so, and answering it reopens the session', async () => {
    const { writesTo } = serve({ run: runAs('done'), history: () => askPage() })
    const card = within(await askCard())
    expect(card.getByText(pl.run.transcript.ask.resumeHint)).toBeInTheDocument()

    fireEvent.click(card.getByRole('button', { name: 'dev' }))
    await waitFor(() => expect(writesTo('/continue').map((write) => write.body)).toEqual([{ text: 'Branch: dev' }]))
    expect(writesTo('/messages')).toHaveLength(0)
  })

  it('a closed task with no session to reopen shows the question inert, with the reason', async () => {
    serve({ run: runAs('done', withoutSession), history: () => askPage() })
    const card = within(await askCard())
    expect(card.getByText(pl.run.compose.failed.unavailable)).toBeInTheDocument()
    expect(card.getByRole('button', { name: 'dev' })).toBeDisabled()
    expect(screen.queryByRole('form', { name: pl.run.compose.label })).not.toBeInTheDocument()
  })

  it('an older, superseded question offers nothing', async () => {
    serve({
      run: runAs('waiting'),
      history: () =>
        page([
          ...opening,
          ev(3, 'ask.requested', { requestId: 'ask-old', questions: [checks] }),
          ev(4, 'ask.requested', { requestId: 'ask-1', questions: [branch] }),
        ]),
    })
    await screen.findByText(pl.run.transcript.ask.superseded)
    const old = screen.getByText(pl.run.transcript.ask.superseded).closest('section')!
    expect(within(old).getByRole('button', { name: /lint/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'dev' })).toBeEnabled()
  })
})

describe('messaging the task (FR-023)', () => {
  const composer = async () => within(await screen.findByRole('form', { name: pl.run.compose.label }))

  it('sends free text to a running task and clears the draft once Cezar took it', async () => {
    const { writesTo } = serve({ run: runAs('running'), history: () => page(opening) })
    const form = await composer()
    const box = form.getByRole('textbox', { name: pl.run.compose.label })
    expect(form.getByRole('button', { name: pl.run.compose.send })).toBeDisabled()

    fireEvent.change(box, { target: { value: 'Also update the docs.\nThanks' } })
    fireEvent.click(form.getByRole('button', { name: pl.run.compose.send }))

    await waitFor(() =>
      expect(writesTo('/messages').map((write) => write.body)).toEqual([{ text: 'Also update the docs.\nThanks' }]),
    )
    await waitFor(() => expect(box).toHaveValue(''))
  })

  it('keeps every word when the send fails, with the reason', async () => {
    serve({ run: runAs('running'), history: () => page(opening), messages: () => Promise.reject(new TypeError('offline')) })
    const form = await composer()
    const box = form.getByRole('textbox', { name: pl.run.compose.label })
    fireEvent.change(box, { target: { value: 'Stop after this step.' } })
    fireEvent.click(form.getByRole('button', { name: pl.run.compose.send }))

    expect(await form.findByRole('alert')).toHaveTextContent(pl.run.compose.failed.network)
    expect(box).toHaveValue('Stop after this step.')
  })

  it('a reply in the operator own words answers the open question too', async () => {
    const { writesTo } = serve({ run: runAs('waiting'), history: () => askPage() })
    const form = await composer()
    expect(form.getByRole('textbox')).toHaveAttribute('placeholder', pl.run.compose.placeholder.waiting)
    fireEvent.change(form.getByRole('textbox'), { target: { value: 'Neither — make a new branch.' } })
    fireEvent.click(form.getByRole('button', { name: pl.run.compose.send }))

    await waitFor(() => expect(writesTo('/messages')).toHaveLength(1))
    expect(await screen.findByText(pl.run.transcript.ask.sent)).toBeInTheDocument()
  })

  it('a queued task: the message joins the prompt, and what is stacked is shown', async () => {
    serve({
      run: runAs('queued', [], {
        queuedMessages: [{ id: 'q1', text: 'Use pnpm.', createdAt: '2026-09-21T08:00:00.000Z' }],
      }),
      history: () => page([]),
      messages: () => jsonResponse({ queued: true, message: { id: 'q2', text: 'x', createdAt: '2026-09-21T08:01:00.000Z' } }),
    })
    const form = await composer()
    expect(form.getByText(pl.run.compose.hint.queued)).toBeInTheDocument()
    expect(form.getByText(pl.run.compose.queuedTitle(1))).toBeInTheDocument()
    expect(form.getByText('Use pnpm.')).toBeInTheDocument()
  })

  it('a session still starting says the message waits for it', async () => {
    serve({ run: runAs('running'), history: () => page(opening), messages: () => jsonResponse({ deferred: true }) })
    const form = await composer()
    fireEvent.change(form.getByRole('textbox'), { target: { value: 'hi' } })
    fireEvent.click(form.getByRole('button', { name: pl.run.compose.send }))
    expect(await form.findByText(pl.run.compose.deferred)).toBeInTheDocument()
  })

  it.each(['done', 'review', 'failed', 'cancelled'])('is not offered on a %s task with no open question', async (status) => {
    serve({ run: runAs(status), history: () => page(opening) })
    await screen.findByRole('region', { name: pl.run.transcript.heading })
    expect(screen.queryByRole('form', { name: pl.run.compose.label })).not.toBeInTheDocument()
  })
})

describe('failureMessage (FR-032)', () => {
  it.each([
    [new AuthRequiredError(403), pl.run.compose.failed.auth],
    [new TimeoutError(20_000), pl.run.compose.failed.timeout],
    [new NetworkError('x'), pl.run.compose.failed.network],
  ])('%s', (error, message) => {
    expect(failureMessage(error)).toBe(message)
  })
})
