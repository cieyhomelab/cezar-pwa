import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { type AttentionInput, deriveAttention } from '@cezar-pwa/shared'
import { automationLogQueryOptions, automationsQueryOptions } from '../../api/automations.ts'
import { HEALTH_QUERY_KEY, healthQueryOptions } from '../../api/health.ts'
import { AuthRequiredError } from '../../api/http.ts'
import {
  type AutomationRow,
  automationRows,
  isFailureResult,
  type LogRow,
  logRows,
  resultText,
} from '../../domain/automations.ts'
import { clockTime } from '../../domain/run-display.ts'
import { runPath } from '../../domain/run-header.ts'
import { apiErrorDetail } from '../../i18n/errors.ts'
import { en } from '../../i18n/en.ts'
import { PROJECT_PARAM } from '../new-task/NewTaskScreen.tsx'
import { StatusBadge } from '../runs-list/StatusBadge.tsx'
import { useNow } from '../runs-list/useNow.ts'
import { type AutomationActions, useAutomationActions } from './useAutomationActions.ts'

/** The log answers up to 100 rows; a phone shows the newest few until asked. */
export const LOG_VISIBLE = 10

const BASE = 'touch-target inline-flex items-center justify-center rounded px-4 text-sm disabled:opacity-60'
const PRIMARY = `${BASE} bg-accent font-semibold text-white`
const OUTLINE = `${BASE} border border-border bg-surface-raised text-text`

function AutomationItem({
  row,
  projectId,
  actions,
  now,
}: {
  row: AutomationRow
  projectId: string
  actions: AutomationActions
  now: number
}) {
  const t = en.automations
  const busy = actions.pending !== undefined
  const pendingHere = actions.pending?.automationId === row.id ? actions.pending.action : undefined
  const outcome = actions.outcome?.automationId === row.id ? actions.outcome : undefined
  const titleId = `automation-${row.id}`

  return (
    <li aria-labelledby={titleId} className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={titleId} className="font-semibold break-words">
            {row.name}
          </h3>
          <p className="text-sm text-text-muted">{row.trigger}</p>
        </div>
        <span className={`shrink-0 text-sm font-semibold ${row.enabled ? 'text-success' : 'text-text-muted'}`}>
          {row.enabled ? t.enabled : t.paused}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
        <span>{row.lastRun ? t.lastRun(clockTime(row.lastRun.at, now)) : t.neverRun}</span>
        {row.lastRun?.status ? (
          <StatusBadge
            attention={deriveAttention({ status: row.lastRun.status } as AttentionInput)}
            status={row.lastRun.status}
          />
        ) : null}
        {row.nextRunAt ? <span>{t.nextRun(clockTime(row.nextRunAt, now))}</span> : null}
      </div>
      {row.lastRun?.runId ? (
        <Link to={runPath(projectId, row.lastRun.runId)} className="touch-target inline-flex items-center text-sm text-accent">
          {t.openLastRun}
        </Link>
      ) : null}

      {actions.confirmingRun === row.id ? (
        <div
          role="alertdialog"
          aria-labelledby={`${titleId}-confirm`}
          aria-describedby={`${titleId}-confirm-body`}
          className="flex flex-col gap-2 rounded bg-surface-raised p-3"
        >
          <h4 id={`${titleId}-confirm`} className="font-semibold">
            {t.confirmRun.title(row.name)}
          </h4>
          <p id={`${titleId}-confirm-body`} className="text-sm text-text-muted">
            {t.confirmRun.body}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={OUTLINE} onClick={actions.back}>
              {t.confirmRun.back}
            </button>
            <button
              type="button"
              className={PRIMARY}
              disabled={busy}
              onClick={() => void actions.perform(row.id, row.name, 'run')}
            >
              {t.confirmRun.confirm}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {row.enabled ? (
            <button
              type="button"
              className={OUTLINE}
              disabled={busy}
              onClick={() => void actions.perform(row.id, row.name, 'pause')}
            >
              {pendingHere === 'pause' ? t.pausing : t.pause}
            </button>
          ) : (
            <button
              type="button"
              className={OUTLINE}
              disabled={busy}
              onClick={() => void actions.perform(row.id, row.name, 'enable')}
            >
              {pendingHere === 'enable' ? t.enabling : t.enable}
            </button>
          )}
          {/* A GitHub poll answers `/run` with 409: it runs through `/check`, which stays in the cockpit. */}
          {row.canRunNow ? (
            <button type="button" className={PRIMARY} disabled={busy} onClick={() => actions.askRun(row.id)}>
              {pendingHere === 'run' ? t.running : t.runNow}
            </button>
          ) : null}
        </div>
      )}

      {outcome?.error ? (
        <p role="alert" className="text-sm break-words text-danger">
          {outcome.error}
        </p>
      ) : outcome?.notice ? (
        <p role="status" className="flex flex-wrap items-center gap-x-2 text-sm text-text-muted">
          <span>{outcome.notice}</span>
          {outcome.runId ? (
            <Link to={runPath(projectId, outcome.runId)} className="touch-target inline-flex items-center text-accent">
              {t.done.openTask}
            </Link>
          ) : null}
        </p>
      ) : null}
    </li>
  )
}

