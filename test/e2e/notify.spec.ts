import { readFileSync } from 'node:fs'
import { type Page, expect, test } from '@playwright/test'
import { en } from '../../apps/pwa/src/i18n/en.ts'

/**
 * S-10 acceptance in mobile Safari: notifications are turned on from Settings (FR-036), a browser
 * tab is shown how to install instead (FR-037), and a tapped notification lands in that task's
 * transcript, reusing the open window (FR-041).
 *
 * What WebKit under Playwright cannot do is stubbed in the page: it has no Web Push, and the
 * operator's permission prompt, the push service and the lock screen only exist on the device —
 * those stay on the device checklist in `context/changes/notify-and-deep-link/plan.md`. The
 * sidecar's answers are stubbed at the network, like Cezar's.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`../../apps/pwa/test/fixtures/${name}`, import.meta.url), 'utf8')

const liveRun = JSON.parse(fixture('run.live-0.11.0.json')) as Record<string, unknown> & { id: string }
const PROJECT = 'cezar-pwa'
const RUN_PATH = `p/${PROJECT}/runs/${liveRun.id}`
const KEY = 'BPpbtCsdAm_BdyJwV812MSbdh2qolBEg8jHCrz_gn-ukYsPfNenr1sKDy6sMZDkOTMDZ2EhZwPH8f6Zw9ZQ2Pv4'
const ENDPOINT = 'https://web.push.apple.com/QGuQyavXutnMb'

async function serveCezar(page: Page) {
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/v1/health', (route) =>
    route.fulfill(json({ version: '0.11.0', projects: [{ id: PROJECT, name: PROJECT }] })),
  )
  await page.route('**/api/v1/workspace/runs-index', (route) =>
    route.fulfill(json({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] })),
  )
  await page.route('**/api/v1/workspace/events', (route) => route.abort())
  const base = `**/api/v1/p/${PROJECT}/runs/${liveRun.id}`
  const run = { ...liveRun, status: 'waiting' }
  await page.route(base, (route) => route.fulfill(json(run)))
  await page.route(`${base}/events*`, (route) => route.abort())
  await page.route(`${base}/history`, (route) =>
    route.fulfill(json({ events: [], itemCount: 0, liveCursor: 'live', asOfSeq: 0, hasOlder: false })),
  )
  await page.route(`${base}/history-context`, (route) => route.fulfill(json({ contextEvents: [], asOfSeq: 0 })))
  await page.route(`${base}/read`, (route) => route.fulfill(json(run)))
}

/** The sidecar, recording what the app sent it. */
async function serveSidecar(page: Page) {
  const sent: { method: string; path: string; body: unknown }[] = []
  await page.route('**/m/push/**', (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    sent.push({ method: request.method(), path, body: request.postDataJSON() })
    if (path.endsWith('/vapid-public-key')) return route.fulfill({ json: { publicKey: KEY } })
    if (path.endsWith('/subscription') && request.method() === 'POST') return route.fulfill({ status: 201, json: { ok: true } })
    if (path.endsWith('/test')) return route.fulfill({ json: { sent: true } })
    return route.fulfill({ json: { removed: true } })
  })
  return sent
}

/**
 * The installed app on iOS 16.4+, as far as the page can tell: launched from the icon, with the
 * Notification and Push APIs. The prompt answers "allow"; subscribing hands back a subscription.
 */
async function installedWithPush(page: Page, { subscribed = false } = {}) {
  await page.addInitScript(
    ({ endpoint, subscribed }) => {
      Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true })
      let permission = subscribed ? 'granted' : 'default'
      let current: unknown = null
      const subscription = {
        endpoint,
        options: { applicationServerKey: null },
        toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'p', auth: 'a' } }),
        unsubscribe: async () => {
          current = null
          return true
        },
      }
      if (subscribed) current = subscription
      const pushManager = {
        getSubscription: async () => current,
        subscribe: async () => {
          current = subscription
          return subscription
        },
      }
      ;(window as unknown as { Notification: unknown }).Notification = {
        get permission() {
          return permission
        },
        requestPermission: async () => {
          permission = 'granted'
          return permission
        },
      }
      ;(window as unknown as { PushManager: unknown }).PushManager = function PushManager() {}
      Object.defineProperty(navigator.serviceWorker, 'ready', {
        configurable: true,
        get: () => Promise.resolve({ pushManager }),
      })
    },
    { endpoint: ENDPOINT, subscribed },
  )
}

