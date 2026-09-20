import { useRegisterSW } from 'virtual:pwa-register/react'
import { pl } from './i18n/pl.ts'
import { InstallHint } from './pwa/InstallHint.tsx'
import { OfflineBanner } from './pwa/OfflineBanner.tsx'
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx'
import { useOnlineStatus } from './pwa/useOnlineStatus.ts'
import { useStandalone } from './pwa/useStandalone.ts'

/**
 * M0 shell: the frame the later milestones fill in. It renders the app chrome,
 * the safe-area layout and the three installation-slice affordances (S-01:
 * install, offline, update) — nothing that talks to Cezar yet.
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

      <main className="flex flex-1 items-center justify-center px-6 text-center">
        <p className="text-text-muted">{pl.shell.empty}</p>
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
