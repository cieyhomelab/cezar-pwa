import type { ApiRun } from '@cezar-pwa/cezar-contract/contract'
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import liveChanges from '../../../test/fixtures/changes.live-0.11.0.json'
import liveRun from '../../../test/fixtures/run.live-0.11.0.json'
import { createTestQueryClient, jsonResponse, refusalResponse, renderWithQuery } from '../../../test/query.tsx'
import { DIFF_LINE_PAGE } from '../../domain/diff.ts'
import { pl } from '../../i18n/pl.ts'
import { AppRoutes } from '../../routes.tsx'

/**
 * S-09 (FR-031): the task's diff, file by file, read-only, wrapped, no highlighting — reached
 * from the task header's "Zmiany" row.
 */

const RUN = { ...(liveRun as unknown as ApiRun), status: 'review' } as ApiRun
const BASE = `/api/v1/p/cezar-pwa/runs/${RUN.id}`
const t = pl.run.diff

const patch = (lines: string[]) => `diff --git a/x b/x\n--- a/x\n+++ b/x\n${lines.join('\n')}\n`

const FILES = [
  {
    path: 'apps/pwa/src/domain/diff.ts',
    status: 'modified',
    adds: 1,
    dels: 1,
    binary: false,
    patch: patch(['@@ -1,3 +1,3 @@', ' keep', '-old line', '+new line', ' keep too']),
  },
  { path: 'docs/new.md', status: 'added', adds: 1, dels: 0, binary: false, patch: patch(['@@ -0,0 +1 @@', '+hello']) },
  {
    path: 'b.ts',
    oldPath: 'a.ts',
    status: 'renamed',
    adds: 0,
    dels: 0,
    binary: false,
    patch: 'diff --git a/a.ts b/b.ts\nsimilarity index 100%\nrename from a.ts\nrename to b.ts\n',
  },
  { path: 'icon.png', status: 'added', adds: 0, dels: 0, binary: true, image: true, patch: '' },
  { path: 'blob.bin', status: 'modified', adds: 0, dels: 0, binary: true, patch: '' },
]

const changes = (files: unknown[], extra: Record<string, unknown> = {}) => ({
  files,
  stat: { files: files.length, adds: 0, dels: 0 },
  ...extra,
})

type Route = () => Response | Promise<Response>

function serve(routes: Record<string, Route>, path = `/p/cezar-pwa/runs/${RUN.id}/diff`) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const pathname = new URL(url, 'http://localhost').pathname
    const all: Record<string, Route> = {
      '/api/v1/health': () => jsonResponse({ version: '0.11.0', projects: [{ id: 'cezar-pwa', name: 'Cezar PWA' }] }),
      [BASE]: () => jsonResponse(RUN),
      ...routes,
    }
    const route = all[pathname]
    if (!route) throw new Error(`unrouted fetch in test: ${pathname}`)
    return route()
  })
  renderWithQuery(<AppRoutes />, createTestQueryClient(), path)
}

