import type { ApiRun } from '@cezar-pwa/cezar-contract/contract'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import liveRun from '../../../test/fixtures/run.live-0.11.0.json'
import { jsonResponse, renderWithQuery } from '../../../test/query.tsx'
import { en } from '../../i18n/en.ts'
import { AppRoutes } from '../../routes.tsx'

/**
 * S-21 (#71) on the task screen: a task started as variants lists its siblings with status,
 * change count and cost, and keeps this one behind a confirmation, showing the pick in flight
 * and Cezar's reason when it refuses (FR-032). No group exists on the host, so the group
 * answers here are synthetic (`test/fixtures/group.json` pins the shape against the contract).
 */

const BASE_RUN = liveRun as unknown as ApiRun
const RUN_ID = BASE_RUN.id
const BASE = `/api/v1/p/cezar-pwa/runs/${RUN_ID}`
const GROUP = '/api/v1/p/cezar-pwa/groups/g-1'
const t = en.run.variants

const runAs = (status: string, extra: Record<string, unknown> = {}) =>
  ({ ...BASE_RUN, status, groupId: 'g-1', variant: 'A', archived: false, ...extra }) as ApiRun

const variant = (id: string, letter: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  variant: letter,
  title: 'Add a dark theme toggle',
  status,
  archived: false,
  tokensUsed: 1000,
  diffStat: '',
  handoffExcerpt: '',
  ...extra,
})

const groupOf = (thisStatus: string, siblingExtra: Record<string, unknown> = {}) => ({
  groupId: 'g-1',
  runs: [
    variant('run-b', 'B', 'done', { costUsd: 0.08, diffStat: ' 1 file changed, 2 insertions(+)\n', ...siblingExtra }),
    variant(RUN_ID, 'A', thisStatus, { costUsd: 0.41, diffStat: ' 3 files changed, 25 insertions(+), 12 deletions(-)\n' }),
  ],
})

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>

/** Serves the task screen and its group. Both are mutable so a pick can move them on. */
function serve(initialRun: ApiRun, initialGroup: unknown, pick?: Handler) {
  const state = { run: initialRun, group: initialGroup }
  const picks: unknown[] = []
  let groupReads = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = new URL(url, 'http://localhost').pathname
    const method = init?.method ?? 'GET'
    if (path === '/api/v1/health') return jsonResponse({ version: '0.11.1', projects: [{ id: 'cezar-pwa', name: 'Cezar PWA' }] })
    if (path === '/api/v1/workspace/runs-index') return jsonResponse({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] })
    if (path === BASE) return jsonResponse(state.run)
    if (path === `${BASE}/history`) return jsonResponse({ events: [], itemCount: 0, liveCursor: 'live', asOfSeq: 0, hasOlder: false })
    if (path === `${BASE}/history-context`) return jsonResponse({ contextEvents: [], asOfSeq: 0 })
    if (path === `${BASE}/read`) return jsonResponse(state.run)
    if (path === GROUP && method === 'GET') {
      groupReads += 1
      return jsonResponse(state.group)
    }
    if (path === `${GROUP}/pick` && method === 'POST') {
      picks.push(init?.body ? JSON.parse(String(init.body)) : undefined)
      if (!pick) throw new Error('unrouted pick in test')
      return pick(init)
    }
    throw new Error(`unrouted fetch in test: ${method} ${path}`)
  })
  renderWithQuery(<AppRoutes />, undefined, `/p/cezar-pwa/runs/${RUN_ID}`)
  return { state, picks, groupReads: () => groupReads }
}

const panel = async () => within(await screen.findByRole('region', { name: t.label }))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the variants of a task', () => {
  it('a task that is not a variant has no panel and never asks for a group', async () => {
    const { groupReads } = serve({ ...runAs('done'), groupId: undefined, variant: undefined } as ApiRun, groupOf('done'))
    await screen.findByRole('region', { name: en.run.actions.label })
    expect(screen.queryByRole('region', { name: t.label })).toBeNull()
    expect(groupReads()).toBe(0)
  })

  it('lists every variant in order with status, change count and cost; a sibling opens its own task', async () => {
    serve(runAs('done'), groupOf('done'))
    const variants = await panel()
    const items = await variants.findAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining(`${t.variant('A')} · ${t.thisOne}`),
      expect.stringContaining(t.variant('B')),
    ])
    expect(items[0]!.textContent).toContain(`${t.changes(3)} · $0.41`)
    expect(items[1]!.textContent).toContain(`${t.changes(1)} · $0.08`)
    expect(within(items[0]!).queryByRole('link')).toBeNull()
    expect(within(items[1]!).getByRole('link').getAttribute('href')).toBe('/p/cezar-pwa/runs/run-b')
  })

  it('a variant whose worktree is gone says its changes are unknown, not zero', async () => {
    serve(runAs('done'), groupOf('done', { diffStat: '', archived: true }))
    const items = await (await panel()).findAllByRole('listitem')
    expect(items[1]!.textContent).toContain(`${t.changesUnknown} · $0.08 · ${t.archived}`)
  })
})

