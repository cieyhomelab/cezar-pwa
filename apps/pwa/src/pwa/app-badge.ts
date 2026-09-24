/**
 * The Badging API, called defensively (#68, FR-042, PRD Open Question 4). TEMPORARY: this exists so
 * the operator can find out on the device whether an icon badge works in the installed app at all.
 * Once the answer is recorded in the roadmap, delete this module, `BadgeCheckSection` and the
 * worker's test-push badge — or grow them into FR-042 if the answer is yes.
 *
 * Shared by the page and the service worker: `navigator` is a `WorkerNavigator` there, and both
 * carry the same two methods where the platform supports them.
 */

type BadgeNavigator = {
  setAppBadge?: (contents?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

export type BadgeOutcome = { ok: true } | { ok: false; reason: 'unsupported' } | { ok: false; reason: 'failed'; message: string }

/** Whether the platform exposes the API at all — not whether the home screen draws it. */
export function badgeSupported(nav: object): boolean {
  const badge = nav as BadgeNavigator
  return typeof badge.setAppBadge === 'function' && typeof badge.clearAppBadge === 'function'
}

/**
 * Sets the badge to `count`, or clears it on `null`. Never throws: a rejection is the answer the
 * check is looking for, so it comes back as data.
 */
export async function applyBadge(nav: object, count: number | null): Promise<BadgeOutcome> {
  if (!badgeSupported(nav)) return { ok: false, reason: 'unsupported' }
  const badge = nav as Required<BadgeNavigator>
  try {
    if (count === null) await badge.clearAppBadge()
    else await badge.setAppBadge(count)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    return { ok: false, reason: 'failed', message }
  }
}
