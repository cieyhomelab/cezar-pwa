import { readFileSync } from 'node:fs'
import { type Page, expect, test } from '@playwright/test'
import { en } from '../../apps/pwa/src/i18n/en.ts'

/**
 * FR-049 (#64) in mobile Safari: scrolling to the top of a long transcript reads the page before
 * it and puts it in front, without moving what the operator is reading. At the start of the file
 * the top says so; a page that fails offers a retry and the cockpit.
 *
 * The run is `transcript-long.ndjson`, and its pages are what Cezar 0.11.1's own reader cut from
 * it (`scripts/record-history-pages.mjs`): three pages, the first turn longer than one of them.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`../../apps/pwa/test/fixtures/${name}`, import.meta.url), 'utf8')

const liveRun = JSON.parse(fixture('run.live-0.11.0.json')) as Record<string, unknown> & { id: string }
const pages = JSON.parse(fixture('history-pages.long.json')) as { cursor: string | null; page: unknown }[]
const PROJECT = 'cezar-pwa'
const RUN_PATH = `p/${PROJECT}/runs/${liveRun.id}`
const HISTORY = `/api/v1/p/${PROJECT}/runs/${liveRun.id}/history`
const health = JSON.stringify({ version: '0.11.1', projects: [{ id: PROJECT, name: PROJECT }] })
const t = en.run.transcript

async function serveCezar(page: Page, opts: { failFirst?: boolean } = {}) {
  const asked: (string | null)[] = []
  let failures = opts.failFirst ? 1 : 0
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
  const run = { ...liveRun, status: 'done', task: 'Read the whole codebase, then keep going.' }
  await page.route('**/api/v1/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: health }))
  await page.route('**/api/v1/workspace/runs-index', (route) =>
    route.fulfill(json({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] })),
  )
  await page.route('**/api/v1/workspace/events', (route) => route.abort())
  const base = `**/api/v1/p/${PROJECT}/runs/${liveRun.id}`
  await page.route(base, (route) => route.fulfill(json(run)))
  await page.route(`${base}/events*`, (route) => route.abort())
  await page.route(`${base}/history-context`, (route) => route.fulfill(json({ contextEvents: [], asOfSeq: 1099 })))
  await page.route(`${base}/read`, (route) => route.fulfill(json(run)))
  // By pathname: a glob on `…/history` would not match the `?cursor=` form.
  await page.route(
    (url) => url.pathname === HISTORY,
    (route) => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor')
      asked.push(cursor)
      if (cursor !== null && failures > 0) {
        failures -= 1
        return route.fulfill(json({ error: 'history read failed' }, 500))
      }
      const found = pages.find((entry) => entry.cursor === cursor)
      return found ? route.fulfill(json(found.page)) : route.fulfill(json({ error: 'invalid history cursor' }, 400))
    },
  )
  return { asked }
}

/** The first transcript entry on screen, and where its top is. */
async function firstVisibleEntry(page: Page): Promise<{ key: string; top: number }> {
  return page.evaluate(() => {
    for (const element of document.querySelectorAll('[data-entry-key]')) {
      const { top, bottom } = element.getBoundingClientRect()
      if (bottom > 0 && top < window.innerHeight) return { key: element.getAttribute('data-entry-key')!, top }
    }
    throw new Error('no entry on screen')
  })
}

const entryTop = (page: Page, key: string) =>
  page.evaluate(
    (wanted) =>
      [...document.querySelectorAll('[data-entry-key]')]
        .find((element) => element.getAttribute('data-entry-key') === wanted)!
        .getBoundingClientRect().top,
    key,
  )

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

