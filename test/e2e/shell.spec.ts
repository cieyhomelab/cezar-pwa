import { expect, test } from '@playwright/test'

/**
 * M0 acceptance (REQUIREMENTS §8): the installable shell loads under /m/ in
 * mobile Safari. Deliberately does not touch Cezar — there is no session here.
 */
test.describe('PWA shell', () => {
  test('serves the shell under /m/', async ({ page }) => {
    await page.goto('.')
    await expect(page).toHaveTitle('Cezar')
    await expect(page.getByRole('heading', { name: 'Cezar' })).toBeVisible()
  })

  test('is installable: manifest is scoped to /m/ and fetched without credentials', async ({
    page,
  }) => {
    await page.goto('.')
    const link = page.locator('link[rel="manifest"]')
    await expect(link).toHaveAttribute('href', '/m/manifest.webmanifest')
    // R-AUTH-6: crossorigin="use-credentials" would break install, because
    // Safari fetches the manifest without cookies.
    expect(await link.getAttribute('crossorigin')).toBeNull()

    const manifest = await page.request.get('/m/manifest.webmanifest')
    expect(manifest.ok()).toBe(true)
    const body = await manifest.json()
    expect(body.scope).toBe('/m/')
    expect(body.start_url).toBe('/m/')
    expect(body.display).toBe('standalone')
  })

  test('declares the iOS install metadata', async ({ page }) => {
    await page.goto('.')
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      'content',
      /viewport-fit=cover/,
    )
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'sizes',
      '180x180',
    )
  })

  test('deep links resolve to the shell instead of a 404', async ({ page }) => {
    // The target a push notification opens (F-PUSH-6); the run screen lands in M2.
    const response = await page.goto('run/some-project/some-run')
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Cezar' })).toBeVisible()
  })
})