const file = (path: string) => screen.getByRole('region', { name: path })
/** The file's own header button, which is always the first one in its section. */
const toggle = (path: string) => within(file(path)).getAllByRole('button')[0]!

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DiffScreen — file by file', () => {
  it('lists every file, closed, with how and by how much it changed', async () => {
    serve({ [`${BASE}/changes`]: () => jsonResponse(changes(FILES)) })
    expect(await screen.findByRole('heading', { name: t.title })).toBeInTheDocument()
    await screen.findByRole('region', { name: FILES[0]!.path })

    // Summed from the rows, not taken from `stat`: the header agrees with what is under it.
    expect(screen.getByText(t.files(5))).toBeInTheDocument()
    expect(screen.getAllByText(t.countsLabel(2, 1)).length).toBeGreaterThan(0)

    for (const { path } of FILES) expect(toggle(path)).toHaveAttribute('aria-expanded', 'false')
    expect(within(file('apps/pwa/src/domain/diff.ts')).getByText('apps/pwa/src/domain/')).toBeInTheDocument()
    expect(within(file('docs/new.md')).getByText(t.status.added!)).toBeInTheDocument()
    expect(within(file('b.ts')).getByText(`· ${t.renamedFrom('a.ts')}`)).toBeInTheDocument()
    // Nothing of any patch is on screen until a file is opened.
    expect(screen.queryByText('new line')).not.toBeInTheDocument()
  })

  it('opens a file to its patch: hunk header, markers, line numbers, no file header lines', async () => {
    serve({ [`${BASE}/changes`]: () => jsonResponse(changes(FILES)) })
    await screen.findByRole('region', { name: FILES[0]!.path })
    fireEvent.click(toggle('apps/pwa/src/domain/diff.ts'))

    const body = within(file('apps/pwa/src/domain/diff.ts'))
    expect(toggle('apps/pwa/src/domain/diff.ts')).toHaveAttribute('aria-expanded', 'true')
    expect(body.getByText('@@ -1,3 +1,3 @@')).toBeInTheDocument()
    expect(body.getByText('old line').parentElement).toHaveClass('bg-diff-del')
    expect(body.getByText('new line').parentElement).toHaveClass('bg-diff-add')
    // Said in words too, not by colour alone.
    expect(body.getByText(`${t.lineKind.del}:`, { exact: false })).toBeInTheDocument()
    expect(body.queryByText(/^\+\+\+ b\/x$/)).not.toBeInTheDocument()

    fireEvent.click(toggle('apps/pwa/src/domain/diff.ts'))
    expect(screen.queryByText('new line')).not.toBeInTheDocument()
  })

  it.each([
    ['b.ts', t.noContent],
    ['icon.png', t.image],
    ['blob.bin', t.binary],
  ])('%s says why there is no patch to read', async (path, note) => {
    serve({ [`${BASE}/changes`]: () => jsonResponse(changes(FILES)) })
    await screen.findByRole('region', { name: path })
    fireEvent.click(toggle(path))
    expect(within(file(path)).getByText(note)).toBeInTheDocument()
  })

  it('reads a real answer: git\'s own patch, numbered from the hunk header', async () => {
    serve({ [`${BASE}/changes`]: () => jsonResponse(liveChanges) })
    await screen.findByRole('region', { name: 'apps/pwa/src/routes.tsx' })
    fireEvent.click(toggle('apps/pwa/src/routes.tsx'))
    // The matcher sees the text with its indentation collapsed; the page keeps it (`pre-wrap`).
    const added = within(file('apps/pwa/src/routes.tsx')).getByText(
      '<Route path="p/:projectId/runs/:runId/diff" element={<DiffScreen />} />',
    )
    expect(added.parentElement).toHaveClass('bg-diff-add')
    expect(screen.getByText(t.files(3))).toBeInTheDocument()
  })

  it('a single file is the whole diff, so it arrives open', async () => {
    serve({ [`${BASE}/changes`]: () => jsonResponse(changes([FILES[1]])) })
    expect(await screen.findByText('hello')).toBeInTheDocument()
  })

  it('pages a long file instead of rendering every line at once', async () => {
    const count = DIFF_LINE_PAGE + 5
    const lines = Array.from({ length: count }, (_, index) => `+line ${index + 1}`)
    serve({
      [`${BASE}/changes`]: () =>
        jsonResponse(changes([{ path: 'big.txt', status: 'added', adds: count, dels: 0, binary: false, patch: patch([`@@ -0,0 +1,${count} @@`, ...lines]) }])),
    })
    expect(await screen.findByText(`line ${DIFF_LINE_PAGE}`)).toBeInTheDocument()
    expect(screen.queryByText(`line ${DIFF_LINE_PAGE + 1}`)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t.showMore(5) }))
    expect(screen.getByText(`line ${count}`)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.showMore(5) })).not.toBeInTheDocument()
  })

  it('says when the server cut a patch, and where the rest is', async () => {
    serve({
      [`${BASE}/changes`]: () =>
        jsonResponse(changes([{ ...FILES[1], patch: patch(['@@ -0,0 +1,3 @@', '+hello', '… (patch truncated)']) }])),
    })
    expect(await screen.findByText(t.truncated, { exact: false })).toBeInTheDocument()
    // S-12 (FR-048): the rest is in this task's Changes tab, not on the cockpit's front page.
    expect(screen.getByRole('link', { name: t.openCockpit })).toHaveAttribute(
      'href',
      `/p/cezar-pwa/tasks/${RUN.id}/changes`,
    )
    expect(screen.getByRole('link', { name: pl.shell.openTaskInCockpitLabel })).toHaveAttribute(
      'href',
      `/p/cezar-pwa/tasks/${RUN.id}/changes`,
    )
  })

  it('names a branch the agent repointed the worktree onto', async () => {
    serve({
      [`${BASE}/changes`]: () =>
        jsonResponse(changes([], { repointedHead: { headBranch: 'HEAD', taskBranch: 'cez/12d1b71c' } })),
    })
    expect(await screen.findByText(t.repointed('HEAD', 'cez/12d1b71c'))).toBeInTheDocument()
  })

  it('a status the vocabulary grew later reads as changed; a file without a patch is dropped', async () => {
    serve({
      [`${BASE}/changes`]: () =>
        jsonResponse(changes([{ ...FILES[1], path: 'x.ts', status: 'typechanged' }, { path: 'broken.ts', status: 'modified' }])),
    })
    const row = await screen.findByRole('region', { name: 'x.ts' })
    expect(within(row).getByText(t.statusUnknown)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'broken.ts' })).not.toBeInTheDocument()
  })
})

