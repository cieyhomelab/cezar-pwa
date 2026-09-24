import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import automationLog from '../../../test/fixtures/automation-log.json'
import automations from '../../../test/fixtures/automations.json'
import { jsonResponse, renderWithQuery } from '../../../test/query.tsx'
import { en } from '../../i18n/en.ts'
import { AppRoutes } from '../../routes.tsx'

/**
 * S-20 (#70): a project's automations with Pause, Enable and Run now, each showing it is in
 * flight and Cezar's reason when it refuses (FR-032), and the recent log. No project on the host
 * has an automation, so the answers are the hand-written fixtures (pinned by the contract test).
 */

const t = en.automations
const P = '/api/v1/p/cezar-pwa'

type Handler = () => Response | Promise<Response>

function serve({ capability = true, list = automations as unknown, posts = {} as Record<string, Handler> } = {}) {
  const calls: string[] = []
  const state = { list }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = new URL(url, 'http://localhost').pathname
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${path}`)
    if (path === '/api/v1/health') {
      return jsonResponse({
        version: '0.11.1',
        projects: [{ id: 'cezar-pwa', name: 'Cezar PWA' }],
        capabilities: { automations: capability },
      })
    }
    if (path === '/api/v1/workspace/runs-index') return jsonResponse({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] })
    if (method === 'GET' && path === `${P}/automations`) return jsonResponse(state.list)
    if (method === 'GET' && path === `${P}/automation-log`) return jsonResponse(automationLog)
    const post = method === 'POST' ? posts[path] : undefined
    if (post) return post()
    throw new Error(`unrouted fetch in test: ${method} ${path}`)
  })
  return { calls, state }
}

function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const item = async (name: string) => {
  const heading = await screen.findByRole('heading', { name })
  return within(heading.closest('li') as HTMLElement)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AutomationsScreen', () => {
  it('lists each automation with its state, last run and next occurrence', async () => {
    serve()
    renderWithQuery(<AppRoutes />, undefined, '/automations?project=cezar-pwa')

    const nightly = await item('Nightly dependency check')
    expect(nightly.getByText(t.enabled)).toBeTruthy()
    expect(nightly.getByText('Every day at 04:00')).toBeTruthy()
    expect(nightly.getByText(/^Last run /)).toBeTruthy()
    expect(nightly.getByText(/^Next /)).toBeTruthy()
    expect(nightly.getByRole('button', { name: t.pause })).toBeTruthy()
    expect(nightly.getByRole('button', { name: t.runNow })).toBeTruthy()
    expect(nightly.getByRole('link', { name: t.openLastRun }).getAttribute('href')).toBe('/p/cezar-pwa/runs/run-nightly-1')

    const triage = await item('Triage new issues')
    expect(triage.getByText(t.paused)).toBeTruthy()
    expect(triage.getByText(t.neverRun)).toBeTruthy()
    expect(triage.queryByText(/^Next /)).toBeNull()
    expect(triage.getByRole('button', { name: t.enable })).toBeTruthy()
    // A GitHub poll runs through `/check`, which stays in the cockpit: the server answers /run with 409.
    expect(triage.queryByRole('button', { name: t.runNow })).toBeNull()
  })

  it("shows the server's own reason when it answers available: false", async () => {
    serve()
    renderWithQuery(<AppRoutes />, undefined, '/automations')
    const note = await screen.findByRole('note')
    expect(note.textContent).toContain(t.unavailable)
    expect(note.textContent).toContain('GitHub availability is still being checked')
  })

  it('pauses: the button says so while in flight, every action waits, then it confirms', async () => {
    const answer = deferred()
    const { calls, state } = serve({ posts: { [`${P}/automations/nightly-deps/pause`]: () => answer.promise } })
    renderWithQuery(<AppRoutes />, undefined, '/automations')

    const nightly = await item('Nightly dependency check')
    fireEvent.click(nightly.getByRole('button', { name: t.pause }))

    const pausing = await nightly.findByRole('button', { name: t.pausing })
    expect(pausing.hasAttribute('disabled')).toBe(true)
    expect(nightly.getByRole('button', { name: t.runNow }).hasAttribute('disabled')).toBe(true)
    expect((await item('Triage new issues')).getByRole('button', { name: t.enable }).hasAttribute('disabled')).toBe(true)
    expect(calls).toContain(`POST ${P}/automations/nightly-deps/pause`)

    state.list = {
      ...automations,
      automations: automations.automations.map((entry) =>
        entry.id === 'nightly-deps' ? { ...entry, enabled: false, nextRunAt: undefined } : entry,
      ),
    }
    answer.resolve(jsonResponse({ automation: { ...automations.automations[0], enabled: false } }))

    expect((await nightly.findByRole('status')).textContent).toContain(t.done.paused('Nightly dependency check'))
    // The list is re-asked, so the row flips on the server's word.
    expect(await nightly.findByRole('button', { name: t.enable })).toBeTruthy()
    expect(nightly.getByText(t.paused)).toBeTruthy()
  })

  it('enables a paused automation', async () => {
    const { calls } = serve({
      posts: { [`${P}/automations/triage-issues/enable`]: () => jsonResponse({ automation: { ...automations.automations[1], enabled: true } }) },
    })
    renderWithQuery(<AppRoutes />, undefined, '/automations')

    const triage = await item('Triage new issues')
    fireEvent.click(triage.getByRole('button', { name: t.enable }))
    expect((await triage.findByRole('status')).textContent).toContain(t.done.enabled('Triage new issues'))
    expect(calls).toContain(`POST ${P}/automations/triage-issues/enable`)
  })

  it('runs now only after a confirmation, then links to the task it started', async () => {
    const answer = deferred()
    const { calls } = serve({ posts: { [`${P}/automations/nightly-deps/run`]: () => answer.promise } })
    renderWithQuery(<AppRoutes />, undefined, '/automations')

    const nightly = await item('Nightly dependency check')
    fireEvent.click(nightly.getByRole('button', { name: t.runNow }))

    // The first tap only asks.
    const dialog = within(await nightly.findByRole('alertdialog'))
    expect(dialog.getByText(t.confirmRun.title('Nightly dependency check'))).toBeTruthy()
    expect(calls.some((call) => call.endsWith('/run'))).toBe(false)

    // "Not now" backs out without a request.
    fireEvent.click(dialog.getByRole('button', { name: t.confirmRun.back }))
    expect(nightly.queryByRole('alertdialog')).toBeNull()
    expect(calls.some((call) => call.endsWith('/run'))).toBe(false)

    fireEvent.click(nightly.getByRole('button', { name: t.runNow }))
    fireEvent.click(within(await nightly.findByRole('alertdialog')).getByRole('button', { name: t.confirmRun.confirm }))

    const starting = await nightly.findByRole('button', { name: t.running })
    expect(starting.hasAttribute('disabled')).toBe(true)
    expect(calls.filter((call) => call === `POST ${P}/automations/nightly-deps/run`)).toHaveLength(1)

    answer.resolve(jsonResponse({ runId: 'run-new-7' }, 202))
    const status = await nightly.findByRole('status')
    expect(status.textContent).toContain(t.done.started('Nightly dependency check'))
    expect(within(status).getByRole('link', { name: t.done.openTask }).getAttribute('href')).toBe('/p/cezar-pwa/runs/run-new-7')
  })

  it("shows Cezar's refusal verbatim and does not retry", async () => {
    const { calls } = serve({
      posts: { [`${P}/automations/nightly-deps/run`]: () => jsonResponse({ error: 'this instant was already launched' }, 409) },
    })
    renderWithQuery(<AppRoutes />, undefined, '/automations')

    const nightly = await item('Nightly dependency check')
    fireEvent.click(nightly.getByRole('button', { name: t.runNow }))
    fireEvent.click(within(await nightly.findByRole('alertdialog')).getByRole('button', { name: t.confirmRun.confirm }))

    expect((await nightly.findByRole('alert')).textContent).toBe(en.run.actions.failed.refused('this instant was already launched'))
    expect(calls.filter((call) => call.endsWith('/run'))).toHaveLength(1)
    // The buttons come back for another try by hand.
    expect(nightly.getByRole('button', { name: t.runNow }).hasAttribute('disabled')).toBe(false)
  })

  it("shows a refused pause in the server's words", async () => {
    serve({ posts: { [`${P}/automations/nightly-deps/pause`]: () => jsonResponse({ error: 'not found' }, 404) } })
    renderWithQuery(<AppRoutes />, undefined, '/automations')

    const nightly = await item('Nightly dependency check')
    fireEvent.click(nightly.getByRole('button', { name: t.pause }))
    expect((await nightly.findByRole('alert')).textContent).toBe(en.run.actions.failed.refused('not found'))
  })

  it('shows the recent log, newest first, with the task a launch started', async () => {
    serve()
    renderWithQuery(<AppRoutes />, undefined, '/automations')

    const log = within(await screen.findByRole('region', { name: t.log.title }))
    const rows = await log.findAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.textContent).toContain('Triage new issues')
    expect(rows[0]?.textContent).toContain('#41 Login loops on Safari')
    expect(rows[0]?.textContent).toContain('gh: HTTP 502')
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: 'Nightly dependency check' }).getAttribute('href')).toBe(
      '/p/cezar-pwa/runs/run-nightly-1',
    )
    expect(rows[2]?.textContent).toContain('deleted-one')
  })

  it('says the project has none', async () => {
    serve({ list: { ...automations, available: true, automations: [] } })
    renderWithQuery(<AppRoutes />, undefined, '/automations')
    expect(await screen.findByText(t.empty)).toBeTruthy()
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('asks nothing while the capability is off', async () => {
    const { calls } = serve({ capability: false })
    renderWithQuery(<AppRoutes />, undefined, '/automations')
    expect(await screen.findByText(t.off)).toBeTruthy()
    expect(calls.some((call) => call.includes('/automation'))).toBe(false)
  })
})

describe('the list links to the automations', () => {
  it('when the capability is on', async () => {
    serve()
    renderWithQuery(<AppRoutes />, undefined, '/')
    const link = await screen.findByRole('link', { name: t.open })
    expect(link.getAttribute('href')).toMatch(/^\/automations/)
  })

  it('not when it is off', async () => {
    serve({ capability: false })
    renderWithQuery(<AppRoutes />, undefined, '/')
    await screen.findByRole('link', { name: en.runs.newTask })
    await waitFor(() => expect(screen.queryByRole('link', { name: t.open })).toBeNull())
  })
})
