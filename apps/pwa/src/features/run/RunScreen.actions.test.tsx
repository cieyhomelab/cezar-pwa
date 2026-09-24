import type { ApiRun } from '@cezar-pwa/cezar-contract/contract'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import liveRun from '../../../test/fixtures/run.live-0.11.0.json'
import { jsonResponse, renderWithQuery } from '../../../test/query.tsx'
import { AuthRequiredError, NetworkError, TimeoutError } from '../../api/http.ts'
import { en } from '../../i18n/en.ts'
import { AppRoutes } from '../../routes.tsx'
import { actionFailureMessage } from './useRunActions.ts'

/**
 * S-08 on the task screen: cancel behind a confirmation (FR-025), accept a review (FR-026), open
 * a draft PR (FR-027), continue (FR-028), pin and archive (FR-029), cancel a booked auto-resume
 * behind a confirmation (FR-030), each showing it is in flight and why it failed (FR-032).
 */

const BASE_RUN = liveRun as unknown as ApiRun
const BASE = `/api/v1/p/cezar-pwa/runs/${BASE_RUN.id}`
const t = en.run.actions

const withSession = [
  { id: 'task', name: 'Do the task', kind: 'agent', status: 'done', iterations: 1, tokensUsed: 1, sessionId: 's-1' },
]

const runAs = (status: string, extra: Record<string, unknown> = {}) =>
  ({ ...BASE_RUN, status, steps: withSession, currentStepId: 'task', pullRequestUrl: undefined, ...extra }) as ApiRun

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>

/**
 * Serves the task screen. The record is mutable, so a write's handler can move the run on and
 * the refetch after the action shows it. Every write is recorded with its body.
 */
function serve(initial: ApiRun, writeHandlers: Record<string, Handler> = {}) {
  const state = { run: initial }
  const writes: { action: string; body: unknown }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = new URL(url, 'http://localhost').pathname
    const method = init?.method ?? 'GET'
    if (path === '/api/v1/health') return jsonResponse({ version: '0.11.0', projects: [{ id: 'cezar-pwa', name: 'Cezar PWA' }] })
    if (path === '/api/v1/workspace/runs-index') return jsonResponse({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] })
    if (path === BASE) return jsonResponse(state.run)
    if (path === `${BASE}/history`) return jsonResponse({ events: [], itemCount: 0, liveCursor: 'live', asOfSeq: 0, hasOlder: false })
    if (path === `${BASE}/history-context`) return jsonResponse({ contextEvents: [], asOfSeq: 0 })
    if (path === `${BASE}/read`) return jsonResponse(state.run)
    if ((method === 'POST' || method === 'DELETE') && path.startsWith(`${BASE}/`)) {
      // A POST is named by its path alone, as every action but one is; a DELETE says so.
      const action = `${method === 'DELETE' ? 'DELETE ' : ''}${path.slice(BASE.length + 1)}`
      writes.push({ action, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      const handler = writeHandlers[action]
      if (!handler) throw new Error(`unrouted write in test: ${action}`)
      return handler(init)
    }
    throw new Error(`unrouted fetch in test: ${method} ${path}`)
  })
  renderWithQuery(<AppRoutes />, undefined, `/p/cezar-pwa/runs/${BASE_RUN.id}`)
  return { state, writes }
}

const bar = async () => within(await screen.findByRole('region', { name: t.label }))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('which actions a task offers', () => {
  it('a running task: cancel and pin, nothing that would race the engine', async () => {
    serve(runAs('running'))
    const actions = await bar()
    expect(actions.getAllByRole('button').map((button) => button.textContent)).toEqual([t.pin, t.cancel])
  })

  it('a task in review: accept, draft PR, continue, pin, archive — never cancel', async () => {
    serve(runAs('review'))
    const actions = await bar()
    expect(actions.getAllByRole('button').map((button) => button.textContent)).toEqual([
      t.finish.review,
      t.draftPr,
      t.continue,
      t.pin,
      t.archive,
    ])
  })

  it('no draft PR once the task has one', async () => {
    serve(runAs('review', { pullRequestUrl: 'https://github.com/o/r/pull/7' }))
    const actions = await bar()
    expect(actions.queryByRole('button', { name: t.draftPr })).not.toBeInTheDocument()
  })
})

