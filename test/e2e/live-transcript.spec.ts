import { readFileSync } from 'node:fs'
import { type Page, type Route, expect, test } from '@playwright/test'

/**
 * S-06 acceptance in mobile Safari: the transcript updates while the agent works (FR-016), stays
 * where the operator scrolled with a "new messages" button (FR-019), and resumes after a dropped
 * stream with nothing lost and nothing duplicated (FR-021).
 *
 * The stream is the browser's real EventSource against a routed `text/event-stream` answer. A
 * routed answer cannot stay open, so each connection delivers its lines and ends — the drop the
 * resume path has to handle, which is what a frozen app looks like to the server too.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`../../apps/pwa/test/fixtures/${name}`, import.meta.url), 'utf8')

const liveRun = {
  ...(JSON.parse(fixture('run.live-0.11.0.json')) as Record<string, unknown> & { id: string }),
  status: 'running',
}
const livePage = JSON.parse(fixture('history.live-0.11.0.json')) as { asOfSeq: number; liveCursor: string }
const PROJECT = 'cezar-pwa'
const RUN_PATH = `p/${PROJECT}/runs/${liveRun.id}`
const SEQ = livePage.asOfSeq
const ts = '2026-09-21T10:00:00.000Z'

const health = JSON.stringify({ version: '0.11.0', projects: [{ id: PROJECT, name: PROJECT }] })

/** An SSE line the way the server writes it: `id:` is the seq, the name follows the type. */
function line(event: Record<string, unknown> & { seq: number; type: string }): string {
  const name = event.type.includes('.') ? 'ui-event' : 'run-event'
  return `id: ${event.seq}\nevent: ${name}\ndata: ${JSON.stringify({ ts, ...event })}\n\n`
}

const message = (seq: number, id: string, text: string, type = 'item.completed') =>
  line({ seq, type, stepId: 'task', item: { kind: 'message', id, role: 'assistant', text } })

async function serveCezar(page: Page) {
  const held: Route[] = []
  const urls: URL[] = []
  const json = (body: string) => ({ status: 200, contentType: 'application/json', body })
  await page.route('**/api/v1/health', (route) => route.fulfill(json(health)))
  const base = `**/api/v1/p/${PROJECT}/runs/${liveRun.id}`
  await page.route(base, (route) => route.fulfill(json(JSON.stringify(liveRun))))
  await page.route(`${base}/history`, (route) => route.fulfill(json(JSON.stringify(livePage))))
  await page.route(`${base}/history-context`, (route) =>
    route.fulfill(json(JSON.stringify({ contextEvents: [], asOfSeq: SEQ }))),
  )
  await page.route(`${base}/read`, (route) => route.fulfill(json(JSON.stringify(liveRun))))
  await page.route(new RegExp(`/runs/${liveRun.id}/events\\?`), (route) => {
    urls.push(new URL(route.request().url()))
    held.push(route)
  })
  /** Answer the oldest held connection with these lines; it ends after them. */
  const deliver = async (...lines: string[]) => {
    await expect.poll(() => held.length).toBeGreaterThan(0)
    await held.shift()!.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      body: `event: ping\ndata: \n\n${lines.join('')}`,
    })
  }
  return { deliver, urls }
}

/** The page is in and the screen opened at its end. A running task has no closing footer. */
async function opened(page: Page) {
  await expect(page.getByRole('region', { name: 'Transkrypt' })).toBeVisible()
  await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(96)
}

const distanceFromBottom = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollHeight - (window.scrollY + window.innerHeight),
  )

test.use({ serviceWorkers: 'block' })

test.describe('Live transcript', () => {
  test('a new answer appears while the agent works, and the screen follows it (FR-016)', async ({
    page,
  }) => {
    const { deliver, urls } = await serveCezar(page)
    await page.goto(RUN_PATH)
    await opened(page)
    await expect.poll(() => urls.length).toBe(1)
    expect(urls[0]!.searchParams.get('afterSeq')).toBe(String(SEQ))
    expect(urls[0]!.searchParams.get('cursor')).toBe(livePage.liveCursor)

    await deliver(
      line({ seq: SEQ + 1, type: 'user-message', text: 'One more thing' }),
      line({ seq: SEQ + 2, type: 'turn.started', turnId: 'live' }),
      message(SEQ + 3, 'live-1', '', 'item.started'),
      line({ seq: SEQ + 4, type: 'item.delta', stepId: 'task', itemId: 'live-1', field: 'text', delta: 'Streaming ' }),
      line({ seq: SEQ + 5, type: 'item.delta', stepId: 'task', itemId: 'live-1', field: 'text', delta: 'in place' }),
    )
    const answer = page.getByText('Streaming in place')
    await expect(answer).toBeVisible({ timeout: 2_000 })
    // At the end when it arrived, so the screen followed it.
    await expect(answer).toBeInViewport()
    expect(await distanceFromBottom(page)).toBeLessThanOrEqual(96)
    await expect(page.getByRole('button', { name: /Nowe wiadomości/ })).toHaveCount(0)
  })

  test('scrolled up, the screen stays put and offers "new messages" (FR-019)', async ({ page }) => {
    const { deliver } = await serveCezar(page)
    await page.goto(RUN_PATH)
    await opened(page)
    await page.evaluate(() => window.scrollTo(0, 200))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(200)

    await deliver(message(SEQ + 1, 'live-2', 'Written while you read'))
    const button = page.getByRole('button', { name: /Nowe wiadomości/ })
    await expect(button).toBeVisible()
    expect(await page.evaluate(() => window.scrollY)).toBe(200)
    const box = await button.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)

    await button.click()
    await expect(page.getByText('Written while you read')).toBeInViewport()
    await expect(button).toHaveCount(0)
  })

  test('a dropped stream resumes after the last line it had: nothing lost, nothing twice (FR-021)', async ({
    page,
  }) => {
    const { deliver, urls } = await serveCezar(page)
    await page.goto(RUN_PATH)
    await deliver(
      line({ seq: SEQ + 1, type: 'note', message: 'Before the drop' }),
      message(SEQ + 2, 'live-3', 'Answer before the drop'),
    )
    await expect(page.getByText('Answer before the drop')).toBeVisible()

    // The connection ended with those lines; the app reconnects on its own, from where it stopped.
    await expect(page.locator('[data-live-state]')).toHaveAttribute('data-live-state', /reconnecting|live/)
    await expect.poll(() => urls.length).toBe(2)
    expect(urls[1]!.searchParams.get('afterSeq')).toBe(String(SEQ + 2))

    // A server replay that overlaps what the app already had, then what it missed.
    await deliver(
      line({ seq: SEQ + 1, type: 'note', message: 'Before the drop' }),
      message(SEQ + 2, 'live-3', 'Answer before the drop'),
      line({ seq: SEQ + 3, type: 'note', message: 'Missed while away' }),
    )
    await expect(page.getByText('Missed while away')).toBeVisible()
    await expect(page.getByText('Before the drop', { exact: true })).toHaveCount(1)
    await expect(page.getByText('Answer before the drop')).toHaveCount(1)
  })
})
