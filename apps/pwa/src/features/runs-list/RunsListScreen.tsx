import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { HEALTH_QUERY_KEY, healthQueryOptions } from '../../api/health.ts'
import { AuthRequiredError } from '../../api/http.ts'
import { runsIndexQueryOptions } from '../../api/runs-index.ts'
import { clockTime } from '../../domain/run-display.ts'
import { readAllPlan } from '../../domain/read-all.ts'
import { attentionCount, buildTaskList } from '../../domain/task-list.ts'
import { apiErrorDetail } from '../../i18n/errors.ts'
import { en } from '../../i18n/en.ts'
import { PROJECT_PARAM } from '../new-task/NewTaskScreen.tsx'
import { ConnectionStatus } from './ConnectionStatus.tsx'
import { MarkAllReadControl } from './MarkAllReadControl.tsx'
import { RunRow } from './RunRow.tsx'
import { useLiveRuns } from './useLiveRuns.ts'
import { useMarkAllRead } from './useMarkAllRead.ts'
import { useNow } from './useNow.ts'
import { useProjectFilter } from './useProjectFilter.ts'
import { usePullToRefresh } from './usePullToRefresh.ts'
import { useScrollAnchor } from './useScrollAnchor.ts'

/** Finished work beyond this many rows waits behind a button: the index can hold 200 runs per
 *  project, and nobody on a phone reads last month's history by scrolling past it. */
export const FINISHED_VISIBLE = 20

/**
 * A list older than this, while a refresh is in flight, is dimmed and marked busy. That is the
 * return-from-suspension case — the interval keeps a visible list younger than this — and the
 * guardrail is that a stale status is never presented as current.
 */
export const STALE_AFTER_MS = 60_000

/**
 * S-03: every task across every project, attention first (US-02, FR-007–009, FR-011, FR-013).
 * S-04: kept current by the workspace event stream, which says whether it is (FR-010, FR-012).
 *
 * Rendered only behind `AuthGate`, so the health probe has already answered and its project
 * list is in the cache.
 */
