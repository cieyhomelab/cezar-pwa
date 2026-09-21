import { readFileSync } from 'node:fs'
import { type Page, type Route, expect, test } from '@playwright/test'

/**
 * S-04 acceptance in mobile Safari: status changes arrive over the workspace event stream
 * without a refresh and without the list jumping (FR-010), and the connection's health is said
 * in words (FR-012).
 *
 * The stream is the browser's real EventSource against a routed `text/event-stream` answer.
 * A routed answer cannot stay open, so each connection delivers its frames and then ends —
 * which is itself the drop the reconnect path has to handle.
 */

const index = JSON.parse(
  readFileSync(new URL('../../apps/pwa/test/fixtures/runs-index.json', import.meta.url), 'utf8'),
) as { runs: Record<string, unknown>[] }

const health = JSON.stringify({
  version: '0.11.0',
  projects: [
    { id: 'cezar-pwa', name: 'cezar-pwa' },
    { id: 'kai-phone', name: 'kai-phone' },
    { id: 'notes', name: 'notes' },
  ],
})

/** A `run` frame the way the server writes it: the record, stamped with `project`. */
function runFrame(id: string, over: Record<string, unknown>): string {
  const row = index.runs.find((run) => run.id === id)!
  const { projectId, ...rest } = row
  return `event: run\ndata: ${JSON.stringify({ ...rest, task: 'prompt', steps: [], ...over, project: projectId })}\n\n`
}

/**
 * Serves health and the index, and holds every stream connection until the test releases it
 * with frames — so the test decides when the "server" speaks.
 */
async function serveCezar(page: Page, runs = index.runs) {
  const held: Route[] = []
  const counts = { runsIndex: 0, streams: 0 }
  const session = { authorized: true }
  await page.route('**/api/v1/health', (route) =>
    session.authorized
      ? route.fulfill({ status: 200, contentType: 'application/json', body: health })
      : route.fulfill({ status: 403, contentType: 'text/html', body: '403' }),
  )
  await page.route('**/api/v1/workspace/runs-index', (route) => {
    counts.runsIndex += 1
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...index, runs }),
    })
  })
  await page.route('**/api/v1/workspace/events', (route) => {
    counts.streams += 1
    held.push(route)
  })
  /** Answer the oldest held connection with these frames; it ends after them. */
  const deliver = async (...frames: string[]) => {
    await expect.poll(() => held.length).toBeGreaterThan(0)
    await held.shift()!.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      },
      body: `event: ping\ndata: \n\n${frames.join('')}`,
    })
  }
  return { counts, deliver, session }
}

const liveStatus = (page: Page) => page.locator('[data-live-state]')

test.use({ serviceWorkers: 'block' })

test.describe('Live status', () => {
  test('a status change appears without refreshing (FR-010)', async ({ page }) => {
    const { deliver } = await serveCezar(page)
    await page.goto('.')
    await expect(page.getByRole('heading', { name: '3 zadania wymagają uwagi' })).toBeVisible()
    await expect(liveStatus(page)).toHaveAttribute('data-live-state', 'connecting')

    await deliver(runFrame('run-running', { status: 'waiting' }))

    await expect(page.getByRole('heading', { name: '4 zadania wymagają uwagi' })).toBeVisible({
      timeout: 2_000, // the NF: visible within 2 s of the server saying so
    })
    await expect(
      page.locator('[data-run-id="run-running"]').getByText('czeka na Ciebie'),
    ).toBeVisible()
  })

  test('says reconnecting when the stream ends, and reconnects on its own (FR-012)', async ({
    page,
  }) => {
    const { counts, deliver } = await serveCezar(page)
    await page.goto('.')
    await expect(page.getByRole('heading', { name: /wymagają uwagi/ })).toBeVisible()

    await deliver()
    await expect(liveStatus(page)).toHaveAttribute('data-live-state', 'reconnecting')
    await expect(liveStatus(page)).toContainText('Łączę ponownie…')
    await expect(liveStatus(page)).toContainText(/lista z \d/)
    await expect.poll(() => counts.streams).toBe(2)
  })

  test('every reconnect refetches the list, because the stream has no replay', async ({ page }) => {
    const { counts, deliver } = await serveCezar(page)
    await page.goto('.')
    await expect(page.getByRole('heading', { name: /wymagają uwagi/ })).toBeVisible()
    const before = counts.runsIndex

    await deliver()
    await expect.poll(() => counts.runsIndex).toBe(before + 1)
    await deliver()
    await expect.poll(() => counts.runsIndex).toBe(before + 2)
  })

  test('a session that lapsed is noticed when the stream drops, with nothing pressed', async ({
    page,
  }) => {
    const { deliver, session } = await serveCezar(page)
    await page.goto('.')
    await expect(page.getByRole('heading', { name: /wymagają uwagi/ })).toBeVisible()

    // The gateway refuses a stream the same way it refuses everything; EventSource cannot see
    // the status, so the drop re-asks the session probe.
    session.authorized = false
    await deliver()
    await expect(page.getByRole('heading', { name: 'Połącz z Cezarem' })).toBeVisible()
  })

  test('says lost at once when the phone goes offline', async ({ page, context }) => {
    await serveCezar(page)
    await page.goto('.')
    await expect(page.getByRole('heading', { name: /wymagają uwagi/ })).toBeVisible()

    await context.setOffline(true)
    await expect(liveStatus(page)).toHaveAttribute('data-live-state', 'lost')
    await expect(liveStatus(page)).toContainText('Brak połączenia na żywo')
    await context.setOffline(false)
  })

  // Playwright's WebKit anchors scroll natively; older iOS Safari does not. Run both ways: with
  // native anchoring off the hook alone must hold the row (without it the row moves ~95 px), and
  // with it on the two must not correct twice.
  for (const native of [false, true]) {
    const name = `native anchoring ${native ? 'on' : 'off'}`
    test(`a task appearing above does not move what the operator is reading (${name})`, async ({
      page,
    }) => {
      // Enough finished work to scroll: the reader is deep in "Zakończone" when a new task queues.
      const finished = Array.from({ length: 15 }, (_, i) => ({
        ...index.runs.find((run) => run.id === 'run-done-read')!,
        id: `run-old-${i}`,
        title: `Older finished task ${i}`,
        createdAt: `2026-09-01T10:${String(i).padStart(2, '0')}:00.000Z`,
      }))
      const { deliver } = await serveCezar(page, [...index.runs, ...finished])
      await page.goto('.')
      await expect(page.getByRole('heading', { name: /wymagają uwagi/ })).toBeVisible()

      if (!native) await page.addStyleTag({ content: '* { overflow-anchor: none !important }' })
      const reading = page.locator('[data-run-id="run-old-10"]')
      await reading.scrollIntoViewIfNeeded()
      await page.evaluate(() => window.scrollBy(0, -200))
      // Let the anchor capture settle (it reads on the next frame after a scroll).
      await page.waitForTimeout(100)
      const before = (await reading.boundingBox())!.y

      await deliver(
        runFrame('run-queued-first', {
          id: 'run-brand-new',
          title: 'Just queued',
          status: 'queued',
        }),
      )
      await expect(page.getByText('Just queued')).toBeAttached()

      const after = (await reading.boundingBox())!.y
      expect(Math.abs(after - before)).toBeLessThanOrEqual(1)
    })
  }
})
