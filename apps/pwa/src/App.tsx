import { useRegisterSW } from 'virtual:pwa-register/react'
import { pl } from './i18n/pl.ts'

/**
 * M0 shell: the frame the later milestones fill in. It renders the app chrome,
 * the safe-area layout and the service-worker update prompt — nothing that
 * talks to Cezar yet.
 */
export default function App() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  return (
    <div className="flex min-h-full flex-col bg-surface text-text">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/90 px-4 py-3 backdrop-blur">
        <h1 className="text-lg font-semibold">{pl.app.name}</h1>
        <p className="text-sm text-text-muted">{pl.app.tagline}</p>
      </header>

      {needRefresh && (
        // F-PWA-5: never swap the worker under the user's hands.
        <div
          role="status"
          className="flex items-center justify-between gap-3 border-b border-border bg-surface-raised px-4 py-2"
        >
          <span className="text-sm">{pl.update.available}</span>
          <div className="flex gap-2">
            <button
              type="button"
              className="touch-target rounded px-3 text-sm text-text-muted"
              onClick={() => setNeedRefresh(false)}
            >
              {pl.update.dismiss}
            </button>
            <button
              type="button"
              className="touch-target rounded bg-accent px-3 text-sm font-medium text-white"
              onClick={() => void updateServiceWorker(true)}
            >
              {pl.update.action}
            </button>
          </div>
        </div>
      )}

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
