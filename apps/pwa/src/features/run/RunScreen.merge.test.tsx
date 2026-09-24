import type { ApiRun, GithubPrMergeState } from '@cezar-pwa/cezar-contract/contract'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import blockedFixture from '../../../test/fixtures/merge-state.json'
import liveRun from '../../../test/fixtures/run.live-0.11.0.json'
import { jsonResponse, renderWithQuery } from '../../../test/query.tsx'
import { en } from '../../i18n/en.ts'
import { AppRoutes } from '../../routes.tsx'

/**
 * S-19 on the task screen (#69): the PR's checks and merge state, a merge behind a confirmation
 * naming the PR (brief R03), what is in flight, the server's refusal (FR-032), and
 * `available: false` shown plainly. Never optimistic: what the panel shows after a merge is the
 * re-read state.
 */

const BASE_RUN = liveRun as unknown as ApiRun
const RUN = `/api/v1/p/cezar-pwa/runs/${BASE_RUN.id}`
const PRS = '/api/v1/p/cezar-pwa/github/prs'
const PR_URL = 'https://github.com/o/r/pull/7'
const t = en.run.merge

const READY: GithubPrMergeState = {
  ...(blockedFixture.mergeState as GithubPrMergeState),
  reviewDecision: 'approved',
  checks: [{ name: 'test', state: 'passing', required: true }],
  eligibility: 'ready',
  blockers: [],
  canMerge: true,
  canOverride: false,
}
const MERGED: GithubPrMergeState = {
  ...READY,
  state: 'merged',
  mergeable: 'unknown',
  eligibility: 'terminal',
  blockers: [{ code: 'terminal', message: 'This pull request is merged.' }],
  canMerge: false,
}

type Reply = { status: number; body: unknown } | Promise<{ status: number; body: unknown }>

/**
 * Serves the task screen with a PR. `states` is what successive merge-state reads answer (the last
 * one repeats); `merge` answers the POST. Every merge-state read and every merge is recorded.
 */
function serve(options: {
  pullRequestUrl?: string | undefined
  states: unknown[]
  merge?: (body: unknown) => Reply
}) {
  const reads: string[] = []
  const merges: unknown[] = []
  const run = {
    ...BASE_RUN,
    status: 'review',
    pullRequestUrl: 'pullRequestUrl' in options ? options.pullRequestUrl : PR_URL,
    referencedPullRequestUrl: undefined,
    markerRefs: undefined,
  } as ApiRun
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
    const path = url.pathname
    const method = init?.method ?? 'GET'
    if (path === '/api/v1/health') return jsonResponse({ version: '0.11.1', projects: [{ id: 'cezar-pwa', name: 'Cezar PWA' }] })
    if (path === '/api/v1/workspace/runs-index') return jsonResponse({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] })
    if (path === RUN || path === `${RUN}/read`) return jsonResponse(run)
    if (path === `${RUN}/history`) return jsonResponse({ events: [], itemCount: 0, liveCursor: 'live', asOfSeq: 0, hasOlder: false })
    if (path === `${RUN}/history-context`) return jsonResponse({ contextEvents: [], asOfSeq: 0 })
    if (method === 'GET' && path === `${PRS}/7/merge-state`) {
      reads.push(url.search)
      const answer = options.states[Math.min(reads.length - 1, options.states.length - 1)]
      return jsonResponse(answer)
    }
    if (method === 'POST' && path === `${PRS}/7/merge`) {
      const body = JSON.parse(String(init?.body))
      merges.push(body)
      if (!options.merge) throw new Error('unexpected merge')
      const reply = await options.merge(body)
      return jsonResponse(reply.body, reply.status)
    }
    throw new Error(`unrouted fetch in test: ${method} ${path}`)
  })
  renderWithQuery(<AppRoutes />, undefined, `/p/cezar-pwa/runs/${BASE_RUN.id}`)
  return { reads, merges }
}

