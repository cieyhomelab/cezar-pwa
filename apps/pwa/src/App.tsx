import { useRegisterSW } from 'virtual:pwa-register/react'
import { AuthGate } from './features/auth/AuthGate.tsx'
import { pl } from './i18n/pl.ts'
import { InstallHint } from './pwa/InstallHint.tsx'
import { OfflineBanner } from './pwa/OfflineBanner.tsx'
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx'
import { useOnlineStatus } from './pwa/useOnlineStatus.ts'
import { useStandalone } from './pwa/useStandalone.ts'

/**
 * The frame the later milestones fill in: app chrome, the safe-area layout and
 * the three installation-slice affordances (S-01: install, offline, update),
 * wrapped around the session gate (S-02). The chrome stays outside the gate on
 * purpose — the update prompt and the offline banner must still reach an
 * operator whose session has lapsed.
 *
 * The browser-facing state lives in the hooks; everything below is wiring.
 */
export default function App() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  const online = useOnlineStatus()
  const standalone = useStandalone()

  return (
    <div className="flex min-h-full flex-col bg-surface text-text">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/90 px-4 py-3 backdrop-blur">
        <h1 className="text-lg font-semibold">{pl.app.name}</h1>
        <p className="text-sm text-text-muted">{pl.app.tagline}</p>
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
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <p className="text-text-muted">{pl.shell.empty}</p>
          </div>
        </AuthGate>
      </main>

      <footer className="border-t border-border px-4 py-3">
        {/* Same-origin link to the full cockpit — the PWA is deliberately a
            subset of it (REQUIREMENTS §1). */}
        <a className="touch-target inline-flex items-center text-sm text-accent" href="/">
          {pl.shell.openCockpit}
        </a>
      </footer>
    </div>
  )
}