// Playwright's WebKit does not route requests from a page a service worker controls.
test.use({ serviceWorkers: 'block' })

test('in a browser tab, Settings shows how to install instead of a prompt that cannot work (FR-037)', async ({
  page,
}) => {
  await serveCezar(page)
  const sent = await serveSidecar(page)
  await page.goto('.')

  await page.getByRole('link', { name: en.settings.title }).tap()
  await expect(page).toHaveURL(/\/m\/settings$/)
  await expect(page.getByRole('heading', { name: en.settings.title })).toBeVisible()
  const section = page.getByRole('region', { name: en.push.section })
  await expect(section.getByRole('note')).toContainText(en.push.installTitle)
  await expect(section.getByRole('button')).toHaveCount(0)
  expect(sent).toEqual([])
})

test('installed and already on: launching the app re-registers this device with the sidecar (S-11)', async ({
  page,
}) => {
  await serveCezar(page)
  const sent = await serveSidecar(page)
  await installedWithPush(page, { subscribed: true })
  await page.goto('.')

  // A push service may have replaced the subscription; the sidecar hears the current one.
  await expect.poll(() => sent.filter((call) => call.method === 'POST')).toEqual([
    {
      method: 'POST',
      path: '/m/push/subscription',
      body: { endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: 'p', auth: 'a' } },
    },
  ])
})

test('installed: a tap turns notifications on, and a test reaches this device (FR-036, FR-045)', async ({ page }) => {
  await serveCezar(page)
  const sent = await serveSidecar(page)
  await installedWithPush(page)
  await page.goto('settings')

  const enable = page.getByRole('button', { name: en.push.enable })
  await expect(enable).toBeVisible()
  expect((await enable.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  await enable.tap()
  await expect(page.getByText(en.push.on)).toBeVisible()
  expect(sent.find((call) => call.method === 'POST' && call.path === '/m/push/subscription')?.body).toEqual({
    endpoint: ENDPOINT,
    expirationTime: null,
    keys: { p256dh: 'p', auth: 'a' },
  })

  await page.getByRole('button', { name: en.push.test }).tap()
  await expect(page.getByRole('status').filter({ hasText: en.push.testSent })).toBeVisible()
  expect(sent.find((call) => call.path === '/m/push/test')?.body).toEqual({ endpoint: ENDPOINT })

  await page.getByRole('button', { name: en.push.disable }).tap()
  await expect(page.getByRole('button', { name: en.push.enable })).toBeVisible()
  expect(sent.some((call) => call.method === 'DELETE')).toBe(true)
})

test('a notification tapped while the app is open lands in that task, in the same window (FR-041)', async ({
  page,
}) => {
  await serveCezar(page)
  await page.goto('.')
  await expect(page.getByRole('link', { name: en.settings.title })).toBeVisible()

  // Survives only if the window is routed in place rather than reloaded.
  await page.evaluate(() => ((window as unknown as { kept: boolean }).kept = true))
  // What the worker posts after focusing this window (`sw.ts`, `notificationclick`).
  await page.evaluate(
    (url) =>
      navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'cezar:navigate', url } })),
    `/m/${RUN_PATH}`,
  )
  await expect(page).toHaveURL(new RegExp(`/m/${RUN_PATH}$`))
  await expect(page.getByText(String(liveRun.title).split('\n')[0]!.slice(0, 30))).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true)
})

test('the URL a notification opens cold is the task screen (FR-041)', async ({ page }) => {
  await serveCezar(page)
  await page.goto(RUN_PATH)
  await expect(page).toHaveURL(new RegExp(`/m/${RUN_PATH}$`))
  await expect(page.getByText(String(liveRun.title).split('\n')[0]!.slice(0, 30))).toBeVisible()
})
