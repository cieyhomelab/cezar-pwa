import { readFileSync } from 'node:fs'
import { type Page, expect, test } from '@playwright/test'

/**
 * S-09 acceptance in mobile Safari: the operator reads what the agent changed, file by file,
 * read-only, lines wrapped, no highlighting (FR-031). Reached from the task header.
 *
 * The record is the live capture. The diff is a live `/changes` answer (this repo's own task,
 * trimmed to three files) plus one hand-written file with a line far wider than the phone.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`../../apps/pwa/test/fixtures/${name}`, import.meta.url), 'utf8')

const liveRun = JSON.parse(fixture('run.live-0.11.0.json')) as Record<string, unknown> & { id: string }
const liveChanges = JSON.parse(fixture('changes.live-0.11.0.json')) as { files: Record<string, unknown>[] }
const PROJECT = 'cezar-pwa'
const RUN_PATH = `p/${PROJECT}/runs/${liveRun.id}`
const health = JSON.stringify({ version: '0.11.0', projects: [{ id: PROJECT, name: PROJECT }] })

const WIDE = `const message = '${'a-very-long-token-without-spaces-'.repeat(8)}'`
const wideFile = {
  path: 'apps/pwa/src/some/deeply/nested/directory/with-a-long-name/wide.ts',
  status: 'added',
  adds: 1,
  dels: 0,
  binary: false,
  patch: `diff --git a/wide.ts b/wide.ts\n--- /dev/null\n+++ b/wide.ts\n@@ -0,0 +1 @@\n+${WIDE}\n`,
}

async function serveCezar(page: Page, changes: { status: number; body: unknown }) {
  const json = (body: unknown, code = 200) => ({ status: code, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/v1/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: health }))
  await page.route('**/api/v1/workspace/runs-index', (route) =>
    route.fulfill(json({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] })),
  )
  await page.route('**/api/v1/workspace/events', (route) => route.abort())
  const base = `**/api/v1/p/${PROJECT}/runs/${liveRun.id}`
  const run = { ...liveRun, status: 'review', diffStat: { files: 4, adds: 9, dels: 1 } }
  await page.route(`${base}/events*`, (route) => route.abort())
  await page.route(base, (route) => route.fulfill(json(run)))
  await page.route(`${base}/history`, (route) =>
    route.fulfill(json({ events: [], itemCount: 0, liveCursor: 'live', asOfSeq: 0, hasOlder: false })),
  )
  await page.route(`${base}/history-context`, (route) => route.fulfill(json({ contextEvents: [], asOfSeq: 0 })))
  await page.route(`${base}/read`, (route) => route.fulfill(json(run)))
  await page.route(`${base}/changes`, (route) => route.fulfill(json(changes.body, changes.status)))
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

// Playwright's WebKit does not route requests from a page a service worker controls.
test.use({ serviceWorkers: 'block' })

test('from the task header to one file\'s patch, and back (FR-031)', async ({ page }) => {
  const files = [...liveChanges.files, wideFile]
  await serveCezar(page, { status: 200, body: { files, stat: { files: 4, adds: 0, dels: 0 } } })
  await page.goto(RUN_PATH)

  await page.getByRole('link', { name: /4 pliki/ }).tap()
  await expect(page.getByRole('heading', { name: 'Zmiany' })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/m/${RUN_PATH}/diff$`))

  // Every file is listed, closed, and its header is a thumb-sized target.
  const routes = page.getByRole('region', { name: 'apps/pwa/src/routes.tsx' })
  const header = routes.getByRole('button').first()
  await expect(header).toHaveAttribute('aria-expanded', 'false')
  expect((await header.boundingBox())?.height).toBeGreaterThanOrEqual(44)

  await header.tap()
  await expect(routes.getByText('<Route path="p/:projectId/runs/:runId/diff" element={<DiffScreen />} />')).toBeVisible()

  // A line wider than the phone wraps instead of scrolling the page sideways.
  const wide = page.getByRole('region', { name: wideFile.path })
  await wide.getByRole('button').first().tap()
  await expect(wide.getByText(WIDE)).toBeVisible()
  await noSidewaysScroll(page)

  await page.getByRole('link', { name: /Zadanie/ }).tap()
  await expect(page).toHaveURL(new RegExp(`/m/${RUN_PATH}$`))
})

test("a task without a worktree: the server's reason, not an empty diff", async ({ page }) => {
  await serveCezar(page, {
    status: 409,
    body: { error: 'no worktree — this task ran directly in the repo working tree' },
  })
  await page.goto(`${RUN_PATH}/diff`)
  await expect(page.getByText('Brak zmian do pokazania.')).toBeVisible()
  await expect(page.getByText('no worktree — this task ran directly in the repo working tree')).toBeVisible()
  await noSidewaysScroll(page)
})