describe('cancel (FR-025)', () => {
  it('asks first, and "keep it" sends nothing', async () => {
    const { writes } = serve(runAs('running'))
    fireEvent.click((await bar()).getByRole('button', { name: t.cancel }))

    const dialog = screen.getByRole('alertdialog', { name: t.confirmCancel.title })
    expect(dialog).toHaveAccessibleDescription(t.confirmCancel.body)
    fireEvent.click(within(dialog).getByRole('button', { name: t.confirmCancel.keep }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(writes).toEqual([])
  })

  it('confirmed, it cancels and the refetched record shows it', async () => {
    const { state, writes } = serve(runAs('running'), {
      cancel: () => {
        state.run = runAs('cancelled')
        return jsonResponse({ cancelled: true })
      },
    })
    fireEvent.click((await bar()).getByRole('button', { name: t.cancel }))
    fireEvent.click(screen.getByRole('button', { name: t.confirmCancel.confirm }))

    expect(await screen.findByText(t.done.cancel)).toBeInTheDocument()
    expect(writes).toEqual([{ action: 'cancel', body: undefined }])
    // The cancelled run offers continue instead of cancel.
    expect(await screen.findByRole('button', { name: t.continue })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.cancel })).not.toBeInTheDocument()
  })

  it('says so when the run had already settled', async () => {
    serve(runAs('running'), { cancel: () => jsonResponse({ cancelled: false }) })
    fireEvent.click((await bar()).getByRole('button', { name: t.cancel }))
    fireEvent.click(screen.getByRole('button', { name: t.confirmCancel.confirm }))
    expect(await screen.findByText(t.done.alreadySettled)).toBeInTheDocument()
  })
})

describe('cancel auto-resume (FR-030)', () => {
  const AT = '2026-09-24T12:00:00.000Z'

  it('is offered on a failed task with a booked resume, next to its other actions', async () => {
    serve(runAs('failed', { autoResumeAt: AT }))
    const actions = await bar()
    expect(actions.getAllByRole('button').map((button) => button.textContent)).toEqual([
      t.continue,
      t.pin,
      t.archive,
      t.cancelAutoResume,
    ])
  })

  it('is not offered on a plain failed task', async () => {
    serve(runAs('failed'))
    const actions = await bar()
    expect(actions.getByRole('button', { name: t.continue })).toBeInTheDocument()
    expect(actions.queryByRole('button', { name: t.cancelAutoResume })).not.toBeInTheDocument()
  })

  it('asks first, and "keep it scheduled" sends nothing', async () => {
    const { writes } = serve(runAs('failed', { autoResumeAt: AT }))
    fireEvent.click((await bar()).getByRole('button', { name: t.cancelAutoResume }))

    const dialog = screen.getByRole('alertdialog', { name: t.confirmCancelAutoResume.title })
    expect(dialog).toHaveAccessibleDescription(t.confirmCancelAutoResume.body)
    fireEvent.click(within(dialog).getByRole('button', { name: t.confirmCancelAutoResume.keep }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(writes).toEqual([])
  })

  it('confirmed, it shows it is in flight, then the refetched plain failure drops the button', async () => {
    let release: (response: Response) => void = () => {}
    const { state, writes } = serve(runAs('failed', { autoResumeAt: AT }), {
      'DELETE auto-resume': () =>
        new Promise<Response>((resolve) => {
          release = (response) => {
            state.run = runAs('failed')
            resolve(response)
          }
        }),
    })
    fireEvent.click((await bar()).getByRole('button', { name: t.cancelAutoResume }))
    fireEvent.click(screen.getByRole('button', { name: t.confirmCancelAutoResume.confirm }))

    const actions = await bar()
    expect(await actions.findByRole('button', { name: t.cancellingAutoResume })).toBeDisabled()
    expect(actions.getByRole('button', { name: t.continue })).toBeDisabled()
    fireEvent.click(actions.getByRole('button', { name: t.continue }))
    expect(writes).toEqual([{ action: 'DELETE auto-resume', body: undefined }])

    release(jsonResponse({ cancelled: true }))
    expect(await screen.findByText(t.done.cancelAutoResume)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: t.cancelAutoResume })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: t.continue })).toBeEnabled()
  })

  it("shows the server's own reason when it refuses (FR-032)", async () => {
    serve(runAs('failed', { autoResumeAt: AT }), { 'DELETE auto-resume': () => jsonResponse({ error: 'not found' }, 404) })
    fireEvent.click((await bar()).getByRole('button', { name: t.cancelAutoResume }))
    fireEvent.click(screen.getByRole('button', { name: t.confirmCancelAutoResume.confirm }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t.failed.refused('not found'))
    // Still scheduled, so still offered.
    expect(screen.getByRole('button', { name: t.cancelAutoResume })).toBeEnabled()
  })
})

