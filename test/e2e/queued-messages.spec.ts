import { readFileSync } from 'node:fs'
import { type Page, expect, test } from '@playwright/test'
import { en } from '../../apps/pwa/src/i18n/en.ts'

/**
 * #66 in mobile Safari: a message stacked onto a queued task is edited inline and removed behind
 * a confirmation, under a thumb, and a message the task already took reads as "already sent".
 */

const fixture = (name: string) =>
  readFileSync(new URL(`../../apps/pwa/test/fixtures/${name}`, import.meta.url), 'utf8')

const liveRun = JSON.parse(fixture('run.live-0.11.0.json')) as Record<string, unknown> & { id: string }
const PROJECT = 'cezar-pwa'
const RUN_PATH = `p/${PROJECT}/runs/${liveRun.id}`
const health = JSON.stringify({ version: '0.11.0', projects: [{ id: PROJECT, name: PROJECT }] })
const t = en.run.compose.queue

type Message = { id: string; text: string; createdAt: string }
const msg = (id: string, text: string): Message => ({ id, text, createdAt: '2026-09-24T08:00:00.000Z' })

/** Serves a queued task whose stack the writes change, as Cezar's would. */
async function serveCezar(page: Page, opts: { onRemove?: (id: string) => { status: number; body: unknown } } = {}) {
  const state = {
    stack: [msg('q1', 'Use pnpm, not npm.'), msg('q2', 'Leave the docs folder alone — it is generated.')],
    writes: [] as { method: string; id: string; body: unknown }[],
  }
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
  const run = () => ({ ...liveRun, status: 'queued', steps: [], queuedMessages: state.stack })
  await page.route('**/api/v1/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: health }))
  await page.route('**/api/v1/workspace/runs-index', (route) =>
    route.fulfill(json({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] })),
  )
  await page.route('**/api/v1/workspace/events', (route) => route.abort())
  const base = `**/api/v1/p/${PROJECT}/runs/${liveRun.id}`
  await page.route(base, (route) => route.fulfill(json(run())))
  await page.route(`${base}/events`, (route) => route.abort())
  await page.route(`${base}/history`, (route) =>
    route.fulfill(json({ events: [], itemCount: 0, liveCursor: 'live', asOfSeq: 0, hasOlder: false })),
  )
  await page.route(`${base}/history-context`, (route) => route.fulfill(json({ contextEvents: [], asOfSeq: 0 })))
  await page.route(`${base}/read`, (route) => route.fulfill(json(run())))
  await page.route(`${base}/queued-messages/*`, async (route) => {
    const request = route.request()
    const id = decodeURIComponent(new URL(request.url()).pathname.split('/').pop()!)
    const body = request.postData() ? (request.postDataJSON() as { text: string }) : undefined
    state.writes.push({ method: request.method(), id, body })
    if (request.method() === 'PATCH') {
      const message = { ...state.stack.find((m) => m.id === id)!, text: body!.text }
      state.stack = state.stack.map((m) => (m.id === id ? message : m))
      return route.fulfill(json({ message }))
    }
    const answer = opts.onRemove?.(id) ?? { status: 200, body: { removed: true } }
    if (answer.status === 200 || answer.status === 404) state.stack = state.stack.filter((m) => m.id !== id)
    return route.fulfill(json(answer.body, answer.status))
  })
  return state
}

const composer = (page: Page) => page.getByRole('form', { name: en.run.compose.label })
const item = (page: Page, text: string) => composer(page).getByRole('listitem').filter({ hasText: text })

async function openStack(page: Page, count: number) {
  await page.goto(RUN_PATH)
  await composer(page).getByText(en.run.compose.queuedTitle(count)).tap()
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

// Playwright's WebKit does not route requests from a page a service worker controls.
test.use({ serviceWorkers: 'block' })

test.describe('A queued message', () => {
  test('is edited inline, then removed after a confirmation', async ({ page }) => {
    const state = await serveCezar(page)
    await openStack(page, 2)

    const edit = item(page, 'Use pnpm').getByRole('button', { name: t.edit })
    expect((await edit.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    await edit.tap()
    await composer(page).getByRole('textbox', { name: t.editLabel }).fill('Use pnpm, and pin its version.')
    await composer(page).getByRole('button', { name: t.save }).tap()
    await expect(item(page, 'pin its version')).toBeVisible()
    await expect(composer(page).getByRole('textbox', { name: t.editLabel })).toHaveCount(0)

    await item(page, 'pin its version').getByRole('button', { name: t.remove }).tap()
    await expect(composer(page).getByText(t.confirmRemove)).toBeVisible()
    await item(page, 'pin its version').getByRole('button', { name: t.remove }).tap()
    await expect(item(page, 'pin its version')).toHaveCount(0)
    await expect(composer(page).getByText(en.run.compose.queuedTitle(1))).toBeVisible()

    expect(state.writes).toEqual([
      { method: 'PATCH', id: 'q1', body: { text: 'Use pnpm, and pin its version.' } },
      { method: 'DELETE', id: 'q1', body: undefined },
    ])
  })

  test.describe('at 390×844', () => {
    // 1× keeps the evidence screenshots small; layout does not depend on the pixel ratio.
    test.use({ deviceScaleFactor: 1 })

    for (const scheme of ['light', 'dark'] as const) {
      test(`fits in the ${scheme} theme, and an already-sent message is not a failure`, async ({ page }) => {
        await serveCezar(page, { onRemove: () => ({ status: 404, body: { error: 'not found' } }) })
        await page.emulateMedia({ colorScheme: scheme })
        await page.setViewportSize({ width: 390, height: 844 })
        await openStack(page, 2)
        const evidence = process.env.E2E_EVIDENCE_DIR

        await expect(item(page, 'Use pnpm').getByRole('button', { name: t.edit })).toBeVisible()
        await noSidewaysScroll(page)
        if (evidence) await page.screenshot({ path: `${evidence}/stack-${scheme}.png` })

        await item(page, 'Use pnpm').getByRole('button', { name: t.edit }).tap()
        await composer(page).getByRole('textbox', { name: t.editLabel }).fill('Use pnpm, and pin its version.')
        await noSidewaysScroll(page)
        if (evidence) await page.screenshot({ path: `${evidence}/edit-${scheme}.png` })
        await composer(page).getByRole('button', { name: t.cancel }).tap()

        await item(page, 'Leave the docs').getByRole('button', { name: t.remove }).tap()
        await expect(composer(page).getByText(t.confirmRemove)).toBeVisible()
        await noSidewaysScroll(page)
        if (evidence) await page.screenshot({ path: `${evidence}/confirm-remove-${scheme}.png` })

        await item(page, 'Leave the docs').getByRole('button', { name: t.remove }).tap()
        await expect(composer(page).getByRole('status')).toHaveText(t.alreadySent)
        await expect(composer(page).getByRole('alert')).toHaveCount(0)
        await expect(item(page, 'Leave the docs')).toHaveCount(0)
        await noSidewaysScroll(page)
        if (evidence) await page.screenshot({ path: `${evidence}/already-sent-${scheme}.png` })
      })
    }
  })
})
