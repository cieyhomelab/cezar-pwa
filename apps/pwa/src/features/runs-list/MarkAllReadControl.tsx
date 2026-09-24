import type { ReadAllPlan } from '../../domain/read-all.ts'
import { en } from '../../i18n/en.ts'
import type { MarkAllRead } from './useMarkAllRead.ts'

const BASE = 'touch-target inline-flex items-center justify-center rounded px-3 text-sm disabled:opacity-60'
const STYLE = {
  outline: `${BASE} border border-border bg-surface-raised text-text`,
  solid: `${BASE} bg-accent font-semibold text-white`,
} as const

/**
 * #67: "Mark all read" for the tasks on screen, behind one confirmation that names the projects
 * it will reach. Hidden while nothing on screen is unread — unless there is an outcome to report.
 * The state lives in `useMarkAllRead`; this only lays it out, like `SignOutSection`.
 */
export function MarkAllReadControl({
  plan,
  readAll,
  projectName,
}: {
  plan: ReadAllPlan
  readAll: MarkAllRead
  projectName: (projectId: string) => string
}) {
  const t = en.runs.readAll

  const asked = readAll.confirming
  if (asked) {
    return (
      <section
        role="alertdialog"
        aria-labelledby="read-all-title"
        aria-describedby="read-all-body"
        className="flex flex-col gap-2 rounded border border-border bg-surface-raised px-3 py-3"
      >
        <h3 id="read-all-title" className="font-semibold">
          {t.confirmTitle(asked.unread)}
        </h3>
        <p id="read-all-body" className="text-sm text-text-muted">
          {t.confirmBody(asked.projects.map(projectName).join(', '))}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={STYLE.outline} disabled={readAll.busy} onClick={readAll.back}>
            {t.back}
          </button>
          <button
            type="button"
            className={STYLE.solid}
            disabled={readAll.busy}
            aria-busy={readAll.busy}
            onClick={() => void readAll.confirm()}
          >
            {readAll.busy ? t.working : t.confirm}
          </button>
        </div>
      </section>
    )
  }

  const outcome = readAll.outcome
  if (plan.unread === 0 && outcome === undefined) return null

  return (
    <div className="flex flex-col gap-2 text-sm">
      {outcome && outcome.failures.length > 0 ? (
        <div role="alert" className="flex flex-col gap-1 break-words text-danger">
          {outcome.failures.map((failure) => (
            <p key={failure.projectId}>{t.failed(projectName(failure.projectId), failure.message)}</p>
          ))}
        </div>
      ) : null}
      {outcome && outcome.read > 0 ? (
        <p role="status" className="text-text-muted">
          {t.done(outcome.read)}
        </p>
      ) : null}
      {plan.unread > 0 ? (
        <div>
          <button type="button" className={STYLE.outline} onClick={() => readAll.ask(plan)}>
            {t.action(plan.unread)}
          </button>
        </div>
      ) : null}
    </div>
  )
}
