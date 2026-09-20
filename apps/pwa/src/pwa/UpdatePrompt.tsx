import { pl } from '../i18n/pl.ts'

type UpdatePromptProps = {
  needRefresh: boolean
  onDismiss: () => void
  onUpdate: () => void
}

/**
 * FR-003 / F-PWA-5: a waiting worker is *offered*, never applied. The other
 * half of the guarantee is `registerType: 'prompt'` in the Vite config —
 * without it the new worker would call `skipWaiting()` on its own and the app
 * would swap under the operator's hands mid-use.
 */
export function UpdatePrompt({ needRefresh, onDismiss, onUpdate }: UpdatePromptProps) {
  if (!needRefresh) return null

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 border-b border-border bg-surface-raised px-4 py-2"
    >
      <span className="text-sm">{pl.update.available}</span>
      <div className="flex gap-2">
        <button
          type="button"
          className="touch-target rounded px-3 text-sm text-text-muted"
          onClick={onDismiss}
        >
          {pl.update.dismiss}
        </button>
        <button
          type="button"
          className="touch-target rounded bg-accent px-3 text-sm font-medium text-white"
          onClick={onUpdate}
        >
          {pl.update.action}
        </button>
      </div>
    </div>
  )
}
