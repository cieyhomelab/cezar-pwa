import type { ApiRun, QueuedMessage } from '@cezar-pwa/cezar-contract/contract'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import liveRun from '../../../test/fixtures/run.live-0.11.0.json'
import { jsonResponse, renderWithQuery } from '../../../test/query.tsx'
import { en } from '../../i18n/en.ts'
import { AppRoutes } from '../../routes.tsx'

/**
 * #66 on the task screen: a message stacked onto a queued task is edited inline or removed behind
 * a confirmation, each showing it is in flight and why Cezar refused (FR-032). A message the
 * task already took is "already sent", not a failure.
 */

const BASE_RUN = liveRun as unknown as ApiRun
const BASE = `/api/v1/p/cezar-pwa/runs/${BASE_RUN.id}`
const t = en.run.compose.queue

const msg = (id: string, text: string): QueuedMessage => ({ id, text, createdAt: '2026-09-24T08:00:00.000Z' })

type Handler = (id: string, init: RequestInit | undefined) => Response | Promise<Response>

/** A server whose stack the handlers change, as Cezar's would. */
function serve(opts: { status?: string; stack?: QueuedMessage[]; patch?: Handler; remove?: Handler } = {}) {
  const state = { status: opts.status ?? 'queued', stack: opts.stack ?? [msg('q1', 'Use pnpm.'), msg('q2', 'Skip the docs.')] }
  const writes: { method: string; id: string; body: unknown }[] = []
  const run = () =>
    ({ ...BASE_RUN, status: state.status, steps: [], currentStepId: undefined, queuedMessages: state.stack }) as ApiRun
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = new URL(url, 'http://localhost').pathname
    const method = init?.method ?? 'GET'
    if (path === '/api/v1/health') return jsonResponse({ version: '0.11.0', projects: [{ id: 'cezar-pwa', name: 'Cezar PWA' }] })
    if (path === '/api/v1/workspace/runs-index') return jsonResponse({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] })
    if (path === BASE) return jsonResponse(run())
    if (path === `${BASE}/history`) return jsonResponse({ events: [], itemCount: 0, liveCursor: 'live', asOfSeq: 0, hasOlder: false })
    if (path === `${BASE}/history-context`) return jsonResponse({ contextEvents: [], asOfSeq: 0 })
    if (path === `${BASE}/read`) return jsonResponse(run())
    const queued = path.match(new RegExp(`^${BASE}/queued-messages/([^/]+)$`))
    if (queued) {
      const id = decodeURIComponent(queued[1]!)
      writes.push({ method, id, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (method === 'PATCH') {
        if (opts.patch) return opts.patch(id, init)
        const text = (JSON.parse(String(init?.body)) as { text: string }).text
        const message = { ...state.stack.find((m) => m.id === id)!, text }
        state.stack = state.stack.map((m) => (m.id === id ? message : m))
        return jsonResponse({ message })
      }
      if (method === 'DELETE') {
        if (opts.remove) return opts.remove(id, init)
        state.stack = state.stack.filter((m) => m.id !== id)
        return jsonResponse({ removed: true })
      }
    }
    throw new Error(`unrouted fetch in test: ${method} ${path}`)
  })
  renderWithQuery(<AppRoutes />, undefined, `/p/cezar-pwa/runs/${BASE_RUN.id}`)
  return { state, writes }
}

/** The composer, with the stacked messages unfolded. */
async function stack() {
  const form = within(await screen.findByRole('form', { name: en.run.compose.label }))
  fireEvent.click(form.getByText(en.run.compose.queuedTitle(2)))
  return form
}

const item = (form: ReturnType<typeof within>, text: string) => within(form.getByText(text).closest('li')!)

