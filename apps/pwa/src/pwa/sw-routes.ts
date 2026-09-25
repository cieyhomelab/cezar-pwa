/**
 * What the service worker's navigation fallback must never answer from the precache (CLAUDE.md
 * rule 4). Tested against pathname + search, as workbox's `NavigationRoute` does.
 *
 * - `/api/` is Cezar, and its streams must stay unbuffered.
 * - `/m/push/` is the sidecar — including `GET /m/push/limits` (#93), whose reading must always
 *   be the sidecar's current one, never a copy the worker kept.
 * - `?key=` is the unlock navigation (S-02). It MUST reach the network: the gateway can only
 *   issue the session cookie for a request it actually sees, and answering this one from the
 *   precache would make unlocking silently impossible.
 */
export const NAVIGATION_DENYLIST: readonly RegExp[] = [/^\/api\//, /^\/m\/push\//, /[?&]key=/]

/** True when a navigation to `pathAndSearch` must go to the network. */
export function bypassesShell(pathAndSearch: string): boolean {
  return NAVIGATION_DENYLIST.some((pattern) => pattern.test(pathAndSearch))
}
