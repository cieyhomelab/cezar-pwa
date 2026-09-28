import { readFileSync } from 'node:fs'
import { type Page, expect, test } from '@playwright/test'
import { en } from '../../apps/pwa/src/i18n/en.ts'

/**
 * #101 in mobile Safari: a dispatch tree folds under its parent row (parity with Cezar 0.12.0,
 * #1110). The stub serves the unit tests' index plus one tree — a root running four dispatched
 * children, one of which is waiting for the operator and so stays in "Needs attention".
 */

type Run = { id: string; title: string; status: string; createdAt: string; [key: string]: unknown }
const index = JSON.parse(
  readFileSync(new URL('../../apps/pwa/test/fixtures/runs-index.json', import.meta.url), 'utf8'),
) as { runs: Run[] }
// The fixture's running row, minus its auto-summary, which would stand in for every title below.
const { titleSummary: _summary, titleOrigin: _origin, ...running } = index.runs.find(
  (run) => run.id === 'run-running',
) as Run

const dispatched = (id: string, title: string, minute: number, over: Partial<Run> = {}): Run => ({
  ...running,
  id,
  title,
  createdAt: `2026-09-21T11:0${minute}:00.000Z`,
  dispatch: { rootRunId: 'tree-root', parentRunId: 'tree-root', kind: 'review' },
  ...over,
})
const tree: Run[] = [
  { ...running, id: 'tree-root', title: 'Implementing the subtask fold', createdAt: '2026-09-21T11:00:00.000Z' },
  dispatched('tree-a', 'Reviewing the domain fold', 1),
  dispatched('tree-b', 'Reviewing the toggle', 2),
  dispatched('tree-c', 'Implementing the E2E', 3, { dispatch: { rootRunId: 'tree-root', parentRunId: 'tree-root', kind: 'implement' } }),
  dispatched('tree-asks', 'Asking which fixture to use', 4, { status: 'waiting' }),
]
const body = JSON.stringify({ ...index, runs: [...index.runs, ...tree] })

const health = JSON.stringify({
  version: '0.11.0',
  projects: [
    { id: 'cezar-pwa', name: 'cezar-pwa' },
    { id: 'kai-phone', name: 'kai-phone' },
    { id: 'notes', name: 'notes' },
  ],
})

async function serveCezar(page: Page) {
  // Held open and silent: an unrouted stream would reach the gate stub and re-probe the session.
  await page.route('**/api/v1/workspace/events', () => {})
  await page.route('**/api/v1/health', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: health }),
  )
  await page.route('**/api/v1/workspace/runs-index', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body }),
  )
}

const noSidewaysScroll = async (page: Page) =>
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0)

test.use({ serviceWorkers: 'block' })

const label = en.runs.subtasks.count(3)
const section = (page: Page, key: keyof typeof en.runs.sections) =>
  page.getByRole('region', { name: new RegExp(`^${en.runs.sections[key]} \\(`) })

test('a dispatch tree folds under its parent and expands with one tap (#101)', async ({ page }) => {
  await serveCezar(page)
  await page.goto('.')

  const progress = section(page, 'running')
  await expect(progress.getByRole('heading')).toHaveText(`${en.runs.sections.running} (6)`)
  await expect(progress.getByText('Reviewing the toggle')).toHaveCount(0)
  // The child that wants the operator is never folded away.
  await expect(section(page, 'attention').getByText('Asking which fixture to use')).toBeVisible()

  const toggle = progress.getByRole('button', { name: en.runs.subtasks.expand(label) })
  const box = await toggle.boundingBox()
  expect(box?.height).toBeGreaterThanOrEqual(44)
  await toggle.tap()

  await expect(progress.getByRole('button', { name: en.runs.subtasks.collapse(label) })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  for (const title of ['Reviewing the domain fold', 'Reviewing the toggle', 'Implementing the E2E']) {
    await expect(progress.getByText(title)).toBeVisible()
  }
  // The toggle is not the row's link: tapping it expanded in place.
  await expect(page).toHaveURL(/\/m\/$/)
  await noSidewaysScroll(page)

  await progress.getByRole('button', { name: en.runs.subtasks.collapse(label) }).tap()
  await expect(progress.getByText('Reviewing the toggle')).toHaveCount(0)
})

test.describe('at 390×844', () => {
  test.use({ deviceScaleFactor: 1 })

  for (const scheme of ['light', 'dark'] as const) {
    test(`an expanded tree fits 390×844 in the ${scheme} theme`, async ({ page }) => {
      await serveCezar(page)
      await page.emulateMedia({ colorScheme: scheme })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('.')

      const progress = section(page, 'running')
      await progress.getByRole('button', { name: en.runs.subtasks.expand(label) }).tap()
      await expect(progress.getByText('Implementing the E2E')).toBeVisible()
      await noSidewaysScroll(page)
      const evidence = process.env.E2E_EVIDENCE_DIR
      if (evidence) {
        await progress.scrollIntoViewIfNeeded()
        await page.screenshot({ path: `${evidence}/subtasks-${scheme}.png` })
      }
    })
  }
})
