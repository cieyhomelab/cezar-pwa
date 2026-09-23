import { readFileSync } from 'node:fs'
import { type Page, expect, test } from '@playwright/test'
import { en } from '../../apps/pwa/src/i18n/en.ts'

/**
 * S-07 acceptance in mobile Safari: the operator answers the agent's question under a thumb
 * (FR-022) and messages a running task (FR-023), and every send says it is in flight and, on
 * failure, why (FR-032).
 *
 * The record is the live capture with its status changed. The transcript is hand-written: no
 * live run held an open question.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`../../apps/pwa/test/fixtures/${name}`, import.meta.url), 'utf8')

const liveRun = JSON.parse(fixture('run.live-0.11.0.json')) as Record<string, unknown> & { id: string }
const PROJECT = 'cezar-pwa'
const RUN_PATH = `p/${PROJECT}/runs/${liveRun.id}`
const health = JSON.stringify({ version: '0.11.0', projects: [{ id: PROJECT, name: PROJECT }] })

const steps = [{ id: 'task', name: 'Do the task', kind: 'agent', status: 'running', iterations: 1, tokensUsed: 1, sessionId: 's-1' }]
const ev = (seq: number, type: string, fields: Record<string, unknown> = {}) => ({
  seq,
  ts: `2026-09-21T08:00:${String(seq).padStart(2, '0')}.000Z`,
  type,
  stepId: 'task',
  ...fields,
})
const opening = [
  ev(1, 'turn.started', { turnId: 't1' }),
  ev(2, 'item.completed', {
    item: { kind: 'message', id: 'm1', role: 'assistant', text: 'The tests pass. Before I open the pull request:' },
  }),
]
const question = ev(3, 'ask.requested', {
  requestId: 'ask-1',
  questions: [
    {
      header: 'Target',
      question: 'Which branch should the pull request target?',
      options: [
        { label: 'main', description: 'Ship it with the next deploy' },
        { label: 'release/0.2', description: 'Hold it for the next release branch' },
      ],
    },
  ],
})
const page_ = (events: unknown[]) => JSON.stringify({ events, itemCount: events.length, liveCursor: 'live', asOfSeq: 99, hasOlder: false })

type Writes = { messages: unknown[] }

/** Serves the task screen. `history` is re-read on every fetch, so a test can move it on. */
async function serveCezar(
  page: Page,
  opts: { status: string; history: () => unknown[]; onMessage?: (body: { text: string }) => { status: number; body: unknown } },
): Promise<Writes> {
  const writes: Writes = { messages: [] }
  const json = (body: string, status = 200) => ({ status, contentType: 'application/json', body })
  const run = JSON.stringify({ ...liveRun, status: opts.status, steps, currentStepId: 'task' })
  await page.route('**/api/v1/health', (route) => route.fulfill(json(health)))
  await page.route('**/api/v1/workspace/runs-index', (route) =>
    route.fulfill(json(JSON.stringify({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] }))),
  )
  await page.route('**/api/v1/workspace/events', (route) => route.abort())
  const base = `**/api/v1/p/${PROJECT}/runs/${liveRun.id}`
  await page.route(base, (route) => route.fulfill(json(run)))
  await page.route(`${base}/history`, (route) => route.fulfill(json(page_(opts.history()))))
  await page.route(`${base}/history-context`, (route) => route.fulfill(json(JSON.stringify({ contextEvents: [], asOfSeq: 0 }))))
  await page.route(`${base}/read`, (route) => route.fulfill(json(run)))
  await page.route(`${base}/messages`, async (route) => {
    const body = route.request().postDataJSON() as { text: string }
    writes.messages.push(body)
    const answer = opts.onMessage?.(body) ?? { status: 200, body: { delivered: true } }
    return route.fulfill(json(JSON.stringify(answer.body), answer.status))
  })
  return writes
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

// Playwright's WebKit does not route requests from a page a service worker controls.
test.use({ serviceWorkers: 'block' })

test.describe('Answering the agent', () => {
  test('one tap answers the question, and the card resolves (FR-022)', async ({ page }) => {
    const history = [...opening, question]
    const writes = await serveCezar(page, {
      status: 'waiting',
      history: () => history,
      onMessage: (body) => {
        history.push(ev(4, 'user-message', { text: body.text }))
        return { status: 200, body: { delivered: true } }
      },
    })
    await page.goto(RUN_PATH)

    const option = page.getByRole('button', { name: /release\/0\.2/ })
    await expect(option).toBeVisible()
    const box = await option.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(44)
    await noSidewaysScroll(page)

    await option.tap()
    await expect(page.getByText(en.run.transcript.ask.answered('Target: release/0.2'))).toBeVisible()
    expect(writes.messages).toEqual([{ text: 'Target: release/0.2' }])
    await expect(page.getByRole('button', { name: /release\/0\.2/ })).toHaveCount(0)
  })

  test("a refusal shows Cezar's own reason and the options stay usable (FR-032)", async ({ page }) => {
    await serveCezar(page, {
      status: 'waiting',
      history: () => [...opening, question],
      onMessage: () => ({ status: 409, body: { error: 'provider claude is not connected' } }),
    })
    // No session to fall back to: the refusal is the answer.
    await page.route(`**/api/v1/p/${PROJECT}/runs/${liveRun.id}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...liveRun, status: 'waiting', steps: [{ ...steps[0], sessionId: undefined }] }),
      }),
    )
    await page.goto(RUN_PATH)
    await page.getByRole('button', { name: /^main/ }).tap()
    await expect(page.getByRole('alert')).toHaveText(en.run.compose.failed.refused('provider claude is not connected'))
    await expect(page.getByRole('button', { name: /^main/ })).toBeEnabled()
  })
})

test.describe('Messaging a task', () => {
  test('the composer stays under the thumb, does not zoom, and sends (FR-023)', async ({ page }) => {
    const history = [...opening]
    const writes = await serveCezar(page, {
      status: 'running',
      history: () => history,
      onMessage: (body) => {
        history.push(ev(history.length + 1, 'user-message', { text: body.text }))
        return { status: 200, body: { delivered: true } }
      },
    })
    await page.goto(RUN_PATH)

    const box = page.getByRole('textbox', { name: en.run.compose.label })
    await expect(box).toBeVisible()
    // iOS zooms into any focused field under 16 px.
    const fontSize = await box.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))
    expect(fontSize).toBeGreaterThanOrEqual(16)
    // Docked: its bottom edge is the viewport's, whatever the scroll.
    await page.evaluate(() => window.scrollTo(0, 0))
    const viewport = page.viewportSize()!
    const form = await page.getByRole('form', { name: en.run.compose.label }).boundingBox()
    expect(Math.round(form!.y + form!.height)).toBeLessThanOrEqual(viewport.height)
    expect(form!.y).toBeGreaterThan(viewport.height / 2)

    await box.fill('Also update the changelog.')
    await page.getByRole('button', { name: en.run.compose.send }).tap()
    await expect(box).toHaveValue('')
    expect(writes.messages).toEqual([{ text: 'Also update the changelog.' }])
    await expect(page.getByText('Also update the changelog.')).toBeVisible()
    await noSidewaysScroll(page)
  })

  test('a closed task offers no composer', async ({ page }) => {
    await serveCezar(page, { status: 'done', history: () => opening })
    await page.goto(RUN_PATH)
    await expect(page.getByRole('region', { name: en.run.transcript.heading })).toBeVisible()
    await expect(page.getByRole('form', { name: en.run.compose.label })).toHaveCount(0)
  })
})
