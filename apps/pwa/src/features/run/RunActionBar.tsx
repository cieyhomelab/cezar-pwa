import { Link } from 'react-router'
import { type ActionRun, type ConfirmedActionId, type RunActionId, runActionFlags } from '../../domain/run-actions.ts'
import { en } from '../../i18n/en.ts'
import type { RunActions } from './useRunActions.ts'

const BASE = 'touch-target inline-flex items-center justify-center rounded px-4 text-sm disabled:opacity-60'
const isConfirmed = (id: RunActionId): id is ConfirmedActionId => id === 'cancel' || id === 'cancelAutoResume'

const STYLE = {
  primary: `${BASE} bg-accent font-semibold text-white`,
  outline: `${BASE} border border-border bg-surface-raised text-text`,
  danger: `${BASE} border border-danger/50 text-danger`,
  dangerSolid: `${BASE} bg-danger font-semibold text-white`,
} as const

/**
 * S-08: the task's own actions under the header (FR-025 to FR-030). Which buttons exist is
 * `runActionFlags`, the cockpit's policy. The component only lays them out, gates cancel and
 * cancel auto-resume behind a confirmation, and shows what is in flight and why a tap failed (FR-032).
 *
 * `busy` is a send in flight from the composer or the question card. An action waits for it: a
 * continue racing a resumed answer would reach the agent in an order nobody chose.
 */
export function RunActionBar({ run, actions, busy }: { run: ActionRun; actions: RunActions; busy: boolean }) {
  const flags = runActionFlags(run)
  const t = en.run.actions
  const disabled = busy || actions.pending !== undefined

  const button = (id: RunActionId, style: string, idle: string, working: string) => (
    <button
      type="button"
      className={style}
      disabled={disabled}
      onClick={() => (isConfirmed(id) ? actions.ask(id) : void actions.run(id))}
      {...(id === 'pin' ? { 'aria-pressed': run.pinned === true } : {})}
    >
      {actions.pending === id ? working : idle}
    </button>
  )

  // The flag is re-checked: a record that moved on while the question was open withdraws it.
  const confirming = actions.confirming
  if (confirming !== undefined && flags[confirming]) {
    const copy = confirming === 'cancel' ? t.confirmCancel : t.confirmCancelAutoResume
    return (
      <section
        role="alertdialog"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        className="flex flex-col gap-2 border-b border-border bg-surface-raised px-4 py-3"
      >
        <h3 id="confirm-title" className="font-semibold">
          {copy.title}
        </h3>
        <p id="confirm-body" className="text-sm text-text-muted">
          {copy.body}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={STYLE.outline} onClick={actions.keep}>
            {copy.keep}
          </button>
          <button
            type="button"
            className={STYLE.dangerSolid}
            disabled={disabled}
            onClick={() => void actions.run(confirming)}
          >
            {copy.confirm}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section aria-label={t.label} className="flex flex-col gap-2 border-b border-border px-4 py-3">
      <div className="flex flex-wrap gap-2">
        {flags.finish ? button('finish', STYLE.primary, t.finish[run.status] ?? t.finish.waiting!, t.finishing) : null}
        {flags.draftPr ? button('draftPr', STYLE.outline, t.draftPr, t.draftPrPending) : null}
        {flags.continueRun ? button('continue', STYLE.outline, t.continue, t.continuing) : null}
        {flags.pin ? button('pin', STYLE.outline, run.pinned ? t.unpin : t.pin, t.pinning) : null}
        {flags.archive ? button('archive', STYLE.outline, run.archived ? t.unarchive : t.archive, t.archiving) : null}
        {flags.cancelAutoResume
          ? button('cancelAutoResume', STYLE.danger, t.cancelAutoResume, t.cancellingAutoResume)
          : null}
        {/* #93: waiting for a limit reset — how far off it is lives on the Limits screen. */}
        {flags.cancelAutoResume ? (
          <Link to="/limits" className={STYLE.outline}>
            {t.seeLimits}
          </Link>
        ) : null}
        {flags.cancel ? button('cancel', STYLE.danger, t.cancel, t.cancelling) : null}
      </div>
      {actions.error ? (
        <p role="alert" className="text-sm break-words text-danger">
          {actions.error}
        </p>
      ) : actions.notice ? (
        <p role="status" className="text-sm text-text-muted">
          {actions.notice}
        </p>
      ) : null}
    </section>
  )
}
