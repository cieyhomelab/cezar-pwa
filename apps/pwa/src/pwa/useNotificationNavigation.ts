import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { appPathFor, NAVIGATE_MESSAGE } from './push-message.ts'

/**
 * FR-041, the page half: when a notification is tapped while the app is already open, the worker
 * focuses this window and posts where to go; the router goes there in place, keeping what the app
 * already loaded. Anything that is not a path inside the app is ignored.
 */
export function useNotificationNavigation(): void {
  const navigate = useNavigate()

  useEffect(() => {
    const container = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker
    if (!container) return
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null
      if (data?.type !== NAVIGATE_MESSAGE) return
      const path = appPathFor(data.url, window.location.origin)
      if (path !== undefined) navigate(path)
    }
    container.addEventListener('message', onMessage)
    // Messages wait in a queue until the page says it is listening.
    container.startMessages?.()
    return () => container.removeEventListener('message', onMessage)
  }, [navigate])
}
