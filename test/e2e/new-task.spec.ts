import { readFileSync } from 'node:fs'
import { type Page, expect, test } from '@playwright/test'
import { en } from '../../apps/pwa/src/i18n/en.ts'

/**
 * S-13 acceptance in mobile Safari: from the list, start a task (FR-033) and land on it
 * (FR-034); a refusal shows Cezar's words and keeps the description (FR-032).
 *
 * Nothing reaches an instance: the create is answered here with the live record's shape.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`../../apps/pwa/test/fixtures/${name}`, import.meta.url), 'utf8')

const liveRun = JSON.parse(fixture('run.live-0.11.0.json')) as Record<string, unknown> & { id: string }
const PROJECT = 'cezar-pwa'
const health = {
  version: '0.11.0',
  projects: [
    { id: 'kai-phone', name: 'kai-phone' },
    { id: PROJECT, name: PROJECT },
  ],
  bootProject: 'kai-phone',
  defaultRunner: 'claude',
  checks: [
    { name: 'claude', available: true },
    { name: 'codex', available: false },
  ],
}
const workflows = {
  workflows: [
    { name: 'Ciey-issue-fix', steps: [], source: 'file' },
    { name: 'quick-task', description: 'One agent run on your task — no ceremony.', steps: [], source: 'built-in' },
  ],
  issues: [],
}
const models = {
  runner: 'claude',
  models: [
    { id: 'opus[1m]', label: 'Opus (1M context)', description: '' },
    { id: 'sonnet', label: 'Sonnet', description: '' },
  ],
  source: 'cache',
  stale: false,
}

type Reply = { status: number; body: unknown }

async function serveCezar(page: Page, create: (body: Record<string, unknown>) => Reply) {
  const creates: { project: string; body: Record<string, unknown> }[] = []
  const json = (body: unknown, code = 200) => ({ status: code, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/v1/health', (route) => route.fulfill(json(health)))
  await page.route('**/api/v1/workspace/runs-index', (route) =>
    route.fulfill(json({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] })),
  )
  await page.route('**/api/v1/workspace/events', (route) => route.abort())
  await page.route('**/api/v1/workspace/agent-profiles', (route) =>
    route.fulfill(json({ editable: false, profiles: [], profileCapableProviders: [], selections: {}, defaults: {} })),
  )
  await page.route('**/api/v1/models?runner=*', (route) => route.fulfill(json(models)))
  await page.route('**/api/v1/p/*/workflows', (route) => route.fulfill(json(workflows)))
  await page.route('**/api/v1/p/*/config', (route) =>
    route.fulfill(json({ defaultRunner: 'claude', defaultModels: {}, modelsLocked: false })),
  )
  await page.route('**/api/v1/p/*/runs', (route) => {
    const project = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[4]!)
    const body = route.request().postDataJSON() as Record<string, unknown>
    creates.push({ project, body })
    const answer = create(body)
    return route.fulfill(json(answer.body, answer.status))
  })
  const base = `**/api/v1/p/${PROJECT}/runs/${liveRun.id}`
  await page.route(`${base}/events*`, (route) => route.abort())
  await page.route(base, (route) => route.fulfill(json({ ...liveRun, status: 'queued', task: creates.at(-1)?.body.task })))
  await page.route(`${base}/history`, (route) =>
    route.fulfill(json({ events: [], itemCount: 0, liveCursor: 'live', asOfSeq: 0, hasOlder: false })),
  )
  await page.route(`${base}/history-context`, (route) => route.fulfill(json({ contextEvents: [], asOfSeq: 0 })))
  await page.route(`${base}/read`, (route) => route.fulfill(json(liveRun)))
  return creates
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

// Playwright's WebKit does not route requests from a page a service worker controls.
test.use({ serviceWorkers: 'block' })

test('from the list, a new task is created and opened (FR-033, FR-034)', async ({ page }) => {
  const creates = await serveCezar(page, () => ({ status: 201, body: { ...liveRun, status: 'queued' } }))
  await page.goto('')

  const start = page.getByRole('link', { name: en.runs.newTask })
  expect((await start.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  await start.tap()

  await expect(page.getByLabel(en.newTask.workflow, { exact: true })).toHaveValue('quick-task')
  await page.getByLabel(en.newTask.project, { exact: true }).selectOption(PROJECT)
  await page.getByLabel(en.newTask.task, { exact: true }).fill('Fix the flaky test on the list screen')
  await page.getByLabel(en.newTask.model, { exact: true }).selectOption('sonnet')
  await page.getByRole('switch').tap()
  await noSidewaysScroll(page)

  const submit = page.getByRole('button', { name: en.newTask.submit })
  expect((await submit.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  await submit.tap()

  await expect(page).toHaveURL(new RegExp(`/m/p/${PROJECT}/runs/${liveRun.id}$`))
  expect(creates).toEqual([
    {
      project: PROJECT,
      body: {
        task: 'Fix the flaky test on the list screen',
        workflow: 'quick-task',
        runner: 'claude',
        model: 'sonnet',
        autonomous: true,
      },
    },
  ])

  // Back goes to the list, not to a form that already sent.
  await page.goBack()
  await expect(page.getByRole('link', { name: en.runs.newTask })).toBeVisible()
})

test("a refusal shows Cezar's reason and keeps the description (FR-032)", async ({ page }) => {
  await serveCezar(page, () => ({ status: 400, body: { error: 'unknown workflow: Ciey-issue-fix' } }))
  await page.goto('new')
  await page.getByLabel(en.newTask.task, { exact: true }).fill('Every word of this stays')
  await page.getByLabel(en.newTask.workflow, { exact: true }).selectOption('Ciey-issue-fix')
  await page.getByRole('button', { name: en.newTask.submit }).tap()

  await expect(page.getByRole('alert')).toHaveText(en.newTask.failed.refused('unknown workflow: Ciey-issue-fix'))
  await expect(page.getByLabel(en.newTask.task, { exact: true })).toHaveValue('Every word of this stays')
  await expect(page.getByRole('button', { name: en.newTask.submit })).toBeEnabled()
  await expect(page).toHaveURL(/\/m\/new$/)
})

test.describe('at 390×844', () => {
  // 1× keeps the evidence screenshots small; layout does not depend on the pixel ratio.
  test.use({ deviceScaleFactor: 1 })

  for (const scheme of ['light', 'dark'] as const) {
    test(`the form fits 390×844 in the ${scheme} theme`, async ({ page }) => {
      await serveCezar(page, () => ({ status: 400, body: { error: 'unknown workflow: nope' } }))
      await page.emulateMedia({ colorScheme: scheme })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('new')
      await page.getByLabel(en.newTask.task, { exact: true }).fill('Fix the flaky test on the list screen')
      await page.getByRole('button', { name: en.newTask.submit }).tap()
      await expect(page.getByRole('alert')).toBeVisible()
      await noSidewaysScroll(page)
      if (process.env.E2E_EVIDENCE_DIR) {
        await page.screenshot({ path: `${process.env.E2E_EVIDENCE_DIR}/new-task-${scheme}.png`, fullPage: true })
      }
    })
  }
})
