import { useEffect } from 'react'
import { resyncSubscription } from './subscription-sync.ts'

/**
 * S-11, the page half of `subscription-sync.ts`: once per launch of the installed app, re-register
 * this device's subscription with the sidecar. iOS does not reliably fire `pushsubscriptionchange`,
 * so opening the app is when a replaced subscription gets noticed. Quiet by design — a failure here
 * is Settings' to report, when the operator looks.
 */
export function useSubscriptionSync(standalone: boolean): void {
  useEffect(() => {
    if (!standalone || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const container = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker
    if (!container) return
    container.ready.then((registration) => resyncSubscription(registration.pushManager)).catch(() => {})
  }, [standalone])
}
