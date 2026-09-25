import { type Page, expect, test } from '@playwright/test'
import { en } from '../../apps/pwa/src/i18n/en.ts'

/**
 * #93 acceptance in mobile Safari: from the list header, open the Limits screen; every account the
 * sidecar returns shows its windows with the percentage in text, the reset countdown and the
 * reading's age; a missing window says "not reported", a stale reading says so, a switched-off or
 * failed provider shows its reason. Cezar and the sidecar are stubbed at the network.
 */

const PROJECT = 'cezar-pwa'
const t = en.limits
const MIN = 60_000

function limits() {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
  const ahead = (ms: number) => new Date(Date.now() + ms).toISOString()
  return {
    observedAt: ago(MIN),
    providers: [
      {
        provider: 'claude',
        account: 'default',
        status: 'ok',
        observedAt: ago(2 * MIN + 30_000),
        windows: [
          { kind: 'five_hour', usedPercent: 42, resetsAt: ahead(134 * MIN + 30_000) },
          { kind: 'weekly', usedPercent: 76, resetsAt: ahead(26 * 60 * MIN + 30_000) },
          { kind: 'weekly_model', model: 'opus', usedPercent: 93, resetsAt: ahead(26 * 60 * MIN + 30_000) },
        ],
      },
      {
        provider: 'claude',
        account: 'work',
        status: 'unavailable',
        reason: 'off in the sidecar config (LIMITS_CLAUDE)',
        observedAt: ago(MIN),
        windows: [],
      },
      {
        provider: 'codex',
        account: 'default',
        status: 'ok',
        observedAt: ago(20 * MIN + 30_000),
        windows: [{ kind: 'weekly', usedPercent: 12, resetsAt: ahead(3 * 24 * 60 * MIN + 30 * MIN) }],
      },
      {
        provider: 'codex',
        account: 'spare',
        status: 'unavailable',
        reason: 'codex not installed',
        observedAt: ago(MIN),
        windows: [],
      },
    ],
  }
}

async function serve(page: Page) {
  const reads: string[] = []
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/v1/health', (route) =>
    route.fulfill(json({ version: '0.11.1', projects: [{ id: PROJECT, name: PROJECT }], bootProject: PROJECT, checks: [] })),
  )
  await page.route('**/api/v1/workspace/runs-index', (route) =>
    route.fulfill(json({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] })),
  )
  await page.route('**/api/v1/workspace/events', (route) => route.abort())
  // On the pathname: a glob like `**/m/push/**` would also catch the app's own source files.
  await page.route(
    (url) => url.pathname.startsWith('/m/push/'),
    (route) => {
      const path = new URL(route.request().url()).pathname
      reads.push(path)
      return path === '/m/push/limits' ? route.fulfill(json(limits())) : route.fulfill(json({ error: 'not found' }, 404))
    },
  )
  return reads
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

const card = (page: Page, provider: string, account: string) =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: provider, exact: true }) })
    .filter({ hasText: t.account(account) })

// Playwright's WebKit does not route requests from a page a service worker controls.
test.use({ serviceWorkers: 'block' })

test('from the list header, read every account’s windows', async ({ page }) => {
  const reads = await serve(page)
  await page.goto('')

  const open = page.getByRole('link', { name: t.open, exact: true })
  expect((await open.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  await open.tap()
  await expect(page).toHaveURL(/\/m\/limits$/)

  const claude = card(page, 'Claude', 'default')
  await expect(claude.getByRole('meter', { name: t.window.five_hour })).toHaveAttribute('aria-valuenow', '42')
  await expect(claude.getByText(t.used(42))).toBeVisible()
  await expect(claude.getByText(t.resetsIn('2h 14m'))).toBeVisible()
  await expect(claude.getByText(t.read(en.age.minutes(2)))).toBeVisible()
  await expect(claude.getByRole('meter', { name: 'Weekly · Opus' })).toHaveAttribute('aria-valuenow', '93')

  const codex = card(page, 'Codex', 'default')
  await expect(codex.getByText(t.notReported)).toBeVisible()
  await expect(codex.getByText(t.stale, { exact: true })).toBeVisible()

  await expect(card(page, 'Claude', 'work').getByText(t.off, { exact: true })).toBeVisible()
  await expect(card(page, 'Codex', 'spare').getByText('codex not installed')).toBeVisible()

  // Read on open; nothing polls while the screen stays up.
  await page.waitForTimeout(1500)
  expect(reads).toEqual(['/m/push/limits'])
  await noSidewaysScroll(page)
})

test.describe('at 390×844', () => {
  // 1× keeps the evidence screenshots small; layout does not depend on the pixel ratio.
  test.use({ deviceScaleFactor: 1 })

  for (const scheme of ['light', 'dark'] as const) {
    test(`the limits fit 390×844 in the ${scheme} theme`, async ({ page }) => {
      await serve(page)
      await page.emulateMedia({ colorScheme: scheme })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('limits')
      await expect(page.getByRole('heading', { name: t.title })).toBeVisible()
      await expect(page.getByRole('list', { name: t.title }).getByRole('meter')).toHaveCount(4)
      await noSidewaysScroll(page)
      const evidence = process.env.E2E_EVIDENCE_DIR
      if (evidence) await page.screenshot({ path: `${evidence}/limits-${scheme}.png`, fullPage: true })
    })
  }
})