/** A response the test releases by hand, to look at the in-flight state. */
function later() {
  let release!: (response: Response) => void
  const promise = new Promise<Response>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('editing a queued message', () => {
  it('saves the new text inline and shows it from the answer', async () => {
    const gate = later()
    const { writes } = serve({
      patch: async (id, init) => {
        const answer = await gate.promise
        return answer.status === 200 ? jsonResponse({ message: { ...msg(id, ''), text: JSON.parse(String(init?.body)).text } }) : answer
      },
    })
    const form = await stack()
    fireEvent.click(item(form, 'Use pnpm.').getByRole('button', { name: t.edit }))
    const field = form.getByRole('textbox', { name: t.editLabel })
    expect(field).toHaveValue('Use pnpm.')
    fireEvent.change(field, { target: { value: 'Use npm.' } })
    fireEvent.click(form.getByRole('button', { name: t.save }))

    // In flight: the field is frozen, and nothing else on the stack can change.
    expect(await form.findByRole('button', { name: t.saving })).toBeDisabled()
    expect(field).toHaveAttribute('readonly')
    expect(item(form, 'Skip the docs.').getByRole('button', { name: t.remove })).toBeDisabled()

    gate.release(jsonResponse({}))
    await waitFor(() => expect(form.queryByRole('textbox', { name: t.editLabel })).not.toBeInTheDocument())
    expect(item(form, 'Use npm.').getByRole('button', { name: t.edit })).toBeEnabled()
    expect(writes).toEqual([{ method: 'PATCH', id: 'q1', body: { text: 'Use npm.' } }])
  })

  it('will not save an empty or unchanged message, and cancel restores it', async () => {
    const { writes } = serve()
    const form = await stack()
    fireEvent.click(item(form, 'Use pnpm.').getByRole('button', { name: t.edit }))
    const save = form.getByRole('button', { name: t.save })
    expect(save).toBeDisabled()
    fireEvent.change(form.getByRole('textbox', { name: t.editLabel }), { target: { value: '   ' } })
    expect(save).toBeDisabled()
    fireEvent.click(form.getByRole('button', { name: t.cancel }))
    expect(form.getByText('Use pnpm.')).toBeInTheDocument()
    expect(writes).toEqual([])
  })

  it("keeps the draft and shows Cezar's reason when it refuses (FR-032)", async () => {
    serve({ patch: () => jsonResponse({ error: 'prompt too long — 100000 character limit' }, 400) })
    const form = await stack()
    fireEvent.click(item(form, 'Use pnpm.').getByRole('button', { name: t.edit }))
    fireEvent.change(form.getByRole('textbox', { name: t.editLabel }), { target: { value: 'Use yarn.' } })
    fireEvent.click(form.getByRole('button', { name: t.save }))
    expect(await form.findByRole('alert')).toHaveTextContent(
      en.run.actions.failed.refused('prompt too long — 100000 character limit'),
    )
    expect(form.getByRole('textbox', { name: t.editLabel })).toHaveValue('Use yarn.')
  })

  it('a task that already started reads as "already sent", not as a failure', async () => {
    const { state } = serve({
      patch: () => {
        state.status = 'running'
        return jsonResponse({ error: 'run already started' }, 409)
      },
    })
    const form = await stack()
    fireEvent.click(item(form, 'Use pnpm.').getByRole('button', { name: t.edit }))
    fireEvent.change(form.getByRole('textbox', { name: t.editLabel }), { target: { value: 'Use yarn.' } })
    fireEvent.click(form.getByRole('button', { name: t.save }))
    expect(await form.findByRole('status')).toHaveTextContent(t.alreadySent)
    expect(form.queryByRole('alert')).not.toBeInTheDocument()
    expect(form.queryByRole('textbox', { name: t.editLabel })).not.toBeInTheDocument()
    // The record is re-asked: the task is running, its stack read-only, and the notice stays.
    await waitFor(() => expect(form.queryByRole('button', { name: t.edit })).not.toBeInTheDocument())
    expect(form.getByText('Use pnpm.')).toBeInTheDocument()
    expect(form.getByRole('status')).toHaveTextContent(t.alreadySent)
  })
})

describe('removing a queued message', () => {
  it('asks first; Keep leaves it, Remove takes it off the stack', async () => {
    const gate = later()
    const { writes } = serve({ remove: () => gate.promise })
    const form = await stack()
    fireEvent.click(item(form, 'Use pnpm.').getByRole('button', { name: t.remove }))
    expect(form.getByText(t.confirmRemove)).toBeInTheDocument()
    fireEvent.click(form.getByRole('button', { name: t.keep }))
    expect(form.queryByText(t.confirmRemove)).not.toBeInTheDocument()
    expect(writes).toEqual([])

    fireEvent.click(item(form, 'Use pnpm.').getByRole('button', { name: t.remove }))
    fireEvent.click(item(form, 'Use pnpm.').getByRole('button', { name: t.remove }))
    expect(await form.findByRole('button', { name: t.removing })).toBeDisabled()
    expect(form.getByRole('button', { name: t.keep })).toBeDisabled()

    gate.release(jsonResponse({ removed: true }))
    await waitFor(() => expect(form.queryByText('Use pnpm.')).not.toBeInTheDocument())
    expect(form.getByText('Skip the docs.')).toBeInTheDocument()
    expect(writes).toEqual([{ method: 'DELETE', id: 'q1', body: undefined }])
  })

  it('a message already delivered (404) reads as "already sent" and leaves the list', async () => {
    const { state } = serve({
      remove: () => {
        state.stack = state.stack.filter((m) => m.id !== 'q1')
        return jsonResponse({ error: 'not found' }, 404)
      },
    })
    const form = await stack()
    fireEvent.click(item(form, 'Use pnpm.').getByRole('button', { name: t.remove }))
    fireEvent.click(item(form, 'Use pnpm.').getByRole('button', { name: t.remove }))
    expect(await form.findByRole('status')).toHaveTextContent(t.alreadySent)
    expect(form.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(form.queryByText('Use pnpm.')).not.toBeInTheDocument())
  })

  it("shows Cezar's reason when it refuses for another cause (FR-032)", async () => {
    serve({ remove: () => jsonResponse({ error: 'store unavailable' }, 500) })
    const form = await stack()
    fireEvent.click(item(form, 'Use pnpm.').getByRole('button', { name: t.remove }))
    fireEvent.click(item(form, 'Use pnpm.').getByRole('button', { name: t.remove }))
    expect(await item(form, 'Use pnpm.').findByRole('alert')).toHaveTextContent(
      en.run.actions.failed.refused('store unavailable'),
    )
    expect(item(form, 'Use pnpm.').getByRole('button', { name: t.edit })).toBeEnabled()
  })
})

it('a task that has started shows its stack read-only', async () => {
  serve({ status: 'running' })
  const form = await stack()
  expect(form.getByText('Use pnpm.')).toBeInTheDocument()
  expect(form.queryByRole('button', { name: t.edit })).not.toBeInTheDocument()
  expect(form.queryByRole('button', { name: t.remove })).not.toBeInTheDocument()
})
