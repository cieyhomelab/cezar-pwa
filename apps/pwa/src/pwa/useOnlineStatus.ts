import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

const getSnapshot = () => navigator.onLine

/**
 * Whether the browser currently believes it has a network.
 *
 * FR-002 asks only that the product *say* it is offline, and `navigator.onLine`
 * is the only signal available until a data layer exists. It over-reports — a
 * captive portal reads as online — so it must never be used to vouch for the
 * freshness of data. Real connection health is the event stream's
 * (`api/workspace-events.ts`, S-04); this hook is deliberately not that.
 *
 * `useSyncExternalStore` rather than state-plus-effect because it re-reads the
 * snapshot right after subscribing: a network that drops between the first
 * render and the listeners attaching still lands on screen, even though no
 * event was there to catch it.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot)
}
