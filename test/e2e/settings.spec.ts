import { readFileSync } from 'node:fs'
import { type Page, expect, test } from '@playwright/test'

/**
 * S-12 acceptance in mobile Safari: the theme (FR-046), both versions (FR-047), the cockpit link
 * from a task (FR-048) and sign-out (FR-006).
 *
 * Cezar, the sidecar and the perimeter's `/m/session/end` are stubbed at the network. What nginx
 * does with the sign-out — the `Set-Cookie` that expires the gate's cookie, and the gate refusing
 * afterwards — is `deploy/nginx/rehearse.sh`'s; here the perimeter's 204 flips the stubbed gate to
 * refusing, which is what the app then sees.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`../../apps/pwa/test/fixtures/${name}`, import.meta.url), 'utf8')

const liveRun = JSON.parse(fixture('run.live-0.11.0.json')) as Record<string, unknown> & { id: string }
const PROJECT = 'cezar-pwa'
const ENDPOINT = 'https://web.push.apple.com/QGuQyavXutnMb'

/** Cezar behind a gate that the perimeter's sign-out closes. */
async function serve(page: Page) {
  const state = { signedIn: true, sent: [] as string[] }
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
  const refusal = { status: 403, contentType: 'text/html', body: '<html>403 Forbidden</html>' }
  const gated = (body: () => ReturnType<typeof json>) => () => (state.signedIn ? body() : refusal)

  const routes: Record<string, () => { status: number; contentType: string; body: string }> = {
    '/api/v1/health': gated(() => json({ version: '0.11.0', projects: [{ id: PROJECT, name: 'Cezar PWA' }] })),
    '/api/v1/workspace/runs-index': gated(() =>
      json({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] }),
    ),
    [`/api/v1/p/${PROJECT}/runs/${liveRun.id}`]: gated(() => json(liveRun)),
    [`/api/v1/p/${PROJECT}/runs/${liveRun.id}/history`]: gated(() =>
      json({ events: [], itemCount: 0, liveCursor: 'live', asOfSeq: 0, hasOlder: false }),
    ),
    [`/api/v1/p/${PROJECT}/runs/${liveRun.id}/history-context`]: gated(() => json({ contextEvents: [], asOfSeq: 0 })),
  }
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/events')) return route.abort()
    const answer = routes[path]
    return answer ? route.fulfill(answer()) : route.fulfill(json({ error: 'not found' }, 404))
  })
  await page.route('**/m/push/**', (route) => {
    state.sent.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
    return state.signedIn ? route.fulfill(json({ removed: true })) : route.fulfill(refusal)
  })
  await page.route('**/m/session/end', (route) => {
    const request = route.request()
    state.sent.push(`${request.method()} /m/session/end`)
    if (request.method() !== 'POST') return route.fulfill({ status: 405, body: '' })
    state.signedIn = false
    return route.fulfill({ status: 204, body: '' })
  })
  return state
}

/** The installed app with notifications on: a subscription the sign-out must end. */
async function subscribedDevice(page: Page) {
  await page.addInitScript((endpoint) => {
    const subscription = {
      endpoint,
      unsubscribe: async () => {
        current = null
        return true
      },
    }
    let current: typeof subscription | null = subscription
    const registration = { pushManager: { getSubscription: async () => current } }
    Object.defineProperty(navigator.serviceWorker, 'getRegistration', {
      configurable: true,
      value: async () => registration,
    })
  }, ENDPOINT)
}

// Playwright's WebKit does not route requests from a page a service worker controls.
test.use({ serviceWorkers: 'block' })

test('the theme follows the system until forced, and a forced one survives a relaunch (FR-046)', async ({ page }) => {
  await serve(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('settings')

  const html = page.locator('html')
  await expect(page.getByRole('radio', { name: 'Jak w systemie' })).toBeChecked()
  await expect(html).not.toHaveAttribute('data-theme')
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(await background()).toBe('rgb(11, 17, 23)')

  await page.getByText('Jasny', { exact: true }).click()
  await expect(html).toHaveAttribute('data-theme', 'light')
  expect(await background()).toBe('rgb(255, 255, 255)')
  // The status bar follows the forced theme, whatever the system says.
  await expect(page.locator('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]')).toHaveAttribute(
    'content',
    '#ffffff',
  )

  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('radio', { name: 'Jasny' })).toBeChecked()

  // Forced dark holds against a light system; "system" hands it back.
  await page.emulateMedia({ colorScheme: 'light' })
  await page.getByText('Ciemny', { exact: true }).click()
  expect(await background()).toBe('rgb(11, 17, 23)')
  await page.getByText('Jak w systemie', { exact: true }).click()
  await expect(html).not.toHaveAttribute('data-theme')
  expect(await background()).toBe('rgb(255, 255, 255)')
})

test('shows the build and the Cezar version it talks to (FR-047)', async ({ page }) => {
  await serve(page)
  await page.goto('settings')
  const versions = page.getByRole('region', { name: 'Wersje' })
  // The commit this build came from, stamped by vite.config.ts.
  await expect(versions.getByRole('definition').first()).toHaveText(/^[0-9a-f]{7}( · zbudowana .+)?$/)
  await expect(versions.getByRole('definition').nth(1)).toHaveText('0.11.0')
})

test('a task links to the same task in the full cockpit (FR-048)', async ({ page }) => {
  await serve(page)
  await page.goto(`p/${PROJECT}/runs/${liveRun.id}`)
  const link = page.getByRole('link', { name: 'Otwórz to zadanie w pełnym cockpicie' })
  await expect(link).toHaveAttribute('href', `/p/${PROJECT}/tasks/${liveRun.id}`)
})

test('signing out stops notifications, ends the session, clears the phone and lands on "Połącz z Cezarem" (FR-006)', async ({
  page,
}) => {
  const state = await serve(page)
  await subscribedDevice(page)
  await page.goto('settings')
  await page.getByText('Jasny', { exact: true }).click()

  await page.getByRole('button', { name: 'Wyloguj' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Wylogować z Cezara?' })
  await dialog.getByRole('button', { name: 'Wyloguj' }).click()

  await expect(page.getByRole('heading', { name: 'Połącz z Cezarem' })).toBeVisible()
  await expect(page).toHaveURL(/\/m\/$/)
  // The sidecar was told while the session still let it through; then the session went.
  expect(state.sent).toEqual(['DELETE /m/push/subscription', 'POST /m/session/end'])
  expect(await page.evaluate(() => localStorage.length)).toBe(0)
  await expect(page.locator('html')).not.toHaveAttribute('data-theme')
})

test('when the perimeter cannot end the session, Settings says so instead of pretending (FR-006)', async ({
  page,
}) => {
  await serve(page)
  // A host where the sign-out snippet is not installed: the static shell refuses the POST.
  await page.route('**/m/session/end', (route) => route.fulfill({ status: 405, body: '' }))
  await page.goto('settings')

  await page.getByRole('button', { name: 'Wyloguj' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Wyloguj' }).click()

  await expect(page.getByRole('alert')).toContainText('serwer nie potwierdził zakończenia sesji')
  await expect(page.getByRole('button', { name: 'Spróbuj ponownie' })).toBeVisible()
  await expect(page).toHaveURL(/\/m\/settings$/)
})
