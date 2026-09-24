import { readFileSync } from 'node:fs'
import { type Page, expect, test } from '@playwright/test'
import { en } from '../../apps/pwa/src/i18n/en.ts'

/**
 * S-08 acceptance in mobile Safari: the operator acts on a task under a thumb. Cancel sits behind
 * a confirmation (FR-025), a review is accepted (FR-026), a draft PR is opened or refused with the
 * forge's reason (FR-027, FR-032), a task is archived (FR-029), and a booked auto-resume is
 * cancelled behind a confirmation (FR-030).
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
async function serveCezar(
  page: Page,
  status: string,
  writes: Record<string, (state: { run: Record<string, unknown> }) => Reply>,
  extra: Record<string, unknown> = {},
) {
  const state = {
    run: { ...liveRun, status, steps, currentStepId: 'task', pullRequestUrl: undefined, ...extra } as Record<string, unknown>,
  }
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
      log.push(`${route.request().method()} ${action}`)
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

  const cancel = page.getByRole('button', { name: en.run.actions.cancel, exact: true })
  const box = await cancel.boundingBox()
  expect(box?.height).toBeGreaterThanOrEqual(44)
  await cancel.tap()

  const dialog = page.getByRole('alertdialog', { name: en.run.actions.confirmCancel.title })
  await expect(dialog).toBeVisible()
  expect(log).toEqual([])
  await dialog.getByRole('button', { name: en.run.actions.confirmCancel.confirm }).tap()

  await expect(page.getByText(en.run.actions.done.cancel)).toBeVisible()
  await expect(page.getByRole('button', { name: en.run.actions.continue })).toBeVisible()
  expect(log).toEqual(['POST cancel'])
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
  await page.getByRole('button', { name: en.run.actions.finish.review }).tap()
  await expect(page.getByText(en.run.actions.done.accepted)).toBeVisible()
  await expect(page.getByRole('button', { name: en.run.actions.finish.review })).toHaveCount(0)
  expect(log).toEqual(['POST finish'])
})

test("a refused draft PR shows the forge's reason (FR-027, FR-032)", async ({ page }) => {
  await serveCezar(page, 'review', {
    pr: () => ({ status: 409, body: { error: 'gh: not logged in', manual: 'git merge cez/12d1b71c' } }),
  })
  await page.goto(RUN_PATH)
  await page.getByRole('button', { name: en.run.actions.draftPr }).tap()
  await expect(page.getByRole('alert')).toHaveText(en.run.actions.failed.refused('gh: not logged in'))
  await expect(page.getByRole('button', { name: en.run.actions.draftPr })).toBeEnabled()
})

test('archive marks the task and can be undone (FR-029)', async ({ page }) => {
  const log = await serveCezar(page, 'done', {
    archive: (state) => {
      state.run = { ...state.run, archived: !state.run.archived }
      return { status: 200, body: state.run }
    },
  })
  await page.goto(RUN_PATH)
  await page.getByRole('button', { name: en.run.actions.archive }).tap()
  await expect(page.getByText(en.run.actions.archivedBadge, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: en.run.actions.unarchive }).tap()
  await expect(page.getByRole('button', { name: en.run.actions.archive })).toBeVisible()
  expect(log).toEqual(['POST archive', 'POST archive'])
})

test('a booked auto-resume is cancelled behind a confirmation (FR-030)', async ({ page }) => {
  const t = en.run.actions
  const log = await serveCezar(
    page,
    'failed',
    {
      'auto-resume': (state) => {
        const { autoResumeAt: _cancelled, ...plain } = state.run
        state.run = plain
        return { status: 200, body: { cancelled: true } }
      },
    },
    { autoResumeAt: '2099-01-01T12:00:00.000Z' },
  )
  await page.goto(RUN_PATH)

  const cancel = page.getByRole('button', { name: t.cancelAutoResume, exact: true })
  const box = await cancel.boundingBox()
  expect(box?.height).toBeGreaterThanOrEqual(44)
  await cancel.tap()

  const dialog = page.getByRole('alertdialog', { name: t.confirmCancelAutoResume.title })
  await expect(dialog).toBeVisible()
  await noSidewaysScroll(page)
  expect(log).toEqual([])
  await dialog.getByRole('button', { name: t.confirmCancelAutoResume.confirm }).tap()

  await expect(page.getByText(t.done.cancelAutoResume)).toBeVisible()
  await expect(page.getByRole('button', { name: t.cancelAutoResume })).toHaveCount(0)
  await expect(page.getByRole('button', { name: t.continue })).toBeVisible()
  expect(log).toEqual(['DELETE auto-resume'])
})
