import { readFileSync } from 'node:fs'
import { type Page, expect, test } from '@playwright/test'

/**
 * S-05 acceptance in mobile Safari: the operator opens a task from the list and reads its
 * header, its plan and the newest stretch of its transcript. Opening it marks it read.
 *
 * Cezar is stubbed with shapes captured from the instance (`*.live-0.11.0.json`, validated in
 * `apps/pwa/test/contract/`). The run's own history is the live page. The plan comes from a
 * hand-written context snapshot, because no live run held one.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`../../apps/pwa/test/fixtures/${name}`, import.meta.url), 'utf8')

const liveRun = JSON.parse(fixture('run.live-0.11.0.json')) as Record<string, unknown> & { id: string }
const livePage = fixture('history.live-0.11.0.json')
const runsIndex = fixture('runs-index.live-0.11.0.json')
const PROJECT = 'cezar-pwa'
const RUN_PATH = `p/${PROJECT}/runs/${liveRun.id}`

const health = JSON.stringify({
  version: '0.11.0',
  projects: [
    { id: 'cezar-pwa', name: 'cezar-pwa' },
    { id: 'kai-phone', name: 'kai-phone' },
  ],
})

const planContext = JSON.stringify({
  contextEvents: [
    {
      seq: 0,
      ts: '2026-09-20T19:31:52.000Z',
      type: 'plan.updated',
      entries: [
        { content: 'Check the branch against main', status: 'completed' },
        { content: 'Commit what is left', status: 'in_progress', activeForm: 'Committing what is left' },
        { content: 'Open the pull request', status: 'pending' },
      ],
    },
  ],
  asOfSeq: 148,
})

/** Serves every read the task screen makes, and counts the read receipts. */
async function serveCezar(page: Page, run: Record<string, unknown> = liveRun) {
  const counts = { read: 0 }
  const json = (body: string) => ({ status: 200, contentType: 'application/json', body })
  await page.route('**/api/v1/health', (route) => route.fulfill(json(health)))
  await page.route('**/api/v1/workspace/runs-index', (route) => route.fulfill(json(runsIndex)))
  const base = `**/api/v1/p/${PROJECT}/runs/${liveRun.id}`
  await page.route(base, (route) => route.fulfill(json(JSON.stringify(run))))
  await page.route(`${base}/history`, (route) => route.fulfill(json(livePage)))
  await page.route(`${base}/history-context`, (route) => route.fulfill(json(planContext)))
  await page.route(`${base}/read`, (route) => {
    counts.read += 1
    return route.fulfill(json(JSON.stringify({ ...run, seenAt: new Date().toISOString() })))
  })
  return counts
}

// Playwright's WebKit does not route requests from a page a service worker controls.
test.use({ serviceWorkers: 'block' })

test.describe('Task screen', () => {
  test('a row opens the task: header, transcript, plan (FR-014, FR-015, FR-018)', async ({ page }) => {
    await serveCezar(page)
    await page.goto('.')

    await page.locator(`li[data-run-id="${liveRun.id}"] a`).click()
    await expect(page).toHaveURL(new RegExp(`/m/${RUN_PATH}$`))
    await expect(page.getByRole('heading', { level: 2, name: 'opening pull request' })).toBeVisible()
    await expect(page.getByText('claude · opus[1m]')).toBeVisible()
    await expect(page.getByRole('link', { name: 'PR #9' })).toHaveAttribute('target', '_blank')

    const plan = page.getByTestId('plan')
    await expect(plan).toContainText('1/3')
    await expect(plan).toContainText('Committing what is left')

    // The newest entry is what the screen opens on.
    await expect(page.getByText('Sesja zamknięta.')).toBeInViewport()
  })

  test('the plan stays pinned while the transcript scrolls', async ({ page }) => {
    await serveCezar(page)
    await page.goto(RUN_PATH)
    const plan = page.getByTestId('plan')
    await expect(plan).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2))
    await expect(plan).toBeInViewport()
    await plan.locator('summary').click()
    await expect(plan.getByRole('listitem')).toHaveCount(3)
  })

  test('a tool call is one line until tapped (FR-017)', async ({ page }) => {
    await serveCezar(page)
    await page.goto(RUN_PATH)
    const tool = page.locator('details[data-tool-id]').first()
    await expect(tool).not.toHaveAttribute('open', '')
    const summary = tool.locator('summary')
    const box = await summary.boundingBox()
    // One line, and a touch target.
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    expect(box?.height ?? 0).toBeLessThan(60)
    await summary.click()
    await expect(tool).toHaveAttribute('open', '')
    await expect(tool.getByText('Wejście')).toBeVisible()
  })

  test('fits the phone: no sideways scrolling at 390 px, even with a tool expanded', async ({ page }) => {
    await serveCezar(page)
    await page.goto(RUN_PATH)
    await page.locator('details[data-tool-id] summary').first().click()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('opening an unread task marks it read, once (FR-020)', async ({ page }) => {
    const counts = await serveCezar(page, { ...liveRun, seenAt: undefined })
    await page.goto(RUN_PATH)
    await expect(page.getByRole('heading', { level: 2, name: 'opening pull request' })).toBeVisible()
    await expect.poll(() => counts.read).toBe(1)
    await page.waitForTimeout(500)
    expect(counts.read).toBe(1)
  })

  test('a deep link survives a reload, and the back link returns to the list', async ({ page }) => {
    await serveCezar(page)
    await page.goto(RUN_PATH)
    await page.reload()
    await expect(page.getByRole('heading', { level: 2, name: 'opening pull request' })).toBeVisible()
    await page.getByRole('link', { name: 'Zadania' }).click()
    await expect(page).toHaveURL(/\/m\/$/)
    await expect(page.getByRole('heading', { level: 3 }).first()).toBeVisible()
  })

  test('a lapsed session lands on "Połącz z Cezarem", not on an error', async ({ page }) => {
    await page.route('**/api/v1/**', (route) =>
      route.fulfill({ status: 403, contentType: 'text/html', body: '<html>403</html>' }),
    )
    await page.goto(RUN_PATH)
    await expect(page.getByRole('heading', { name: 'Połącz z Cezarem' })).toBeVisible()
  })
})