describe('DiffScreen — nothing to show', () => {
  it('a settled task with no changes says the worktree matches its base', async () => {
    serve({ [`${BASE}/changes`]: () => jsonResponse(changes([])) })
    expect(await screen.findByText(t.empty)).toBeInTheDocument()
  })

  it('a working task with no changes yet says they will come', async () => {
    serve({
      [BASE]: () => jsonResponse({ ...RUN, status: 'running' }),
      [`${BASE}/changes`]: () => jsonResponse(changes([])),
    })
    expect(await screen.findByText(t.emptyActive)).toBeInTheDocument()
  })

  it('a 409 is an answer: the server says why, verbatim', async () => {
    const reason = 'no worktree — this task ran directly in the repo working tree'
    serve({ [`${BASE}/changes`]: () => jsonResponse({ error: reason }, 409) })
    expect(await screen.findByText(t.refused)).toBeInTheDocument()
    expect(screen.getByText(reason)).toBeInTheDocument()
  })

  it('an unknown answer is an error, never "no changes"', async () => {
    serve({ [`${BASE}/changes`]: () => jsonResponse({ files: 'nope' }) })
    expect(await screen.findByText(t.loadFailed)).toBeInTheDocument()
    expect(screen.queryByText(t.empty)).not.toBeInTheDocument()
  })

  it('a lapsed session goes to the gate', async () => {
    let authorized = true
    serve({
      '/api/v1/health': () =>
        authorized ? jsonResponse({ version: '0.11.0', projects: [] }) : refusalResponse(),
      [`${BASE}/changes`]: () => {
        authorized = false
        return refusalResponse()
      },
    })
    expect(await screen.findByRole('heading', { name: pl.auth.title })).toBeInTheDocument()
  })
})

describe('the way in and out', () => {
  it('the task header opens the diff, with the record\'s numbers when it has them', async () => {
    serve(
      {
        [BASE]: () => jsonResponse({ ...RUN, diffStat: { files: 3, adds: 12, dels: 4 } }),
        [`${BASE}/history`]: () => jsonResponse({ events: [], itemCount: 0, liveCursor: 'live', asOfSeq: 0, hasOlder: false }),
        [`${BASE}/history-context`]: () => jsonResponse({ contextEvents: [], asOfSeq: 0 }),
        [`${BASE}/read`]: () => jsonResponse(RUN),
        [`${BASE}/changes`]: () => jsonResponse(changes(FILES)),
      },
      `/p/cezar-pwa/runs/${RUN.id}`,
    )
    const link = await screen.findByRole('link', { name: new RegExp(t.files(3)) })
    expect(link).toHaveAttribute('href', `/p/cezar-pwa/runs/${RUN.id}/diff`)
    fireEvent.click(link)
    expect(await screen.findByRole('heading', { name: t.title })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: new RegExp(t.back) })).toHaveAttribute('href', `/p/cezar-pwa/runs/${RUN.id}`)
  })

  it('without numbers yet, the header still offers the diff', async () => {
    serve(
      {
        [BASE]: () => jsonResponse({ ...RUN, diffStat: undefined }),
        [`${BASE}/history`]: () => jsonResponse({ events: [], itemCount: 0, liveCursor: 'live', asOfSeq: 0, hasOlder: false }),
        [`${BASE}/history-context`]: () => jsonResponse({ contextEvents: [], asOfSeq: 0 }),
        [`${BASE}/read`]: () => jsonResponse(RUN),
      },
      `/p/cezar-pwa/runs/${RUN.id}`,
    )
    expect(await screen.findByRole('link', { name: pl.run.header.showChanges })).toBeInTheDocument()
  })
})
