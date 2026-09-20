import { useState } from 'react'

/**
 * iOS Safari's pre-standard flag. Safari only began reporting the standard
 * `display-mode` media feature recently, so on the phones this product targets
 * it is often the only signal that the app was launched from the icon.
 */
type IosNavigator = Navigator & { standalone?: boolean }

/** True when the app is running from the home-screen icon rather than a tab. */
export function isStandalone(): boolean {
  if ((navigator as IosNavigator).standalone === true) return true
  return window.matchMedia?.('(display-mode: standalone)').matches === true
}

/**
 * Read once, not subscribed to: a session cannot move between a browser tab and
 * the installed app — the installed app is a separate context with its own
 * cookies (PRD § Perimeter facts).
 */
export function useStandalone(): boolean {
  const [standalone] = useState(isStandalone)
  return standalone
}