describe('the review gate (FR-026, FR-027)', () => {
  it('accept finishes the task', async () => {
    const { state, writes } = serve(runAs('review'), {
      finish: () => {
        state.run = runAs('done')
        return jsonResponse({ finished: true })
      },
    })
    fireEvent.click((await bar()).getByRole('button', { name: t.finish.review }))
    expect(await screen.findByText(t.done.accepted)).toBeInTheDocument()
    expect(writes.map((write) => write.action)).toEqual(['finish'])
    await waitFor(() => expect(screen.queryByRole('button', { name: t.finish.review })).not.toBeInTheDocument())
  })

  it('a waiting task is finished with the other label', async () => {
    serve(runAs('waiting'), { finish: () => jsonResponse({ finished: true }) })
    fireEvent.click((await bar()).getByRole('button', { name: t.finish.waiting }))
    expect(await screen.findByText(t.done.finished)).toBeInTheDocument()
  })

  it('draft PR shows it is in flight, blocks every other action, then reports', async () => {
    let release: (response: Response) => void = () => {}
    const { writes } = serve(runAs('review'), { pr: () => new Promise<Response>((resolve) => (release = resolve)) })
    const actions = await bar()
    fireEvent.click(actions.getByRole('button', { name: t.draftPr }))

    expect(await actions.findByRole('button', { name: t.draftPrPending })).toBeDisabled()
    expect(actions.getByRole('button', { name: t.finish.review })).toBeDisabled()
    fireEvent.click(actions.getByRole('button', { name: t.finish.review }))
    expect(writes.map((write) => write.action)).toEqual(['pr'])

    release(jsonResponse({ url: 'https://github.com/o/r/pull/8', dryRun: false }, 201))
    expect(await screen.findByText(t.done.draftPr)).toBeInTheDocument()
    expect(actions.getByRole('button', { name: t.finish.review })).toBeEnabled()
  })

  it("a refused draft PR shows the forge's own reason (FR-032)", async () => {
    serve(runAs('review'), {
      pr: () => jsonResponse({ error: 'gh: not logged in', manual: 'git merge cez/x' }, 409),
    })
    fireEvent.click((await bar()).getByRole('button', { name: t.draftPr }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t.failed.refused('gh: not logged in'))
  })
})

describe('continue (FR-028)', () => {
  it('reopens the session with no body, so the run keeps its own engine', async () => {
    const { writes } = serve(runAs('failed'), { continue: () => jsonResponse({ continued: true }) })
    fireEvent.click((await bar()).getByRole('button', { name: t.continue }))
    expect(await screen.findByText(t.done.continued)).toBeInTheDocument()
    expect(writes).toEqual([{ action: 'continue', body: undefined }])
  })

  it("shows the engine's refusal", async () => {
    serve(runAs('done'), { continue: () => jsonResponse({ error: 'provider claude is not connected' }, 409) })
    fireEvent.click((await bar()).getByRole('button', { name: t.continue }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t.failed.refused('provider claude is not connected'))
  })
})

describe('pin and archive (FR-029)', () => {
  it('pins, and the button flips on the answer', async () => {
    const { state, writes } = serve(runAs('done'), {
      pin: () => {
        state.run = runAs('done', { pinned: true })
        return jsonResponse(state.run)
      },
    })
    const actions = await bar()
    expect(actions.getByRole('button', { name: t.pin })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(actions.getByRole('button', { name: t.pin }))

    expect(await actions.findByRole('button', { name: t.unpin })).toHaveAttribute('aria-pressed', 'true')
    expect(writes).toEqual([{ action: 'pin', body: {} }])
  })

  it('unpins with an explicit false', async () => {
    const { writes } = serve(runAs('done', { pinned: true }), { pin: () => jsonResponse(runAs('done')) })
    fireEvent.click((await bar()).getByRole('button', { name: t.unpin }))
    await waitFor(() => expect(writes).toEqual([{ action: 'pin', body: { pinned: false } }]))
  })

  it('archives, says where the task went, and can restore it', async () => {
    const { state, writes } = serve(runAs('done'), {
      archive: (init) => {
        const archived = JSON.parse(String(init?.body)).archived !== false
        state.run = runAs('done', { archived })
        return jsonResponse(state.run)
      },
    })
    fireEvent.click((await bar()).getByRole('button', { name: t.archive }))

    expect(await screen.findByText(t.done.archived)).toBeInTheDocument()
    expect(screen.getByText(t.archivedBadge)).toBeInTheDocument()
    const actions = await bar()
    // Archiving retires the pin, so an archived task offers none.
    expect(actions.queryByRole('button', { name: t.pin })).not.toBeInTheDocument()

    fireEvent.click(actions.getByRole('button', { name: t.unarchive }))
    await waitFor(() => expect(screen.queryByText(t.archivedBadge)).not.toBeInTheDocument())
    expect(writes).toEqual([
      { action: 'archive', body: {} },
      { action: 'archive', body: { archived: false } },
    ])
  })
})

describe('actionFailureMessage (FR-032)', () => {
  it.each<[string, unknown, string]>([
    ['a lapsed session', new AuthRequiredError(403), t.failed.auth],
    ['a timeout, which may still have happened', new TimeoutError(20_000), t.failed.timeout],
    ['no network', new NetworkError('offline'), t.failed.network],
  ])('%s', (_name, error, expected) => {
    expect(actionFailureMessage(error)).toBe(expected)
  })
})
