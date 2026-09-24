import { expect, test } from '@playwright/test'

/**
 * FR-003: a deploy reaches an installed app that is only ever resumed. iOS brings a home-screen
 * app back from memory without a navigation, so the browser never re-checks `/m/sw.js` on its
 * own; on the operator's iPhone no deploy arrived for a day (2026-09-24). The app asks for the
 * check when it comes back to the foreground.
 */

test('coming back to the foreground checks for a new version', async ({ page }) => {
  await page.clock.install()
  // Count checks without stopping them: the real update still runs.
  await page.addInitScript(() => {
    const original = ServiceWorkerRegistration.prototype.update
    ;(window as unknown as { updateChecks: number }).updateChecks = 0
    ServiceWorkerRegistration.prototype.update = function (this: ServiceWorkerRegistration) {
      ;(window as unknown as { updateChecks: number }).updateChecks += 1
      return original.call(this)
    }
  })
  await page.goto('.')
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))

  const checks = () => page.evaluate(() => (window as unknown as { updateChecks: number }).updateChecks)
  const resume = () =>
    page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })

  // The registration has only just checked: an app switch within the minute is not another.
  await expect.poll(checks).toBe(0)
  await resume()
  expect(await checks()).toBe(0)

  await page.clock.fastForward(61_000)
  await resume()
  expect(await checks()).toBe(1)
})