// Playwright's WebKit anchors scroll natively; iOS Safari cannot be relied on to. Run both ways,
// as `live-status.spec.ts` does for the list: with native anchoring off `useKeepPlace` alone must
// hold the entry, and with it on the two must not correct twice.
for (const native of [false, true]) {
  test(`scrolling to the top reads back to the start without moving the entry being read (native anchoring ${native ? 'on' : 'off'})`, async ({
    page,
  }) => {
    const { asked } = await serveCezar(page)
    await page.goto(RUN_PATH)
    await expect(page.getByText('Turn 30 done: 90 checks green.')).toBeVisible()
    if (!native) await page.addStyleTag({ content: '* { overflow-anchor: none !important }' })
    // The screen opens at the newest entry, far from the top: nothing older is asked for yet.
    expect(asked).toEqual([null])

    for (let loaded = 1; loaded < pages.length; loaded += 1) {
      // Just below the top line, so the entries under it are what the reader is looking at.
      const top = page.getByRole('button', { name: t.showOlder })
      await top.scrollIntoViewIfNeeded()
      await page.evaluate(() => window.scrollBy(0, 40))
      await page.waitForTimeout(100)
      const reading = await firstVisibleEntry(page)
      // Reaching the top line asks on its own; nothing is tapped.
      await page.evaluate(() => window.scrollBy(0, -40))
      await expect.poll(() => asked).toContain(pages[loaded]!.cursor)
      await expect(page.locator('[data-entry-key]').first()).not.toHaveAttribute('data-entry-key', reading.key)
      // ±40 px: the scroll back up to the line is part of the reading position.
      expect(Math.abs((await entryTop(page, reading.key)) - (reading.top + 40))).toBeLessThanOrEqual(1)
    }

    await expect(page.getByText(t.start)).toBeVisible()
    await expect(page.getByText('Read the whole codebase, then keep going.')).toBeVisible()
    await expect(page.getByRole('button', { name: t.showOlder })).toHaveCount(0)
    // Older content above is not "new messages".
    await expect(page.getByRole('button', { name: new RegExp(en.run.newMessages) })).toHaveCount(0)
    expect(asked.filter((cursor) => cursor !== null)).toEqual(pages.slice(1).map((entry) => entry.cursor))
    await expect(page.getByText('First pass done.', { exact: false })).toHaveCount(1)
  })
}

test('a page that fails offers a retry and the cockpit, and the transcript stays', async ({ page }) => {
  await serveCezar(page, { failFirst: true })
  await page.goto(RUN_PATH)
  await expect(page.getByText('Turn 30 done: 90 checks green.')).toBeVisible()

  // Scrolled to, the top asks on its own.
  await page.getByRole('button', { name: t.showOlder }).scrollIntoViewIfNeeded()
  const alert = page.getByRole('alert').filter({ hasText: t.olderFailed })
  await expect(alert).toBeVisible()
  await expect(alert.getByRole('link', { name: t.olderInCockpit })).toHaveAttribute(
    'href',
    `/p/${PROJECT}/tasks/${liveRun.id}`,
  )
  await expect(page.getByText('Turn 30 done: 90 checks green.')).toBeAttached()

  await alert.getByRole('button', { name: en.run.retry }).tap()
  await expect(alert).toHaveCount(0)
  await expect(page.locator('[data-entry-key]').first()).toBeAttached()
  await expect(page.getByRole('button', { name: t.showOlder })).toBeVisible()
})

test.describe('at 390×844', () => {
  // 1× keeps the evidence screenshots small; layout does not depend on the pixel ratio.
  test.use({ deviceScaleFactor: 1 })

  for (const scheme of ['light', 'dark'] as const) {
    test(`the top of the transcript fits 390×844 in the ${scheme} theme`, async ({ page }) => {
      await serveCezar(page, { failFirst: true })
      await page.emulateMedia({ colorScheme: scheme })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(RUN_PATH)
      await expect(page.getByText('Turn 30 done: 90 checks green.')).toBeVisible()
      const evidence = process.env.E2E_EVIDENCE_DIR

      // Scrolled to, the top asks on its own, and the first ask fails (`failFirst`).
      await page.getByRole('button', { name: t.showOlder }).scrollIntoViewIfNeeded()
      const alert = page.getByRole('alert').filter({ hasText: t.olderFailed })
      await expect(alert).toBeVisible()
      for (const target of [alert.getByRole('button', { name: en.run.retry }), alert.getByRole('link')]) {
        expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      }
      await noSidewaysScroll(page)
      if (evidence) await page.screenshot({ path: `${evidence}/older-failed-${scheme}.png` })

      await alert.getByRole('button', { name: en.run.retry }).tap()
      await expect(alert).toHaveCount(0)
      await page.getByRole('button', { name: t.showOlder }).scrollIntoViewIfNeeded()
      await page.evaluate(() => window.scrollBy(0, -200))
      await expect(page.getByText(t.start)).toBeVisible()
      await page.getByText(t.start).scrollIntoViewIfNeeded()
      await page.evaluate(() => window.scrollBy(0, -120))
      await noSidewaysScroll(page)
      if (evidence) await page.screenshot({ path: `${evidence}/start-${scheme}.png` })
    })
  }
})