export function RunsListScreen() {
  const queryClient = useQueryClient()
  const health = useQuery(healthQueryOptions())
  const live = useLiveRuns()
  const runs = useQuery(runsIndexQueryOptions({ live: live.state === 'live' }))
  const now = useNow()
  const [showOlder, setShowOlder] = useState(false)
  const readAll = useMarkAllRead()
  useScrollAnchor(runs.data)

  // A refusal here means the session lapsed since the probe. Re-asking the probe hands the
  // screen to `AuthGate`, which already knows how to say so (FR-004) — rather than this screen
  // inventing a second "not authorized" state.
  useEffect(() => {
    if (runs.error instanceof AuthRequiredError) {
      void queryClient.invalidateQueries({ queryKey: HEALTH_QUERY_KEY })
    }
  }, [runs.error, queryClient])

  const projects = useMemo(() => health.data?.projects ?? [], [health.data])
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  )
  const { projectId, setProject } = useProjectFilter(
    health.data ? projects.map((project) => project.id) : undefined,
  )

  const refresh = () => void runs.refetch()
  const pull = usePullToRefresh(refresh, runs.data !== undefined)

  const all = useMemo(() => buildTaskList(runs.data?.runs ?? [], null), [runs.data])
  const sections = useMemo(
    () => (projectId === null ? all : buildTaskList(runs.data?.runs ?? [], projectId)),
    [all, runs.data, projectId],
  )
  // #67: the rows on screen decide which projects the sweep reaches — the filter included.
  const readAllTargets = useMemo(() => readAllPlan(sections), [sections])

  if (runs.data === undefined) {
    if (runs.isError && !(runs.error instanceof AuthRequiredError)) {
      return (
        <section className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p>{en.runs.loadFailed}</p>
          {apiErrorDetail(runs.error) ? (
            <p className="text-sm text-text-muted">{apiErrorDetail(runs.error)}</p>
          ) : null}
          <button
            type="button"
            className="touch-target rounded border border-border px-4 text-sm"
            onClick={refresh}
            disabled={runs.isFetching}
          >
            {runs.isFetching ? en.runs.refreshing : en.runs.retry}
          </button>
        </section>
      )
    }
    return (
      <p role="status" className="flex flex-1 items-center justify-center px-6 text-text-muted">
        {en.runs.loading}
      </p>
    )
  }

  const totalAttention = attentionCount(all)
  const shownAttention = attentionCount(sections)
  // Current only when the stream is live AND a fetch landed after it opened (no replay fills the
  // gap before that). Otherwise the list is as old as the later of its last fetch and the last
  // moment the stream vouched for it — unless the last fetch failed, which vouches for nothing.
  const synced =
    live.state === 'live' && live.liveSince !== null && runs.dataUpdatedAt >= live.liveSince
  const asOf = synced
    ? now
    : runs.isError
      ? runs.dataUpdatedAt
      : Math.max(runs.dataUpdatedAt, live.liveUntil ?? 0)
  const asOfTime = clockTime(new Date(asOf).toISOString(), now)
  const stale = runs.isFetching && now - asOf > STALE_AFTER_MS
  const detail = runs.isFetching
    ? en.runs.refreshingInline
    : synced
      ? undefined
      : en.runs.listFrom(asOfTime)
  const truncated = runs.data.truncated.map((id) => projectNames.get(id) ?? id)

  return (
    <div className="flex flex-1 flex-col">
      {pull.distance > 0 ? (
        <div
          aria-hidden="true"
          className="flex items-end justify-center overflow-hidden text-sm text-text-muted"
          style={{ height: pull.distance }}
        >
          <span className="pb-2">{pull.armed ? en.runs.release : en.runs.pull}</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className={`text-lg font-semibold ${totalAttention > 0 ? 'text-pending' : ''}`}>
              {totalAttention > 0 ? en.runs.summary.some(totalAttention) : en.runs.summary.none}
            </h2>
            {totalAttention > shownAttention ? (
              <p className="text-sm text-text-muted">
                {en.runs.summary.elsewhere(totalAttention - shownAttention)}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {/* S-20 (#70): only where the family answers — with the capability off it is a 409. */}
            {health.data?.capabilities?.automations === true ? (
              <Link
                to={projectId === null ? '/automations' : `/automations?${PROJECT_PARAM}=${encodeURIComponent(projectId)}`}
                className="touch-target inline-flex items-center rounded border border-border px-3 text-sm"
              >
                {en.automations.open}
              </Link>
            ) : null}
            {/* #93: the push sidecar's reading of each account's usage windows. */}
            <Link to="/limits" className="touch-target inline-flex items-center rounded border border-border px-3 text-sm">
              {en.limits.open}
            </Link>
            {/* S-13 (FR-033): a filtered list starts the task in the project it shows. */}
            <Link
              to={projectId === null ? '/new' : `/new?${PROJECT_PARAM}=${encodeURIComponent(projectId)}`}
              className="touch-target inline-flex items-center rounded bg-accent px-3 text-sm font-semibold text-white"
            >
              {en.runs.newTask}
            </Link>
          </div>
        </div>

        {projects.length > 1 ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-text-muted">{en.runs.filter.label}</span>
            <select
              className="touch-target flex-1 rounded border border-border bg-surface-raised px-2 text-text"
              value={projectId ?? ''}
              onChange={(event) => setProject(event.target.value === '' ? null : event.target.value)}
            >
              <option value="">{en.runs.filter.all}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <MarkAllReadControl
          plan={readAllTargets}
          readAll={readAll}
          projectName={(id) => projectNames.get(id) ?? id}
        />

        <div className="flex items-center justify-between gap-3 text-sm text-text-muted">
          <ConnectionStatus state={live.state} detail={detail} />
          <button
            type="button"
            className="touch-target rounded border border-border px-3 text-text"
            onClick={refresh}
            disabled={runs.isFetching}
          >
            {en.runs.refresh}
          </button>
        </div>
      </div>

      {runs.isError && !(runs.error instanceof AuthRequiredError) ? (
        <div role="alert" className="border-b border-border bg-surface-raised px-4 py-2 text-sm">
          {en.runs.refreshFailed(asOfTime)}
        </div>
      ) : null}

      <div aria-busy={stale} className={stale ? 'opacity-50' : undefined}>
        {sections.length === 0 ? (
          <p className="px-6 py-10 text-center text-text-muted">
            {projectId === null ? en.runs.empty.all : en.runs.empty.project}
          </p>
        ) : (
          sections.map((section) => {
            const rows =
              section.key === 'finished' && !showOlder
                ? section.rows.slice(0, FINISHED_VISIBLE)
                : section.rows
            const hidden = section.rows.length - rows.length
            return (
              <section key={section.key} aria-labelledby={`section-${section.key}`}>
                <h3
                  id={`section-${section.key}`}
                  className="px-4 pt-4 pb-1 text-xs font-semibold tracking-wide text-text-muted uppercase"
                >
                  {en.runs.sections[section.key]} ({section.rows.length})
                </h3>
                <ul>
                  {rows.map(({ run, queuePosition }) => (
                    <RunRow
                      key={`${run.projectId}/${run.id}`}
                      run={run}
                      queuePosition={queuePosition}
                      projectName={projectNames.get(run.projectId) ?? run.projectId}
                      now={now}
                    />
                  ))}
                </ul>
                {hidden > 0 ? (
                  <button
                    type="button"
                    className="touch-target w-full px-4 text-sm text-accent"
                    onClick={() => setShowOlder(true)}
                  >
                    {en.runs.showOlder(hidden)}
                  </button>
                ) : null}
              </section>
            )
          })
        )}

        {truncated.length > 0 ? (
          <p className="px-4 py-4 text-xs text-text-muted">
            {en.runs.truncated(runs.data.perProjectLimit, truncated.join(', '))}
          </p>
        ) : null}
      </div>
    </div>
  )
}
