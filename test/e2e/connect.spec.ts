import { type Page, expect, test } from '@playwright/test'

/**
 * S-02 acceptance in mobile Safari: the app can tell it is not authorized, says
 * so with "Połącz z Cezarem", and can be re-unlocked from inside itself.
 *
 * The session probe is stubbed rather than pointed at the live instance — this
 * suite runs against a local preview build with no Cezar behind it, and the
 * behaviour under test is how the app reads the gateway's answers, not the
 * gateway itself.
 */

/** The gateway's bare refusal: 403, HTML, no redirect (`docs/CEZAR_API.md` § 1a). */
async function refuseSession(page: Page) {
  await page.route('**/api/v1/health', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'text/html',
      body: '<html><head><title>403 Forbidden</title></head><body>403</body></html>',
    }),
  )
}

async function grantSession(page: Page) {
  await page.route('**/api/v1/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ version: '0.11.1', projects: [] }),
    }),
  )
}

test.describe('Connect to Cezar', () => {
  test('a refused session shows the connect screen, not an error or an empty list', async ({
    page,
  }) => {
    await refuseSession(page)
    await page.goto('.')

    await expect(page.getByRole('heading', { name: 'Połącz z Cezarem' })).toBeVisible()
    await expect(page.getByLabel('Wklej link dostępowy')).toBeVisible()
    // The chrome stays reachable: a lapsed session must not hide the update
    // prompt or the offline banner.
    await expect(page.getByRole('heading', { name: 'Cezar', exact: true })).toBeVisible()
  })

  test('a live session renders what the gate guards', async ({ page }) => {
    await grantSession(page)
    await page.goto('.')

    await expect(page.getByText('Szkielet aplikacji działa.', { exact: false })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Połącz z Cezarem' })).toBeHidden()
  })

  test('pasting the access link navigates to the app’s own path carrying the key', async ({
    page,
  }) => {
    await refuseSession(page)
    await page.goto('.')

    await page.getByLabel('Wklej link dostępowy').fill('/p/demo/runs/abc?key=s3cret')
    await page.getByRole('button', { name: 'Połącz' }).click()

    // The gateway's guard is not present in front of this preview server, so
    // the navigation lands back on the shell with the key untouched — which is
    // exactly the case the app has to survive.
    await expect(page.getByRole('heading', { name: 'Połącz z Cezarem' })).toBeVisible()

    // R-AUTH-5: the secret is gone from the URL — and so from the history
    // entry — before the operator sees the screen again.
    expect(page.url()).not.toContain('s3cret')
    expect(new URL(page.url()).pathname).toBe('/m/')

    // And the app says what happened rather than looping silently.
    await expect(page.getByText('Brama nie przyjęła linku', { exact: false })).toBeVisible()
  })

  test('the connect screen refuses a link pointing at another host', async ({ page }) => {
    await refuseSession(page)
    await page.goto('.')

    await page.getByLabel('Wklej link dostępowy').fill('https://evil.example/?key=s3cret')
    await page.getByRole('button', { name: 'Połącz' }).click()

    await expect(page.getByRole('alert')).toContainText('inny adres')
    expect(page.url()).not.toContain('evil.example')
  })

  test('re-checking after the session exists lets the operator through', async ({ page }) => {
    await refuseSession(page)
    await page.goto('.')
    await expect(page.getByRole('heading', { name: 'Połącz z Cezarem' })).toBeVisible()

    // The operator went and opened their access link elsewhere.
    await page.unroute('**/api/v1/health')
    await grantSession(page)

    await page.getByRole('button', { name: 'Sprawdź ponownie' }).click()
    await expect(page.getByText('Szkielet aplikacji działa.', { exact: false })).toBeVisible()
  })

  test('the service worker lets the unlock navigation through to the gateway', async ({
    page,
  }) => {
    // The one way this feature can fail silently: the worker's navigation
    // fallback answers /m/?key=… from the precache, the gateway never sees the
    // key, and no configuration of the gateway could ever make unlocking work.
    await refuseSession(page)
    await page.goto('.')
    await page.evaluate(() => navigator.serviceWorker.ready)

    // A plain navigation is now served by the worker — which is what makes the
    // assertion below meaningful rather than vacuous.
    const controlled = await page.goto('.')
    expect(controlled?.fromServiceWorker()).toBe(true)

    const unlock = await page.goto('?key=probe')
    expect(unlock?.fromServiceWorker()).toBe(false)
  })

  test('an unreachable Cezar is not reported as a lapsed session', async ({ page }) => {
    await page.route('**/api/v1/health', (route) => route.abort('connectionfailed'))
    await page.goto('.')

    await expect(
      page.getByRole('heading', { name: 'Nie mogę połączyć się z Cezarem' }),
    ).toBeVisible()
    await expect(page.getByLabel('Wklej link dostępowy')).toBeHidden()
  })
})
