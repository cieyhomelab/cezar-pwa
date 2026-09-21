import { readFileSync } from 'node:fs'
import { type Page, expect, test } from '@playwright/test'

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

/** Serves both endpoints and counts how often the list was asked for. */
async function serveCezar(page: Page) {
  const counts = { runsIndex: 0 }
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

    await expect(page.getByRole('heading', { name: '3 zadania wymagają uwagi' })).toBeVisible({
      timeout: 3_000,
    })
    await expect(page.getByRole('heading', { level: 3 })).toHaveText([
      'Wymaga uwagi (3)',
      'W toku (2)',
      'W kolejce (3)',
      'Zakończone (3)',
    ])
    // Archived work stays out of the list.
    await expect(page.getByText('An archived task nobody will touch again')).toHaveCount(0)
  })

  test('fits the phone: no sideways scrolling at 390 px', async ({ page }) => {
    await serveCezar(page)
    await page.goto('.')
    await expect(page.getByRole('heading', { name: /wymagają uwagi/ })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('the project filter narrows the list and survives a restart (FR-013)', async ({ page }) => {
    await serveCezar(page)
    await page.goto('.')

    await page.getByRole('combobox', { name: 'Projekt' }).selectOption('kai-phone')
    await expect(page.getByRole('heading', { name: 'Wymaga uwagi (1)' })).toBeVisible()
    await expect(page.getByText('2 w innych projektach')).toBeVisible()

    await page.reload()
    await expect(page.getByRole('combobox', { name: 'Projekt' })).toHaveValue('kai-phone')
    await expect(page.getByRole('heading', { name: 'Wymaga uwagi (1)' })).toBeVisible()
  })

  test('refreshes on request and on return to the foreground (FR-011)', async ({ page }) => {
    const counts = await serveCezar(page)
    await page.goto('.')
    await expect(page.getByRole('heading', { name: /wymagają uwagi/ })).toBeVisible()

    const before = counts.runsIndex
    await page.getByRole('button', { name: 'Odśwież' }).click()
    await expect.poll(() => counts.runsIndex).toBe(before + 1)

    // What iOS fires when the operator comes back to a frozen app. The real event bubbles
    // (HTML: "fire an event named visibilitychange at the Document, with bubbles true"), and
    // TanStack's focus manager listens for it on window.
    await page.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true })),
    )
    await expect.poll(() => counts.runsIndex).toBeGreaterThan(before + 1)
  })

  test('a lapsed session sends the operator to "Połącz z Cezarem", not to a broken list', async ({
    page,
  }) => {
    let authorized = true
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
    await expect(page.getByRole('heading', { name: /wymagają uwagi/ })).toBeVisible()

    authorized = false
    await page.getByRole('button', { name: 'Odśwież' }).click()

    await expect(page.getByRole('heading', { name: 'Połącz z Cezarem' })).toBeVisible()
  })
})
