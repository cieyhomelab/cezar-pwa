import { readFileSync } from 'node:fs'
import { type Page, expect, test } from '@playwright/test'
import { en } from '../../apps/pwa/src/i18n/en.ts'

/**
 * S-19 acceptance in mobile Safari (#69): on a task with a PR, its checks and merge state, and a
 * merge behind a confirmation naming the PR's number and title (brief R03). The merge state is
 * mocked: nothing here reaches a real forge. What the panel shows after the merge is the state
 * re-read from the server, never assumed.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`../../apps/pwa/test/fixtures/${name}`, import.meta.url), 'utf8')

const liveRun = JSON.parse(fixture('run.live-0.11.0.json')) as Record<string, unknown> & { id: string }
const blocked = JSON.parse(fixture('merge-state.json')) as { available: true; mergeState: Record<string, unknown> }
const PROJECT = 'cezar-pwa'
const RUN_PATH = `p/${PROJECT}/runs/${liveRun.id}`
const PR_URL = String(blocked.mergeState.url)
const health = JSON.stringify({ version: '0.11.1', projects: [{ id: PROJECT, name: PROJECT }] })
const t = en.run.merge

const merged = {
  available: true,
  mergeState: {
    ...blocked.mergeState,
    state: 'merged',
    mergeable: 'unknown',
    checks: (blocked.mergeState.checks as Record<string, unknown>[]).map((check) => ({ ...check, state: 'passing' })),
    eligibility: 'terminal',
    blockers: [{ code: 'terminal', message: 'This pull request is merged.' }],
    canMerge: false,
    canOverride: false,
  },
}

/** Serves a task in review with a PR. The merge state flips to `merged` once a merge is posted. */
async function serveCezar(page: Page) {
  const state = { merged: false }
  const merges: unknown[] = []
  const json = (body: unknown, code = 200) => ({ status: code, contentType: 'application/json', body: JSON.stringify(body) })
  const run = { ...liveRun, status: 'review', pullRequestUrl: PR_URL, referencedPullRequestUrl: undefined, markerRefs: undefined }
  await page.route('**/api/v1/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: health }))
  await page.route('**/api/v1/workspace/runs-index', (route) =>
    route.fulfill(json({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] })),
  )
  await page.route('**/api/v1/workspace/events', (route) => route.abort())
  const base = `**/api/v1/p/${PROJECT}/runs/${liveRun.id}`
  await page.route(`${base}/events*`, (route) => route.abort())
  await page.route(base, (route) => route.fulfill(json(run)))
  await page.route(`${base}/history`, (route) =>
    route.fulfill(json({ events: [], itemCount: 0, liveCursor: 'live', asOfSeq: 0, hasOlder: false })),
  )
  await page.route(`${base}/history-context`, (route) => route.fulfill(json({ contextEvents: [], asOfSeq: 0 })))
  await page.route(`${base}/read`, (route) => route.fulfill(json(run)))
  await page.route(`**/api/v1/p/${PROJECT}/github/prs/7/merge-state*`, (route) =>
    route.fulfill(json(state.merged ? merged : blocked)),
  )
  await page.route(`**/api/v1/p/${PROJECT}/github/prs/7/merge`, (route) => {
    merges.push(route.request().postDataJSON())
    state.merged = true
    return route.fulfill(json({ merged: true, number: 7, url: PR_URL, method: 'squash' }))
  })
  return merges
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

// Playwright's WebKit does not route requests from a page a service worker controls.
test.use({ serviceWorkers: 'block' })

test('a blocked PR shows why, and merges only after "merge without waiting" and a confirmation', async ({ page }) => {
  const merges = await serveCezar(page)
  await page.goto(RUN_PATH)

  const panel = page.getByRole('region', { name: t.label(7) })
  await expect(panel.getByText(t.headline.failing)).toBeVisible()
  await expect(panel.getByText('One or more checks are failing.')).toBeVisible()
  await expect(panel.getByText(t.checksSummary(1, 3))).toBeVisible()
  await noSidewaysScroll(page)

  const merge = panel.getByRole('button', { name: t.mergeButton })
  await expect(merge).toBeDisabled()
  const override = panel.getByRole('checkbox', { name: new RegExp(t.override) })
  await override.tap()
  await expect(merge).toBeEnabled()
  expect((await merge.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  await merge.tap()

  const dialog = panel.getByRole('alertdialog', { name: t.confirm.title(7) })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(t.confirm.body(String(blocked.mergeState.title), 'main'))).toBeVisible()
  await expect(dialog.getByText(t.confirm.override)).toBeVisible()
  expect(merges).toEqual([])
  await noSidewaysScroll(page)

  await dialog.getByRole('button', { name: t.method.squash }).tap()
  await expect(panel.getByText(t.headline.merged)).toBeVisible()
  await expect(panel.getByText(t.merged(7))).toBeVisible()
  await expect(panel.getByRole('button', { name: t.mergeButton })).toHaveCount(0)
  expect(merges).toEqual([
    { method: 'squash', expectedHeadSha: blocked.mergeState.headSha, overrideRules: true },
  ])
})

test('backing out of the confirmation sends nothing', async ({ page }) => {
  const merges = await serveCezar(page)
  await page.goto(RUN_PATH)
  const panel = page.getByRole('region', { name: t.label(7) })
  await panel.getByRole('checkbox', { name: new RegExp(t.override) }).tap()
  await panel.getByRole('button', { name: t.mergeButton }).tap()
  await panel.getByRole('button', { name: t.confirm.back }).tap()
  await expect(panel.getByRole('alertdialog')).toHaveCount(0)
  expect(merges).toEqual([])
})

test.describe('at 390×844', () => {
  // 1× keeps the evidence screenshots small; layout does not depend on the pixel ratio.
  test.use({ deviceScaleFactor: 1 })

  for (const scheme of ['light', 'dark'] as const) {
    test(`the merge panel fits 390×844 in the ${scheme} theme`, async ({ page }) => {
      await serveCezar(page)
      await page.emulateMedia({ colorScheme: scheme })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(RUN_PATH)
      const panel = page.getByRole('region', { name: t.label(7) })
      await expect(panel.getByText(t.headline.failing)).toBeVisible()
      await panel.scrollIntoViewIfNeeded()
      await noSidewaysScroll(page)
      const evidence = process.env.E2E_EVIDENCE_DIR
      if (evidence) await panel.screenshot({ path: `${evidence}/merge-state-${scheme}.png` })

      await panel.getByRole('checkbox', { name: new RegExp(t.override) }).tap()
      await panel.getByRole('button', { name: t.mergeButton }).tap()
      await expect(panel.getByRole('alertdialog')).toBeVisible()
      await noSidewaysScroll(page)
      if (evidence) await panel.screenshot({ path: `${evidence}/confirm-merge-${scheme}.png` })

      await panel.getByRole('alertdialog').getByRole('button', { name: t.method.squash }).tap()
      await expect(panel.getByText(t.headline.merged)).toBeVisible()
      if (evidence) await panel.screenshot({ path: `${evidence}/merged-${scheme}.png` })
    })
  }
})