describe('keeping this one', () => {
  it('asks first; "not yet" sends nothing', async () => {
    const { picks } = serve(runAs('done'), groupOf('done'))
    fireEvent.click(await (await panel()).findByRole('button', { name: t.keep }))
    const dialog = await screen.findByRole('alertdialog', { name: t.confirm.title('A') })
    expect(dialog.textContent).toContain(t.confirm.body(1))
    fireEvent.click(within(dialog).getByRole('button', { name: t.confirm.back }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(picks).toEqual([])
  })

  it('counts an archived sibling among those whose worktree goes', async () => {
    serve(runAs('done'), {
      groupId: 'g-1',
      runs: [
        variant(RUN_ID, 'A', 'done'),
        variant('run-b', 'B', 'done'),
        variant('run-c', 'C', 'failed', { archived: true, diffStat: ' 1 file changed, 1 insertion(+)\n' }),
      ],
    })
    fireEvent.click(await (await panel()).findByRole('button', { name: t.keep }))
    const dialog = await screen.findByRole('alertdialog', { name: t.confirm.title('A') })
    expect(dialog.textContent).toContain(t.confirm.body(2))
  })

  it('shows the pick in flight, blocks the task actions, then reports and drops the offer', async () => {
    let release: (response: Response) => void = () => {}
    const { state, picks } = serve(runAs('done'), groupOf('done'), () => new Promise<Response>((resolve) => (release = resolve)))
    fireEvent.click(await (await panel()).findByRole('button', { name: t.keep }))
    fireEvent.click(await screen.findByRole('button', { name: t.confirm.confirm('A') }))

    const keeping = await screen.findByRole('button', { name: t.keeping })
    expect((keeping as HTMLButtonElement).disabled).toBe(true)
    const actions = within(screen.getByRole('region', { name: en.run.actions.label }))
    for (const button of actions.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(picks).toEqual([{ runId: RUN_ID }])

    state.group = groupOf('done', { archived: true, diffStat: '' })
    release(jsonResponse({ winner: state.run }))

    expect(await screen.findByText(t.kept('A'))).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('button', { name: t.keep })).toBeNull())
    expect(picks).toHaveLength(1)
  })

  it("shows Cezar's refusal verbatim and keeps the offer (FR-032)", async () => {
    serve(runAs('done'), groupOf('done'), () =>
      jsonResponse({ error: 'this variant is still active — wait for it to finish first' }, 409),
    )
    fireEvent.click(await (await panel()).findByRole('button', { name: t.keep }))
    fireEvent.click(await screen.findByRole('button', { name: t.confirm.confirm('A') }))
    const alert = await (await panel()).findByRole('alert')
    expect(alert.textContent).toBe(
      en.run.actions.failed.refused('this variant is still active — wait for it to finish first'),
    )
    expect(screen.getByRole('button', { name: t.keep })).toBeTruthy()
  })

  it('a variant still running cannot be kept yet, and says so', async () => {
    serve(runAs('running'), groupOf('running'))
    const variants = await panel()
    expect(await variants.findByText(t.waitToKeep)).toBeTruthy()
    expect(variants.queryByRole('button', { name: t.keep })).toBeNull()
  })

  it('a variant that lost the pick offers nothing', async () => {
    serve(runAs('done', { archived: true }), {
      groupId: 'g-1',
      runs: [variant(RUN_ID, 'A', 'done', { archived: true }), variant('run-b', 'B', 'review')],
    })
    const variants = await panel()
    await variants.findAllByRole('listitem')
    expect(variants.queryByRole('button')).toBeNull()
    expect(variants.queryByText(t.waitToKeep)).toBeNull()
  })
})
