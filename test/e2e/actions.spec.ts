import { readFileSync } from 'node:fs'
import { type Page, expect, test } from '@playwright/test'

/**
 * S-08 acceptance in mobile Safari: the operator acts on a task under a thumb. Cancel sits behind
 * a confirmation (FR-025), a review is accepted (FR-026), a draft PR is opened or refused with the
 * forge's reason (FR-027, FR-032), and a task is archived (FR-029).
 *
 * The record is the live capture with its status changed. Nothing is written to the instance:
 * every action reaches a real agent or a real forge.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`../../apps/pwa/test/fixtures/${name}`, import.meta.url), 'utf8')

const liveRun = JSON.parse(fixture('run.live-0.11.0.json')) as Record<string, unknown> & { id: string }
const PROJECT = 'cezar-pwa'
const RUN_PATH = `p/${PROJECT}/runs/${liveRun.id}`
const health = JSON.stringify({ version: '0.11.0', projects: [{ id: PROJECT, name: PROJECT }] })
const steps = [{ id: 'task', name: 'Do the task', kind: 'agent', status: 'done', iterations: 1, tokensUsed: 1, sessionId: 's-1' }]

type Reply = { status: number; body: unknown }

/** Serves the task screen with a mutable record. `writes` answers each action by name. */
async function serveCezar(page: Page, status: string, writes: Record<string, (state: { run: Record<string, unknown> }) => Reply>) {
  const state = { run: { ...liveRun, status, steps, currentStepId: 'task', pullRequestUrl: undefined } as Record<string, unknown> }
  const log: string[] = []
  const json = (body: unknown, code = 200) => ({ status: code, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/v1/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: health }))
  await page.route('**/api/v1/workspace/runs-index', (route) =>
    route.fulfill(json({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] })),
  )
  await page.route('**/api/v1/workspace/events', (route) => route.abort())
  const base = `**/api/v1/p/${PROJECT}/runs/${liveRun.id}`
  await page.route(`${base}/events*`, (route) => route.abort())
  await page.route(base, (route) => route.fulfill(json(state.run)))
  await page.route(`${base}/history`, (route) =>
    route.fulfill(json({ events: [], itemCount: 0, liveCursor: 'live', asOfSeq: 0, hasOlder: false })),
  )
  await page.route(`${base}/history-context`, (route) => route.fulfill(json({ contextEvents: [], asOfSeq: 0 })))
  await page.route(`${base}/read`, (route) => route.fulfill(json(state.run)))
  for (const [action, reply] of Object.entries(writes)) {
    await page.route(`${base}/${action}`, (route) => {
      log.push(action)
      const answer = reply(state)
      return route.fulfill(json(answer.body, answer.status))
    })
  }
  return log
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

// Playwright's WebKit does not route requests from a page a service worker controls.
test.use({ serviceWorkers: 'block' })

test('cancel asks first, then stops the task (FR-025)', async ({ page }) => {
  const log = await serveCezar(page, 'running', {
    cancel: (state) => {
      state.run = { ...state.run, status: 'cancelled' }
      return { status: 200, body: { cancelled: true } }
    },
  })
  await page.goto(RUN_PATH)

  const cancel = page.getByRole('button', { name: 'Anuluj', exact: true })
  const box = await cancel.boundingBox()
  expect(box?.height).toBeGreaterThanOrEqual(44)
  await cancel.tap()

  const dialog = page.getByRole('alertdialog', { name: 'Anulować to zadanie?' })
  await expect(dialog).toBeVisible()
  expect(log).toEqual([])
  await dialog.getByRole('button', { name: 'Anuluj zadanie' }).tap()

  await expect(page.getByText('Zadanie anulowane.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Kontynuuj' })).toBeVisible()
  expect(log).toEqual(['cancel'])
  await noSidewaysScroll(page)
})

test('a review is accepted in one tap (FR-026)', async ({ page }) => {
  const log = await serveCezar(page, 'review', {
    finish: (state) => {
      state.run = { ...state.run, status: 'done' }
      return { status: 200, body: { finished: true } }
    },
  })
  await page.goto(RUN_PATH)
  await noSidewaysScroll(page)
  await page.getByRole('button', { name: 'Akceptuj' }).tap()
  await expect(page.getByText('Zmiany zaakceptowane, zadanie zakończone.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Akceptuj' })).toHaveCount(0)
  expect(log).toEqual(['finish'])
})

test("a refused draft PR shows the forge's reason (FR-027, FR-032)", async ({ page }) => {
  await serveCezar(page, 'review', {
    pr: () => ({ status: 409, body: { error: 'gh: not logged in', manual: 'git merge cez/12d1b71c' } }),
  })
  await page.goto(RUN_PATH)
  await page.getByRole('button', { name: 'Otwórz draft PR' }).tap()
  await expect(page.getByRole('alert')).toHaveText('Cezar odmówił: gh: not logged in')
  await expect(page.getByRole('button', { name: 'Otwórz draft PR' })).toBeEnabled()
})

test('archive marks the task and can be undone (FR-029)', async ({ page }) => {
  const log = await serveCezar(page, 'done', {
    archive: (state) => {
      state.run = { ...state.run, archived: !state.run.archived }
      return { status: 200, body: state.run }
    },
  })
  await page.goto(RUN_PATH)
  await page.getByRole('button', { name: 'Archiwizuj' }).tap()
  await expect(page.getByText('Zarchiwizowane', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Przywróć z archiwum' }).tap()
  await expect(page.getByRole('button', { name: 'Archiwizuj' })).toBeVisible()
  expect(log).toEqual(['archive', 'archive'])
})
