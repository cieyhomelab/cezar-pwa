import { type ActionRun, type RunActionId, runActionFlags } from '../../domain/run-actions.ts'
import { pl } from '../../i18n/pl.ts'
import type { RunActions } from './useRunActions.ts'

const BASE = 'touch-target inline-flex items-center justify-center rounded px-4 text-sm disabled:opacity-60'
const STYLE = {
  primary: `${BASE} bg-accent font-semibold text-white`,
  outline: `${BASE} border border-border bg-surface-raised text-text`,
  danger: `${BASE} border border-danger/50 text-danger`,
  dangerSolid: `${BASE} bg-danger font-semibold text-white`,
} as const

/**
 * S-08: the task's own actions under the header (FR-025 to FR-029). Which buttons exist is
 * `runActionFlags`, the cockpit's policy. The component only lays them out, gates cancel behind
 * a confirmation, and shows what is in flight and why a tap failed (FR-032).
 *
 * `busy` is a send in flight from the composer or the question card. An action waits for it: a
 * continue racing a resumed answer would reach the agent in an order nobody chose.
 */
export function RunActionBar({ run, actions, busy }: { run: ActionRun; actions: RunActions; busy: boolean }) {
  const flags = runActionFlags(run)
  const t = pl.run.actions
  const disabled = busy || actions.pending !== undefined

  const button = (id: RunActionId, style: string, idle: string, working: string) => (
    <button
      type="button"
      className={style}
      disabled={disabled}
      onClick={() => (id === 'cancel' ? actions.askCancel() : void actions.run(id))}
      {...(id === 'pin' ? { 'aria-pressed': run.pinned === true } : {})}
    >
      {actions.pending === id ? working : idle}
    </button>
  )

  if (actions.confirmingCancel && flags.cancel) {
    return (
      <section
        role="alertdialog"
        aria-labelledby="cancel-title"
        aria-describedby="cancel-body"
        className="flex flex-col gap-2 border-b border-border bg-surface-raised px-4 py-3"
      >
        <h3 id="cancel-title" className="font-semibold">
          {t.confirmCancel.title}
        </h3>
        <p id="cancel-body" className="text-sm text-text-muted">
          {t.confirmCancel.body}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={STYLE.outline} onClick={actions.keep}>
            {t.confirmCancel.keep}
          </button>
          <button
            type="button"
            className={STYLE.dangerSolid}
            disabled={disabled}
            onClick={() => void actions.run('cancel')}
          >
            {t.confirmCancel.confirm}
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
