import { en } from '../../i18n/en.ts'
import type { SignOutState } from './useSignOut.ts'

const BASE = 'touch-target inline-flex items-center justify-center rounded px-4 text-sm disabled:opacity-60'
const STYLE = {
  outline: `${BASE} border border-border bg-surface-raised text-text`,
  danger: `${BASE} border border-danger/50 text-danger`,
  dangerSolid: `${BASE} bg-danger font-semibold text-white`,
} as const

/**
 * FR-006: sign out, behind a confirmation. The state lives in `SettingsScreen`, which also keys the
 * other sections on it; this only lays it out, like `RunActionBar` does for a task's actions.
 */
export function SignOutSection({ signOut }: { signOut: SignOutState }) {
  const t = en.settings.signOut

  if (signOut.confirming) {
    return (
      <section
        role="alertdialog"
        aria-labelledby="signout-title"
        aria-describedby="signout-body"
        className="flex flex-col gap-2 border-b border-border bg-surface-raised px-4 py-3"
      >
        <h3 id="signout-title" className="font-semibold">
          {t.confirmTitle}
        </h3>
        <p id="signout-body" className="text-sm text-text-muted">
          {t.confirmBody}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={STYLE.outline} disabled={signOut.busy} onClick={signOut.cancel}>
            {t.keep}
          </button>
          <button type="button" className={STYLE.dangerSolid} disabled={signOut.busy} onClick={signOut.confirm}>
            {signOut.busy ? t.working : t.confirm}
          </button>
        </div>
      </section>
    )
  }

  const result = signOut.result
  return (
    <section aria-labelledby="signout-heading" className="flex flex-col gap-3 border-b border-border px-4 py-3">
      <h3 id="signout-heading" className="font-semibold">
        {t.section}
      </h3>
      <p className="text-sm text-text-muted">{t.intro}</p>
      {result && !result.sessionEnded ? (
        <p role="alert" className="text-sm break-words text-danger">
          {t.sessionKept}
        </p>
      ) : null}
      {result && !result.notificationsStopped ? (
        <p role="alert" className="text-sm break-words text-danger">
          {t.notificationsKept}
        </p>
      ) : null}
      <div>
        <button type="button" className={STYLE.danger} onClick={signOut.ask}>
          {result ? t.retry : t.action}
        </button>
      </div>
    </section>
  )
}
