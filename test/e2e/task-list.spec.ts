import { readFileSync } from 'node:fs'
import { type Page, expect, test } from '@playwright/test'
import { en } from '../../apps/pwa/src/i18n/en.ts'

/**
 * S-03 acceptance in mobile Safari: the operator opens the app and sees every task across
 * projects, attention first, filterable by project, refreshable.
 *
 * Cezar is stubbed with the same hand-written index the unit tests use — validated against
 * the vendored contract in `apps/pwa/test/contract/` — so what is under test is the app's
 * reading of real shapes, not a live instance's contents.
 */

const runsIndex = readFileSync(
  new URL('../../apps/pwa/test/fixtures/runs-index.json', import.meta.url),
  'utf8',
)

const health = JSON.stringify({
  version: '0.11.0',
  projects: [
    { id: 'cezar-pwa', name: 'cezar-pwa' },
    { id: 'kai-phone', name: 'kai-phone' },
    { id: 'notes', name: 'notes' },
  ],
})

/**
 * The event stream (S-04, `live-status.spec.ts`) is held open and silent here: these tests are
 * about the list and its refresh paths, and an unrouted stream would reach the real gateway
 * through the preview proxy, fail, and re-probe the session on a timing of its own.
 */
const holdEventStream = (page: Page) => page.route('**/api/v1/workspace/events', () => {})

/** Serves both endpoints and counts how often the list was asked for. */
async function serveCezar(page: Page) {
  const counts = { runsIndex: 0 }
  await holdEventStream(page)
  await page.route('**/api/v1/health', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: health }),
  )
  await page.route('**/api/v1/workspace/runs-index', (route) => {
    counts.runsIndex += 1
    return route.fulfill({ status: 200, contentType: 'application/json', body: runsIndex })
  })
  return counts
}

// Playwright's WebKit does not route requests from a page a service worker controls, and a
// reload makes the page controlled. The worker never touches /api/** anyway (CLAUDE.md rule 4).
test.use({ serviceWorkers: 'block' })

test.describe('Task list', () => {
  test('answers "does anything need me?" within three seconds, attention first (US-02)', async ({
    page,
  }) => {
    await serveCezar(page)
    await page.goto('.')

    await expect(page.getByRole('heading', { name: en.runs.summary.some(3) })).toBeVisible({
      timeout: 3_000,
    })
    await expect(page.getByRole('heading', { level: 3 })).toHaveText([
      `${en.runs.sections.attention} (3)`,
      `${en.runs.sections.running} (2)`,
      `${en.runs.sections.queued} (3)`,
      `${en.runs.sections.finished} (3)`,
    ])
    // Archived work stays out of the list.
    await expect(page.getByText('An archived task nobody will touch again')).toHaveCount(0)
  })

  test('fits the phone: no sideways scrolling at 390 px', async ({ page }) => {
    await serveCezar(page)
    await page.goto('.')
    await expect(page.getByRole('heading', { name: /need attention/ })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('the project filter narrows the list and survives a restart (FR-013)', async ({ page }) => {
    await serveCezar(page)
    await page.goto('.')

    await page.getByRole('combobox', { name: en.runs.filter.label }).selectOption('kai-phone')
    await expect(page.getByRole('heading', { name: `${en.runs.sections.attention} (1)` })).toBeVisible()
    await expect(page.getByText(en.runs.summary.elsewhere(2))).toBeVisible()

    await page.reload()
    await expect(page.getByRole('combobox', { name: en.runs.filter.label })).toHaveValue('kai-phone')
    await expect(page.getByRole('heading', { name: `${en.runs.sections.attention} (1)` })).toBeVisible()
  })

  test('refreshes on request and on return to the foreground (FR-011)', async ({ page }) => {
    const counts = await serveCezar(page)
    await page.goto('.')
    await expect(page.getByRole('heading', { name: /need attention/ })).toBeVisible()

    const before = counts.runsIndex
    await page.getByRole('button', { name: en.runs.refresh }).click()
    await expect.poll(() => counts.runsIndex).toBe(before + 1)

    // What iOS fires when the operator comes back to a frozen app. The real event bubbles
    // (HTML: "fire an event named visibilitychange at the Document, with bubbles true"), and
    // TanStack's focus manager listens for it on window.
    await page.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true })),
    )
    await expect.poll(() => counts.runsIndex).toBeGreaterThan(before + 1)
  })

  test('a lapsed session sends the operator to "Connect to Cezar", not to a broken list', async ({
    page,
  }) => {
    let authorized = true
    await holdEventStream(page)
    await page.route('**/api/v1/health', (route) =>
      authorized
        ? route.fulfill({ status: 200, contentType: 'application/json', body: health })
        : route.fulfill({ status: 403, contentType: 'text/html', body: '403' }),
    )
    await page.route('**/api/v1/workspace/runs-index', (route) =>
      authorized
        ? route.fulfill({ status: 200, contentType: 'application/json', body: runsIndex })
        : route.fulfill({ status: 403, contentType: 'text/html', body: '403' }),
    )
    await page.goto('.')
    await expect(page.getByRole('heading', { name: /need attention/ })).toBeVisible()

    authorized = false
    await page.getByRole('button', { name: en.runs.refresh }).click()

    await expect(page.getByRole('heading', { name: en.auth.title })).toBeVisible()
  })
})