const panel = async () => within(await screen.findByRole('region', { name: t.label(7) }))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the merge panel', () => {
  it('shows checks and merge state; merges behind a confirmation naming the PR, then shows the re-read state', async () => {
    let release: (reply: { status: number; body: unknown }) => void = () => {}
    const { reads, merges } = serve({
      states: [{ available: true, mergeState: READY }, { available: true, mergeState: MERGED }],
      merge: () => new Promise((resolve) => (release = resolve)),
    })
    const box = await panel()
    expect(await box.findByText(t.headline.ready)).toBeInTheDocument()
    expect(box.getByText(t.checksSummary(1, 1))).toBeInTheDocument()
    expect(box.getByText('test')).toBeInTheDocument()

    fireEvent.click(box.getByRole('button', { name: t.mergeButton }))
    expect(merges).toEqual([])
    const dialog = within(box.getByRole('alertdialog', { name: t.confirm.title(7) }))
    expect(dialog.getByText(t.confirm.body(READY.title, 'main'))).toBeInTheDocument()
    // Squash is the repository's default, and all three are offered.
    expect(dialog.getByRole('radio', { name: t.method.squash })).toBeChecked()
    fireEvent.click(dialog.getByRole('radio', { name: t.method.merge }))
    fireEvent.click(dialog.getByRole('button', { name: t.method.merge }))

    // In flight: every control waits, nothing claims a merge yet.
    expect(await dialog.findByRole('button', { name: t.merging })).toBeDisabled()
    expect(dialog.getByRole('button', { name: t.confirm.back })).toBeDisabled()
    expect(box.queryByText(t.headline.merged)).toBeNull()
    expect(merges).toEqual([{ method: 'merge', expectedHeadSha: READY.headSha }])

    release({ status: 200, body: { merged: true, number: 7, url: PR_URL, method: 'merge' } })
    expect(await box.findByText(t.headline.merged)).toBeInTheDocument()
    expect(box.getByRole('status')).toHaveTextContent(t.merged(7))
    expect(box.queryByRole('button', { name: t.mergeButton })).toBeNull()
    // The state after the merge is GitHub's, asked past the server's cache.
    expect(reads.at(-1)).toBe('?refresh=1')
  })

  it("shows the server's refusal verbatim and the re-read state, never a merge (FR-032)", async () => {
    const stale = 'The pull request head changed. Review the new commits before merging.'
    const { reads } = serve({
      states: [{ available: true, mergeState: READY }],
      merge: () => ({ status: 409, body: { error: stale, code: 'stale-head' } }),
    })
    const box = await panel()
    fireEvent.click(await box.findByRole('button', { name: t.mergeButton }))
    fireEvent.click(box.getByRole('button', { name: t.method.squash }))
    expect(await box.findByRole('alert')).toHaveTextContent(en.run.actions.failed.refused(stale))
    expect(box.queryByRole('alertdialog')).toBeNull()
    expect(box.getByText(t.headline.ready)).toBeInTheDocument()
    await waitFor(() => expect(reads).toEqual(['', '?refresh=1']))
  })

  it('blocked but bypassable: merge only after "merge without waiting", and the request says so', async () => {
    const { merges } = serve({
      states: [blockedFixture],
      merge: () => ({ status: 200, body: { merged: true, number: 7, url: PR_URL, method: 'squash' } }),
    })
    const box = await panel()
    expect(await box.findByText(t.headline.failing)).toBeInTheDocument()
    expect(box.getByText('One or more checks are failing.')).toBeInTheDocument()
    // Failing first, each state in words beside its glyph.
    const checks = box.getAllByRole('listitem').slice(0, 3).map((item) => item.textContent)
    expect(checks[0]).toContain(`e2e (webkit-iphone) · ${t.checkState.failing}`)
    expect(checks[1]).toContain(t.checkState.pending)
    expect(checks[2]).toContain(t.checkState.passing)

    const merge = box.getByRole('button', { name: t.mergeButton })
    expect(merge).toBeDisabled()
    fireEvent.click(box.getByRole('checkbox', { name: new RegExp(t.override) }))
    expect(merge).toBeEnabled()
    fireEvent.click(merge)
    expect(box.getByText(t.confirm.override)).toBeInTheDocument()
    fireEvent.click(box.getByRole('button', { name: t.method.squash }))
    await waitFor(() =>
      expect(merges).toEqual([{ method: 'squash', expectedHeadSha: READY.headSha, overrideRules: true }]),
    )
  })

  it('available: false shows the reason plainly and offers no merge', async () => {
    serve({ states: [{ available: false, reason: 'gh: not logged in to github.com' }] })
    const box = await panel()
    expect(await box.findByText('gh: not logged in to github.com')).toBeInTheDocument()
    expect(box.getByText(t.unavailable, { exact: false })).toBeInTheDocument()
    expect(box.queryByRole('button', { name: t.mergeButton })).toBeNull()
  })

  it('a PR in another repository is not merged through this project', async () => {
    serve({ pullRequestUrl: 'https://github.com/other/repo/pull/7', states: [{ available: true, mergeState: READY }] })
    const box = await panel()
    expect(await box.findByText(t.otherPr)).toBeInTheDocument()
    expect(box.queryByRole('button', { name: t.mergeButton })).toBeNull()
  })

  it('a task without a PR asks nothing', async () => {
    const { reads } = serve({ pullRequestUrl: undefined, states: [] })
    await screen.findByRole('region', { name: en.run.actions.label })
    expect(screen.queryByRole('region', { name: t.label(7) })).toBeNull()
    expect(reads).toEqual([])
  })
})
