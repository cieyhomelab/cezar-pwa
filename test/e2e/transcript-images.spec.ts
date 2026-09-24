import { readFileSync } from 'node:fs'
import { type Page, expect, test } from '@playwright/test'
import { en } from '../../apps/pwa/src/i18n/en.ts'

/**
 * #65 in mobile Safari: a transcript `image` line is a thumbnail read from the project-scoped
 * images route, opens full screen on a tap, and falls back to its file-name line when the image
 * does not load. A queued message's attached image uses the same route.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`../../apps/pwa/test/fixtures/${name}`, import.meta.url), 'utf8')
// Any real PNG will do; this one is a phone screenshot, like the ones agents attach.
const png = readFileSync(new URL('../../context/changes/queued-message-edit/evidence/stack-light.png', import.meta.url))

const liveRun = JSON.parse(fixture('run.live-0.11.0.json')) as Record<string, unknown> & { id: string }
const PROJECT = 'cezar-pwa'
const RUN_PATH = `p/${PROJECT}/runs/${liveRun.id}`
const SCOPED = `/api/v1/p/${PROJECT}/runs/${liveRun.id}/images/`
const health = JSON.stringify({ version: '0.11.0', projects: [{ id: PROJECT, name: PROJECT }] })
const t = en.run.transcript.images

const line = (seq: number, type: string, fields: Record<string, unknown>) => ({
  seq,
  ts: '2026-09-24T08:00:00.000Z',
  type,
  stepId: 'task',
  ...fields,
})
const events = [
  line(1, 'text', { text: 'Here is the page after the fix:' }),
  line(2, 'image', { url: `/api/v1/runs/${liveRun.id}/images/2.png`, name: 'after-fix.png' }),
  line(3, 'image', { url: `/api/v1/runs/${liveRun.id}/images/3.png`, name: 'gone.png' }),
]

async function serveCezar(page: Page, opts: { status?: string } = {}) {
  const fetched: string[] = []
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
  const run = () => ({
    ...liveRun,
    status: opts.status ?? 'running',
    steps: [],
    queuedMessages: [
      {
        id: 'q1',
        text: 'Match this screenshot.',
        images: [`/api/v1/runs/${liveRun.id}/images/pasted-1.png`, `/api/v1/runs/${liveRun.id}/images/pasted-2.pdf`],
        createdAt: '2026-09-24T08:00:00.000Z',
      },
    ],
  })
  await page.route('**/api/v1/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: health }))
  await page.route('**/api/v1/workspace/runs-index', (route) =>
    route.fulfill(json({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] })),
  )
  await page.route('**/api/v1/workspace/events', (route) => route.abort())
  const base = `**/api/v1/p/${PROJECT}/runs/${liveRun.id}`
  await page.route(base, (route) => route.fulfill(json(run())))
  await page.route(`${base}/events`, (route) => route.abort())
  await page.route(`${base}/history`, (route) =>
    route.fulfill(json({ events, itemCount: events.length, liveCursor: 'live', asOfSeq: events.length, hasOlder: false })),
  )
  await page.route(`${base}/history-context`, (route) => route.fulfill(json({ contextEvents: [], asOfSeq: 0 })))
  await page.route(`${base}/read`, (route) => route.fulfill(json(run())))
  // The unscoped form the history records is a 404 on the live host.
  await page.route(`**/api/v1/runs/**`, (route) => route.fulfill(json({ error: 'not found' }, 404)))
  await page.route(`${base}/images/*`, (route) => {
    const file = new URL(route.request().url()).pathname.split('/').pop()!
    fetched.push(file)
    return file === '3.png'
      ? route.fulfill(json({ error: 'not found' }, 404))
      : route.fulfill({ status: 200, contentType: 'image/png', body: png })
  })
  return { fetched }
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

// Playwright's WebKit does not route requests from a page a service worker controls.
test.use({ serviceWorkers: 'block' })

test.describe('A transcript image', () => {
  test('loads from the project-scoped route, opens full screen, and falls back when it fails', async ({ page }) => {
    const state = await serveCezar(page)
    await page.goto(RUN_PATH)

    const thumb = page.getByRole('button', { name: t.open('after-fix.png') })
    await expect(thumb).toBeVisible()
    const img = thumb.getByRole('img')
    await expect(img).toHaveAttribute('src', `${SCOPED}2.png`)
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    expect((await thumb.boundingBox())?.height).toBeGreaterThanOrEqual(44)

    await expect(page.getByText(en.run.transcript.image('gone.png'))).toBeVisible()
    await expect(page.getByRole('button', { name: t.open('gone.png') })).toHaveCount(0)

    await thumb.tap()
    const dialog = page.getByRole('dialog', { name: 'after-fix.png' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: t.close }).tap()
    await expect(dialog).toHaveCount(0)
    expect(state.fetched).toContain('2.png')
  })

  test.describe('at 390×844', () => {
    // 1× keeps the evidence screenshots small; layout does not depend on the pixel ratio.
    test.use({ deviceScaleFactor: 1 })

    for (const scheme of ['light', 'dark'] as const) {
      test(`fits in the ${scheme} theme`, async ({ page }) => {
        await serveCezar(page, { status: 'queued' })
        await page.emulateMedia({ colorScheme: scheme })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto(RUN_PATH)
        const evidence = process.env.E2E_EVIDENCE_DIR

        const thumb = page.getByRole('button', { name: t.open('after-fix.png') })
        await expect.poll(() => thumb.getByRole('img').evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
        await expect(page.getByText(en.run.transcript.image('gone.png'))).toBeVisible()
        await noSidewaysScroll(page)
        if (evidence) await page.screenshot({ path: `${evidence}/transcript-${scheme}.png` })

        await thumb.tap()
        await expect(page.getByRole('dialog')).toBeVisible()
        await noSidewaysScroll(page)
        if (evidence) await page.screenshot({ path: `${evidence}/full-screen-${scheme}.png` })
        await page.getByRole('button', { name: t.close }).tap()

        const composer = page.getByRole('form', { name: en.run.compose.label })
        await composer.getByText(en.run.compose.queuedTitle(1)).tap()
        const attached = composer.getByRole('button', { name: t.open('pasted-1.png') })
        await expect(attached.getByRole('img')).toHaveAttribute('src', `${SCOPED}pasted-1.png`)
        await expect(composer.getByText(en.run.compose.queue.attachment('pasted-2.pdf'))).toBeVisible()
        await noSidewaysScroll(page)
        if (evidence) await page.screenshot({ path: `${evidence}/queued-${scheme}.png` })
      })
    }
  })
})
