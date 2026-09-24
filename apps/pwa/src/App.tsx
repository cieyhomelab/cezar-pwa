import { Link, Outlet } from 'react-router'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { AuthGate } from './features/auth/AuthGate.tsx'
import { en } from './i18n/en.ts'
import { InstallHint } from './pwa/InstallHint.tsx'
import { OfflineBanner } from './pwa/OfflineBanner.tsx'
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx'
import { watchForUpdates } from './pwa/sw-update.ts'
import { useNotificationNavigation } from './pwa/useNotificationNavigation.ts'
import { useOnlineStatus } from './pwa/useOnlineStatus.ts'
import { useStandalone } from './pwa/useStandalone.ts'
import { useSubscriptionSync } from './pwa/useSubscriptionSync.ts'

/**
 * App chrome, the safe-area layout and the three installation-slice
 * affordances (S-01: install, offline, update), wrapped around the session gate
 * (S-02), which guards the screens in `routes.tsx` (the list, S-03; a task, S-05).
 * The chrome stays outside the gate on purpose — the update prompt and the
 * offline banner must still reach an operator whose session has lapsed.
 *
 * The browser-facing state lives in the hooks; everything below is wiring.
 */
export default function App() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // FR-003: a resumed iOS app never navigates, so it has to ask for the check itself.
    onRegisteredSW: (_url, registration) => {
      if (registration) watchForUpdates(registration)
    },
  })
  const online = useOnlineStatus()
  const standalone = useStandalone()
  // S-10: a notification tapped while the app is open routes this window (FR-041).
  useNotificationNavigation()
  // S-11: the sidecar keeps knowing this device, even after the push service replaced it.
  useSubscriptionSync(standalone)

  return (
    <div className="flex min-h-full flex-col bg-surface text-text">
      {/* Not sticky: on a phone the brand is not worth a permanent strip, and the task screen
          pins its own bar (back link and plan) to the top. */}
      <header className="border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">{en.app.name}</h1>
        <p className="text-sm text-text-muted">{en.app.tagline}</p>
      </header>

      <OfflineBanner online={online} />

      <UpdatePrompt
        needRefresh={needRefresh}
        onDismiss={() => setNeedRefresh(false)}
        onUpdate={() => void updateServiceWorker(true)}
      />

      <InstallHint standalone={standalone} />

      <main className="flex flex-1 flex-col">
        {/* S-02: nothing past this point renders without a session. */}
        <AuthGate>
          <Outlet />
        </AuthGate>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-x-4 border-t border-border px-4 py-3">
        {/* Same-origin link to the full cockpit — the PWA is deliberately a
            subset of it (REQUIREMENTS §1). */}
        <a className="touch-target inline-flex items-center text-sm text-accent" href="/">
          {en.shell.openCockpit}
        </a>
        {/* S-10: notifications are turned on in Settings (FR-036). */}
        <Link className="touch-target inline-flex items-center text-sm text-accent" to="/settings">
          {en.settings.open}
        </Link>
      </footer>
    </div>
  )
}
