import { readFileSync } from 'node:fs'
import { type Page, expect, test } from '@playwright/test'
import { en } from '../../apps/pwa/src/i18n/en.ts'

/**
 * S-20 acceptance in mobile Safari (#70): from the list, open a project's automations, pause one,
 * and run one now behind a confirmation. Nothing reaches an instance: the answers are the
 * hand-written fixtures the contract test pins.
 */

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../apps/pwa/test/fixtures/${name}`, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >

const automations = fixture('automations.json')
const automationLog = fixture('automation-log.json')
const PROJECT = 'cezar-pwa'
const health = {
  version: '0.11.1',
  projects: [{ id: PROJECT, name: PROJECT }],
  bootProject: PROJECT,
  capabilities: { automations: true },
  checks: [],
}
const t = en.automations

async function serveCezar(page: Page, run: () => { status: number; body: unknown }) {
  const posts: string[] = []
  const json = (body: unknown, code = 200) => ({ status: code, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/v1/health', (route) => route.fulfill(json(health)))
  await page.route('**/api/v1/workspace/runs-index', (route) =>
    route.fulfill(json({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] })),
  )
  await page.route('**/api/v1/workspace/events', (route) => route.abort())
  await page.route(`**/api/v1/p/${PROJECT}/automations`, (route) => route.fulfill(json(automations)))
  await page.route(`**/api/v1/p/${PROJECT}/automation-log`, (route) => route.fulfill(json(automationLog)))
  await page.route(`**/api/v1/p/${PROJECT}/automations/*/*`, (route) => {
    const path = new URL(route.request().url()).pathname
    posts.push(path)
    if (path.endsWith('/run')) {
      const answer = run()
      return route.fulfill(json(answer.body, answer.status))
    }
    return route.fulfill(json({ automation: (automations.automations as unknown[])[0] }))
  })
  return posts
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

const row = (page: Page, name: string) => page.getByRole('listitem').filter({ has: page.getByRole('heading', { name }) })

// Playwright's WebKit does not route requests from a page a service worker controls.
test.use({ serviceWorkers: 'block' })

test('from the list, pause an automation and run one now behind a confirmation', async ({ page }) => {
  const posts = await serveCezar(page, () => ({ status: 202, body: { runId: 'run-new-7' } }))
  await page.goto('')

  const open = page.getByRole('link', { name: t.open })
  expect((await open.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  await open.tap()
  await expect(page).toHaveURL(/\/m\/automations/)

  const nightly = row(page, 'Nightly dependency check')
  await expect(page.getByRole('note')).toContainText('GitHub availability is still being checked')

  const pause = nightly.getByRole('button', { name: t.pause })
  expect((await pause.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  await pause.tap()
  await expect(nightly.getByRole('status')).toHaveText(t.done.paused('Nightly dependency check'))

  await nightly.getByRole('button', { name: t.runNow }).tap()
  await expect(nightly.getByRole('alertdialog')).toBeVisible()
  expect(posts.filter((path) => path.endsWith('/run'))).toEqual([])
  await nightly.getByRole('alertdialog').getByRole('button', { name: t.confirmRun.confirm }).tap()

  await expect(nightly.getByRole('link', { name: t.done.openTask })).toHaveAttribute('href', `/m/p/${PROJECT}/runs/run-new-7`)
  expect(posts).toEqual([
    `/api/v1/p/${PROJECT}/automations/nightly-deps/pause`,
    `/api/v1/p/${PROJECT}/automations/nightly-deps/run`,
  ])
  await noSidewaysScroll(page)
})

test.describe('at 390×844', () => {
  // 1× keeps the evidence screenshots small; layout does not depend on the pixel ratio.
  test.use({ deviceScaleFactor: 1 })

  for (const scheme of ['light', 'dark'] as const) {
    test(`the automations fit 390×844 in the ${scheme} theme`, async ({ page }) => {
      await serveCezar(page, () => ({ status: 409, body: { error: 'this instant was already launched' } }))
      await page.emulateMedia({ colorScheme: scheme })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`automations?project=${PROJECT}`)
      await expect(page.getByRole('heading', { name: 'Nightly dependency check' })).toBeVisible()
      await expect(page.getByRole('region', { name: t.log.title }).getByRole('listitem')).toHaveCount(3)
      await noSidewaysScroll(page)
      const evidence = process.env.E2E_EVIDENCE_DIR
      if (evidence) await page.screenshot({ path: `${evidence}/automations-${scheme}.png`, fullPage: true })

      const nightly = row(page, 'Nightly dependency check')
      await nightly.getByRole('button', { name: t.runNow }).tap()
      await expect(nightly.getByRole('alertdialog')).toBeVisible()
      await noSidewaysScroll(page)
      if (evidence) await page.screenshot({ path: `${evidence}/confirm-run-${scheme}.png` })

      await nightly.getByRole('alertdialog').getByRole('button', { name: t.confirmRun.confirm }).tap()
      await expect(nightly.getByRole('alert')).toHaveText(en.run.actions.failed.refused('this instant was already launched'))
      if (evidence) await page.screenshot({ path: `${evidence}/refused-${scheme}.png` })
    })
  }
})