function LogLine({ row, projectId, now }: { row: LogRow; projectId: string; now: number }) {
  return (
    <li className="flex flex-col gap-0.5 px-4 py-2 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 font-semibold break-words">{row.automationName}</span>
        <span className="shrink-0 text-text-muted">{clockTime(row.at, now)}</span>
      </div>
      <p className={isFailureResult(row.result) ? 'text-danger' : 'text-text-muted'}>
        {resultText(row.result)}
        {row.github ? ` · ${row.github}` : ''}
      </p>
      {row.reason ? <p className="break-words text-text-muted">{row.reason}</p> : null}
      {row.run ? (
        <Link to={runPath(projectId, row.run.id)} className="touch-target inline-flex items-center text-accent">
          {row.run.title ?? row.run.id}
        </Link>
      ) : null}
    </li>
  )
}

function AutomationLog({ projectId, names, now }: { projectId: string; names: ReadonlyMap<string, string>; now: number }) {
  const t = en.automations.log
  const log = useQuery(automationLogQueryOptions(projectId))
  const [showAll, setShowAll] = useState(false)
  const rows = useMemo(() => (log.data ? logRows(log.data, names) : []), [log.data, names])
  const shown = showAll ? rows : rows.slice(0, LOG_VISIBLE)

  return (
    <section aria-labelledby="automation-log" className="flex flex-col border-t border-border">
      <h3 id="automation-log" className="px-4 pt-4 pb-1 text-xs font-semibold tracking-wide text-text-muted uppercase">
        {t.title}
      </h3>
      {log.data === undefined ? (
        log.isError && !(log.error instanceof AuthRequiredError) ? (
          <div className="flex flex-col gap-2 px-4 py-2 text-sm">
            <p>{t.loadFailed}</p>
            {apiErrorDetail(log.error) ? <p className="text-text-muted">{apiErrorDetail(log.error)}</p> : null}
          </div>
        ) : (
          <p role="status" className="px-4 py-2 text-sm text-text-muted">
            {t.loading}
          </p>
        )
      ) : rows.length === 0 ? (
        <p className="px-4 py-2 text-sm text-text-muted">{t.empty}</p>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {shown.map((row) => (
              <LogLine key={row.key} row={row} projectId={projectId} now={now} />
            ))}
          </ul>
          {rows.length > shown.length ? (
            <button type="button" className="touch-target w-full px-4 text-sm text-accent" onClick={() => setShowAll(true)}>
              {t.showAll(rows.length - shown.length)}
            </button>
          ) : null}
        </>
      )}
    </section>
  )
}

