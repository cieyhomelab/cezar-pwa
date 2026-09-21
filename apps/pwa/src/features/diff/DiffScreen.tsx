import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Link, useParams } from 'react-router'
import { changesQueryOptions } from '../../api/changes.ts'
import { HEALTH_QUERY_KEY } from '../../api/health.ts'
import { ApiError, AuthRequiredError } from '../../api/http.ts'
import { runQueryOptions } from '../../api/run.ts'
import { isRunActive } from '../../domain/answer.ts'
import { openByDefault } from '../../domain/diff.ts'
import { clockTime, runTitle } from '../../domain/run-display.ts'
import { runPath } from '../../domain/run-header.ts'
import { pl } from '../../i18n/pl.ts'
import { STALE_AFTER_MS } from '../runs-list/RunsListScreen.tsx'
import { useNow } from '../runs-list/useNow.ts'
import { DiffCounts } from './DiffCounts.tsx'
import { FileDiff } from './FileDiff.tsx'

/** The route: `/m/p/:projectId/runs/:runId/diff`. */
export function DiffScreen() {
  const { projectId = '', runId = '' } = useParams()
  return <DiffScreenFor key={`${projectId}\0${runId}`} projectId={projectId} runId={runId} />
}

/**
 * S-09: what the agent changed, file by file, read-only (FR-031). Wrapped lines, no syntax
 * highlighting (a PRD non-goal), one unified column: the cockpit forces the same layout below
 * its `md` breakpoint.
 *
 * The record is read only for the title and for whether the task is still working, which decides
 * whether the diff keeps being re-asked. Its failure does not block the diff. Rendered behind
 * `AuthGate`, like every screen.
 */
function DiffScreenFor({ projectId, runId }: { projectId: string; runId: string }) {
  const queryClient = useQueryClient()
  const run = useQuery(runQueryOptions(projectId, runId))
  const active = run.data !== undefined && isRunActive(run.data.status)
  const changes = useQuery(changesQueryOptions(projectId, runId, active))
  const now = useNow()

  const refused = [run.error, changes.error].some((error) => error instanceof AuthRequiredError)
  useEffect(() => {
    if (refused) void queryClient.invalidateQueries({ queryKey: HEALTH_QUERY_KEY })
  }, [refused, queryClient])

  const data = changes.data
  const error = changes.error instanceof AuthRequiredError ? null : changes.error
  const updatedAt = clockTime(new Date(changes.dataUpdatedAt || now).toISOString(), now)
  // Guardrail: an old diff being re-read is dimmed and busy, never presented as current.
  const stale = changes.isFetching && data !== undefined && now - changes.dataUpdatedAt > STALE_AFTER_MS

  return (
    <div className="flex flex-1 flex-col">
      <div className="sticky top-0 z-20 flex h-11 items-center border-b border-border bg-surface px-2">
        <Link to={runPath(projectId, runId)} className="touch-target inline-flex items-center px-2 text-accent">
          <span aria-hidden="true">‹&nbsp;</span>
          {pl.run.diff.back}
        </Link>
      </div>

      <section className="flex flex-col gap-1 border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold">{pl.run.diff.title}</h2>
        {run.data ? <p className="text-sm break-words text-text-muted">{runTitle(run.data)}</p> : null}
        <div className="flex items-center justify-between gap-3">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            {data ? (
              <>
                {pl.run.diff.files(data.stat.files)}
                <DiffCounts adds={data.stat.adds} dels={data.stat.dels} />
              </>
            ) : null}
            {data && !changes.isFetching ? (
              <span className="text-text-muted">· {pl.run.stateFrom(updatedAt)}</span>
            ) : null}
          </p>
          <button
            type="button"
            className="touch-target shrink-0 rounded border border-border px-3"
            onClick={() => {
              void changes.refetch()
              void run.refetch()
            }}
            disabled={changes.isFetching}
          >
            {changes.isFetching ? pl.run.refreshing : pl.run.refresh}
          </button>
        </div>
      </section>

      {data === undefined ? (
        error ? (
          <section className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            {/* A 409 is an answer, not an outage: e.g. the task ran without a worktree. */}
            <p>
              {error instanceof ApiError && error.status === 409
                ? pl.run.diff.refused
                : error instanceof ApiError && error.status === 404
                  ? pl.run.notFound
                  : pl.run.diff.loadFailed}
            </p>
            {error instanceof ApiError && error.status !== 404 ? (
              <p className="text-sm break-words text-text-muted">{error.message}</p>
            ) : null}
          </section>
        ) : (
          <p role="status" className="flex flex-1 items-center justify-center px-6 py-10 text-text-muted">
            {pl.run.diff.loading}
          </p>
        )
      ) : (
        <div aria-busy={stale} className={stale ? 'opacity-50' : undefined}>
          {error ? (
            <div role="alert" className="border-b border-border bg-surface-raised px-4 py-2 text-sm">
              {pl.run.refreshFailed(updatedAt)}
            </div>
          ) : null}
          {data.repointedHead ? (
            <p role="note" className="border-b border-border px-4 py-2 text-xs break-words text-text-muted">
              {pl.run.diff.repointed(data.repointedHead.headBranch, data.repointedHead.taskBranch)}
            </p>
          ) : null}
          {data.files.length === 0 ? (
            <p className="px-6 py-10 text-center text-text-muted">
              {active ? pl.run.diff.emptyActive : pl.run.diff.empty}
            </p>
          ) : (
            data.files.map((file) => (
              <FileDiff
                key={`${file.oldPath ?? ''}\0${file.path}`}
                file={file}
                defaultOpen={openByDefault(data.files.length)}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
