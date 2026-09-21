import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { HEALTH_QUERY_KEY, healthQueryOptions } from '../../api/health.ts'
import { ApiError, AuthRequiredError } from '../../api/http.ts'
import { runsIndexQueryOptions } from '../../api/runs-index.ts'
import { clockTime } from '../../domain/run-display.ts'
import { attentionCount, buildTaskList } from '../../domain/task-list.ts'
import { pl } from '../../i18n/pl.ts'
import { RunRow } from './RunRow.tsx'
import { useNow } from './useNow.ts'
import { useProjectFilter } from './useProjectFilter.ts'
import { usePullToRefresh } from './usePullToRefresh.ts'

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
 *
 * Rendered only behind `AuthGate`, so the health probe has already answered and its project
 * list is in the cache.
 */
export function RunsListScreen() {
  const queryClient = useQueryClient()
  const health = useQuery(healthQueryOptions())
  const runs = useQuery(runsIndexQueryOptions())
  const now = useNow()
  const [showOlder, setShowOlder] = useState(false)

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

  if (runs.data === undefined) {
    if (runs.isError && !(runs.error instanceof AuthRequiredError)) {
      return (
        <section className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p>{pl.runs.loadFailed}</p>
          {runs.error instanceof ApiError ? (
            <p className="text-sm text-text-muted">{runs.error.message}</p>
          ) : null}
          <button
            type="button"
            className="touch-target rounded border border-border px-4 text-sm"
            onClick={refresh}
            disabled={runs.isFetching}
          >
            {runs.isFetching ? pl.runs.refreshing : pl.runs.retry}
          </button>
        </section>
      )
    }
    return (
      <p role="status" className="flex flex-1 items-center justify-center px-6 text-text-muted">
        {pl.runs.loading}
      </p>
    )
  }

  const totalAttention = attentionCount(all)
  const shownAttention = attentionCount(sections)
  const updatedAt = clockTime(new Date(runs.dataUpdatedAt).toISOString(), now)
  const stale = runs.isFetching && now - runs.dataUpdatedAt > STALE_AFTER_MS
  const truncated = runs.data.truncated.map((id) => projectNames.get(id) ?? id)

  return (
    <div className="flex flex-1 flex-col">
      {pull.distance > 0 ? (
        <div
          aria-hidden="true"
          className="flex items-end justify-center overflow-hidden text-sm text-text-muted"
          style={{ height: pull.distance }}
        >
          <span className="pb-2">{pull.armed ? pl.runs.release : pl.runs.pull}</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className={`text-lg font-semibold ${totalAttention > 0 ? 'text-pending' : ''}`}>
            {totalAttention > 0 ? pl.runs.summary.some(totalAttention) : pl.runs.summary.none}
          </h2>
          {totalAttention > shownAttention ? (
            <p className="text-sm text-text-muted">
              {pl.runs.summary.elsewhere(totalAttention - shownAttention)}
            </p>
          ) : null}
        </div>

        {projects.length > 1 ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-text-muted">{pl.runs.filter.label}</span>
            <select
              className="touch-target flex-1 rounded border border-border bg-surface-raised px-2 text-text"
              value={projectId ?? ''}
              onChange={(event) => setProject(event.target.value === '' ? null : event.target.value)}
            >
              <option value="">{pl.runs.filter.all}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="flex items-center justify-between gap-3 text-sm text-text-muted">
          <p role="status">{runs.isFetching ? pl.runs.refreshing : pl.runs.updatedAt(updatedAt)}</p>
          <button
            type="button"
            className="touch-target rounded border border-border px-3 text-text"
            onClick={refresh}
            disabled={runs.isFetching}
          >
            {pl.runs.refresh}
          </button>
        </div>
      </div>

      {runs.isError && !(runs.error instanceof AuthRequiredError) ? (
        <div role="alert" className="border-b border-border bg-surface-raised px-4 py-2 text-sm">
          {pl.runs.refreshFailed(updatedAt)}
        </div>
      ) : null}

      <div aria-busy={stale} className={stale ? 'opacity-50' : undefined}>
        {sections.length === 0 ? (
          <p className="px-6 py-10 text-center text-text-muted">
            {projectId === null ? pl.runs.empty.all : pl.runs.empty.project}
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
                  {pl.runs.sections[section.key]} ({section.rows.length})
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
                    {pl.runs.showOlder(hidden)}
                  </button>
                ) : null}
              </section>
            )
          })
        )}

        {truncated.length > 0 ? (
          <p className="px-4 py-4 text-xs text-text-muted">
            {pl.runs.truncated(runs.data.perProjectLimit, truncated.join(', '))}
          </p>
        ) : null}
      </div>
    </div>
  )
}
