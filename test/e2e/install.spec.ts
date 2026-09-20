import { expect, test } from '@playwright/test'

/**
 * S-01 acceptance: install, launch full-screen, a plain offline state, and an
 * update the operator accepts on purpose.
 *
 * Runs against `vite preview`, not the dev server — the manifest and the
 * service worker only exist in a production build, and the offline case is
 * meaningless without the worker.
 */
test.describe('Install to the home screen', () => {
  test('carries a stable install identity', async ({ page }) => {
    await page.goto('.')
    const manifest = await (await page.request.get('/m/manifest.webmanifest')).json()

    // Without `id` the install is keyed on `start_url`, so moving where the app
    // opens would register as a different app on the home screen (F-PWA-1).
    expect(manifest.id).toBe('/m/')
    expect(manifest.name).toBe('Cezar')
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toContain('512x512')
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(
      true,
    )
  })

  test('declares itself web-app capable under both the standard and Apple names', async ({
    page,
  }) => {
    await page.goto('.')
    await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute(
      'content',
      'yes',
    )
    await expect(
      page.locator('meta[name="apple-mobile-web-app-capable"]'),
    ).toHaveAttribute('content', 'yes')
  })

  test('orders theme-color so the per-scheme tags are not shadowed', async ({ page }) => {
    await page.goto('.')
    const metas = await page
      .locator('meta[name="theme-color"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          media: node.getAttribute('media'),
          content: node.getAttribute('content'),
        })),
      )

    // The browser takes the first theme-color whose media matches, and an
    // absent media matches everything — so the bare fallback must come last.
    expect(metas.length).toBeGreaterThan(1)
    expect(metas.findIndex((meta) => meta.media === null)).toBe(metas.length - 1)
    expect(metas.find((meta) => meta.media?.includes('light'))?.content).toBe('#ffffff')
    expect(metas.find((meta) => meta.media?.includes('dark'))?.content).toBe('#0b1117')
  })

  test('tells the operator how to install, since iOS offers no prompt', async ({ page }) => {
    await page.goto('.')
    // A Playwright page is a browser tab, never standalone, so the hint shows.
    await expect(page.getByText('Dodaj Cezara do ekranu początkowego')).toBeVisible()
    await expect(page.getByText(/Udostępnij/)).toBeVisible()
  })

  test('says plainly when the network goes, and stops saying it when it returns (FR-002)', async ({
    page,
    context,
  }) => {
    await page.goto('.')
    const banner = page.getByRole('status').filter({ hasText: /Brak połączenia/ })
    await expect(banner).toHaveCount(0)

    await context.setOffline(true)
    try {
      await expect(banner).toBeVisible()
    } finally {
      await context.setOffline(false)
    }
    await expect(banner).toHaveCount(0)
  })

  /**
   * The offline *navigation* itself cannot be driven here: WebKit under
   * Playwright fails internally on any navigation a service worker serves
   * while the context is offline (both `goto` and `reload`, and `route.abort`
   * cuts the navigation before the worker ever sees it). So this asserts the
   * two things that decide whether that navigation can succeed — the worker
   * takes control, and the shell it would serve is in the precache — and the
   * cold offline launch stays on the device checklist in
   * `context/changes/install-to-home-screen/plan.md`.
   */
  test('precaches the whole shell and nothing from the API (F-PWA-3)', async ({ page }) => {
    await page.goto('.')

    // `registerType: 'prompt'` means no clientsClaim, so the worker that just
    // installed does not control this page yet — the next navigation is the
    // first one it serves.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
    await page.reload()
    await page.waitForFunction(() => !!navigator.serviceWorker.controller)

    const cached = await page.evaluate(async () => {
      const paths: string[] = []
      for (const name of await caches.keys()) {
        const cache = await caches.open(name)
        for (const request of await cache.keys()) paths.push(new URL(request.url).pathname)
      }
      return paths
    })

    // The document the navigation fallback is bound to. `createHandlerBoundToURL`
    // throws at worker startup when this key is absent, so the worker reaching
    // "controlling" above already proves the binding resolves — this pins the
    // key itself, which moves if `base` ever changes.
    expect(cached).toContain('/m/index.html')
    expect(cached.some((path) => path.endsWith('.js'))).toBe(true)
    expect(cached.some((path) => path.endsWith('.css'))).toBe(true)

    // CLAUDE.md rule 4 / F-PWA-3: the worker never caches Cezar's API or a
    // stream, and every precached entry stays inside the /m/ scope.
    expect(cached.filter((path) => !path.startsWith('/m/'))).toEqual([])
  })
})