/**
 * #67: "Mark all read" over the tasks on screen. The stub sweeps the way Cezar does — every
 * unread finished run of the project gets a `seenAt` — and one project can be made to refuse.
 */
async function serveSweep(page: Page, refuse?: string) {
  const swept = new Set<string>()
  const calls: string[] = []
  await holdEventStream(page)
  await page.route('**/api/v1/health', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: health }),
  )
  await page.route('**/api/v1/workspace/runs-index', (route) => {
    const index = JSON.parse(runsIndex) as { runs: { projectId: string; finishedAt?: string }[] }
    const runs = index.runs.map((run) =>
      swept.has(run.projectId) && run.finishedAt ? { ...run, seenAt: '2026-09-24T12:00:00.000Z' } : run,
    )
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...index, runs }) })
  })
  await page.route('**/api/v1/p/*/runs/read-all', (route) => {
    const projectId = new URL(route.request().url()).pathname.split('/')[4] as string
    calls.push(`${route.request().method()} ${projectId}`)
    if (projectId === refuse) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"store is read-only"}' })
    }
    swept.add(projectId)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"read":1}' })
  })
  return calls
}

test.describe('Mark all read (#67)', () => {
  const t = en.runs.readAll
  // 1× keeps the evidence screenshots small; layout does not depend on the pixel ratio.
  test.use({ deviceScaleFactor: 1 })

  test('one confirmation clears every marker on screen, one call per project in view', async ({ page }) => {
    const calls = await serveSweep(page)
    await page.goto('.')

    await page.getByRole('button', { name: t.action(2) }).tap()
    const dialog = page.getByRole('alertdialog', { name: t.confirmTitle(2) })
    await expect(dialog).toContainText(t.confirmBody('cezar-pwa, kai-phone'))
    await dialog.getByRole('button', { name: t.confirm }).tap()

    await expect(page.getByText(t.done(2))).toBeVisible()
    await expect(page.getByText(`(${en.runs.unread})`)).toHaveCount(0)
    expect(calls.sort()).toEqual(['POST cezar-pwa', 'POST kai-phone'])
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`fits 390×844 in the ${scheme} theme, and names the project that failed`, async ({ page }) => {
      await serveSweep(page, 'kai-phone')
      await page.emulateMedia({ colorScheme: scheme })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('.')
      const evidence = process.env.E2E_EVIDENCE_DIR
      const noSideways = async () =>
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        ).toBeLessThanOrEqual(0)

      await expect(page.getByRole('button', { name: t.action(2) })).toBeVisible()
      await noSideways()
      if (evidence) await page.screenshot({ path: `${evidence}/offer-${scheme}.png` })

      await page.getByRole('button', { name: t.action(2) }).tap()
      await expect(page.getByRole('alertdialog')).toBeVisible()
      await noSideways()
      if (evidence) await page.screenshot({ path: `${evidence}/confirm-${scheme}.png` })

      await page.getByRole('alertdialog').getByRole('button', { name: t.confirm }).tap()
      await expect(page.getByRole('alert')).toHaveText(t.failed('kai-phone', 'Cezar refused: store is read-only'))
      await expect(page.getByRole('button', { name: t.action(1) })).toBeVisible()
      await noSideways()
      if (evidence) await page.screenshot({ path: `${evidence}/partial-failure-${scheme}.png` })
    })
  }
})