function ProjectAutomations({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const t = en.automations
  const now = useNow()
  const automations = useQuery(automationsQueryOptions(projectId))
  const actions = useAutomationActions(projectId)
  const rows = useMemo(() => (automations.data ? automationRows(automations.data) : []), [automations.data])
  const names = useMemo(() => new Map(rows.map((row) => [row.id, row.name])), [rows])

  // A refusal means the session lapsed: the gate knows how to say so (FR-004).
  const refused = automations.error instanceof AuthRequiredError
  useEffect(() => {
    if (refused) void queryClient.invalidateQueries({ queryKey: HEALTH_QUERY_KEY })
  }, [refused, queryClient])

  if (automations.data === undefined) {
    if (automations.isError && !refused) {
      return (
        <section className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p>{t.loadFailed}</p>
          {apiErrorDetail(automations.error) ? (
            <p className="text-sm text-text-muted">{apiErrorDetail(automations.error)}</p>
          ) : null}
          <button
            type="button"
            className="touch-target rounded border border-border px-4 text-sm"
            onClick={() => void automations.refetch()}
            disabled={automations.isFetching}
          >
            {t.retry}
          </button>
        </section>
      )
    }
    return (
      <p role="status" className="flex flex-1 items-center justify-center px-6 text-text-muted">
        {t.loading}
      </p>
    )
  }

  const reason = typeof automations.data.reason === 'string' ? automations.data.reason : undefined

  return (
    <div className="flex flex-col">
      {automations.data.available === false ? (
        // A GitHub poll cannot fire while this holds; a schedule still can, so the list stays.
        <div role="note" className="mx-4 mb-2 rounded bg-surface-raised px-3 py-2 text-sm">
          {t.unavailable} {reason ?? ''}
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="px-6 py-8 text-center text-text-muted">{t.empty}</p>
      ) : (
        <ul aria-label={t.title} className="divide-y divide-border">
          {rows.map((row) => (
            <AutomationItem key={row.id} row={row} projectId={projectId} actions={actions} now={now} />
          ))}
        </ul>
      )}
      <AutomationLog projectId={projectId} names={names} now={now} />
    </div>
  )
}

/**
 * S-20 (#70): a project's automations, read-only, with Pause, Enable and Run now, and the recent
 * automation log. Creating, editing, deleting and `/check` previews stay in the cockpit (N05).
 *
 * Behind `health.capabilities.automations`: with it off every route of the family answers 409, so
 * the screen says so instead of asking. Rendered behind `AuthGate`, so the probe has answered.
 */
export function AutomationsScreen() {
  const t = en.automations
  const [params, setParams] = useSearchParams()
  const health = useQuery(healthQueryOptions())
  const projects = health.data?.projects ?? []
  const enabled = health.data?.capabilities?.automations === true
  const chosen = params.get(PROJECT_PARAM)
  const projectId =
    projects.find((project) => project.id === chosen)?.id ??
    projects.find((project) => project.id === health.data?.bootProject)?.id ??
    projects[0]?.id

  return (
    <div className="flex flex-1 flex-col">
      <div className="sticky top-0 z-20 flex h-11 items-center border-b border-border bg-surface px-2">
        <Link to="/" className="touch-target inline-flex items-center px-2 text-accent">
          <span aria-hidden="true">‹&nbsp;</span>
          {t.back}
        </Link>
      </div>
      <h2 className="px-4 pt-3 text-lg font-semibold">{t.title}</h2>

      {!enabled ? (
        <p className="px-6 py-8 text-center text-text-muted">{t.off}</p>
      ) : (
        <>
          {projects.length > 1 ? (
            <label className="flex items-center gap-2 px-4 py-3 text-sm">
              <span className="text-text-muted">{t.project}</span>
              <select
                className="touch-target flex-1 rounded border border-border bg-surface-raised px-2 text-text"
                value={projectId ?? ''}
                onChange={(event) => setParams({ [PROJECT_PARAM]: event.target.value }, { replace: true })}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="h-3" />
          )}
          {projectId !== undefined ? <ProjectAutomations key={projectId} projectId={projectId} /> : null}
        </>
      )}
    </div>
  )
}
