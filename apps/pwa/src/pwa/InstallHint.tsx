import { useState } from 'react'
import { en } from '../i18n/en.ts'

/**
 * FR-001, the iOS branch. Safari never fires `beforeinstallprompt` and Android
 * is a PRD non-goal, so the affordance is a static instruction rather than a
 * captured browser prompt (CLAUDE.md → "iOS specifics").
 *
 * Rendered only outside standalone mode: once the app runs from the icon there
 * is nothing left to install. Dismissal is per-session on purpose — persisting
 * it would mean writing to storage for a hint that retires itself the moment
 * the install lands.
 */
export function InstallHint({ standalone }: { standalone: boolean }) {
  const [dismissed, setDismissed] = useState(false)
  if (standalone || dismissed) return null

  return (
    <aside className="border-b border-border bg-surface-raised px-4 py-3">
      <p className="text-sm font-medium">{en.install.title}</p>
      <p className="mt-1 text-sm text-text-muted">{en.install.ios}</p>
      <button
        type="button"
        className="touch-target inline-flex items-center text-sm text-text-muted"
        onClick={() => setDismissed(true)}
      >
        {en.install.dismiss}
      </button>
    </aside>
  )
}
