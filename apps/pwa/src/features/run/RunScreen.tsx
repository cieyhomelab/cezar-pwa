import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import { Link, useParams } from 'react-router'
import { HEALTH_QUERY_KEY, healthQueryOptions } from '../../api/health.ts'
import { ApiError, AuthRequiredError } from '../../api/http.ts'
import { historyContextQueryOptions, historyQueryOptions, runQueryOptions } from '../../api/run.ts'
import { clockTime } from '../../domain/run-display.ts'
import { latestPlan, mergeBySeq, reduceTranscript, transcriptFooter } from '../../domain/transcript.ts'
import { pl } from '../../i18n/pl.ts'
import { STALE_AFTER_MS } from '../runs-list/RunsListScreen.tsx'
import { useNow } from '../runs-list/useNow.ts'
import { PlanPanel } from './PlanPanel.tsx'
import { RunHeader } from './RunHeader.tsx'
import { TranscriptView } from './TranscriptView.tsx'
import { useMarkRead } from './useMarkRead.ts'

/** The route: `/m/p/:projectId/runs/:runId`, the same shape S-10's notifications will open. */
export function RunScreen() {
  const { projectId = '', runId = '' } = useParams()
  // Keyed on the ids so a navigation between two tasks starts from a clean screen.
  return <RunScreenFor key={`${projectId}\0${runId}`} projectId={projectId} runId={runId} />
}

function BackBar({ children }: { children?: ReactNode }) {
  return (
    <div className="sticky top-0 z-20 border-b border-border bg-surface">
      <div className="flex items-center justify-between gap-3 px-2">
        <Link to="/" className="touch-target inline-flex items-center px-2 text-accent">
          <span aria-hidden="true">‹&nbsp;</span>
          {pl.run.back}
        </Link>
      </div>
      {children}
    </div>
  )
}

/**
 * S-05: one task's header, its plan and the newest stretch of its transcript (US-01, FR-014,
 * FR-015, FR-017, FR-018, FR-020). Rendered behind `AuthGate`.
 *
 * Three reads, one screen. The record is authoritative for the header. The newest history page
 * is the transcript body. The history context adds the latest plan snapshot when it is older
 * than the page (the cockpit's `currentEvents`). The context is an optimization: when it fails,
 * the plan is folded from the page alone rather than failing the screen.
 */
function RunScreenFor({ projectId, runId }: { projectId: string; runId: string }) {
  const queryClient = useQueryClient()
  const health = useQuery(healthQueryOptions())
  const run = useQuery(runQueryOptions(projectId, runId))
  const history = useQuery(historyQueryOptions(projectId, runId))
  const context = useQuery(historyContextQueryOptions(projectId, runId))
  const now = useNow()

  useMarkRead(projectId, runId, run.data)

  // A refusal means the session lapsed since the probe. Re-asking it hands the screen to
  // `AuthGate`, exactly as the list does.
  const refused = [run.error, history.error, context.error].some((error) => error instanceof AuthRequiredError)
  useEffect(() => {
    if (refused) void queryClient.invalidateQueries({ queryKey: HEALTH_QUERY_KEY })
  }, [refused, queryClient])

  const status = run.data?.status
  const transcript = useMemo(
    () => reduceTranscript(history.data?.events ?? [], { activeTurn: status === 'running' }),
    [history.data, status],
  )
  const plan = useMemo(
    () => latestPlan(reduceTranscript(mergeBySeq(context.data?.contextEvents ?? [], history.data?.events ?? []))),
    [context.data, history.data],
  )

  // Open at the newest entry, once: the most recent stretch is what the operator came for. Later
  // refetches leave the scroll where the operator put it (FR-019's live behaviour is S-06).
  const scrolled = useRef(false)
  const ready = run.data !== undefined && history.data !== undefined
  useEffect(() => {
    if (!ready || scrolled.current) return
    scrolled.current = true
    window.scrollTo({ top: document.documentElement.scrollHeight })
  }, [ready])

  const projectName =
    health.data?.projects?.find((project) => project.id === projectId)?.name ?? projectId

  if (run.data === undefined) {
    if (run.isError && !(run.error instanceof AuthRequiredError)) {
      const notFound = run.error instanceof ApiError && run.error.status === 404
      return (
        <div className="flex flex-1 flex-col">
          <BackBar />
          <section className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <p>{notFound ? pl.run.notFound : pl.run.loadFailed}</p>
            {!notFound && run.error instanceof ApiError ? (
              <p className="text-sm text-text-muted">{run.error.message}</p>
            ) : null}
            {notFound ? null : (
              <button
                type="button"
                className="touch-target rounded border border-border px-4 text-sm"
                onClick={() => void run.refetch()}
                disabled={run.isFetching}
              >
                {run.isFetching ? pl.run.refreshing : pl.run.retry}
              </button>
            )}
          </section>
        </div>
      )
    }
    return (
      <div className="flex flex-1 flex-col">
        <BackBar />
        <p role="status" className="flex flex-1 items-center justify-center px-6 text-text-muted">
          {pl.run.loading}
        </p>
      </div>
    )
  }

  const refresh = () => {
    void run.refetch()
    void history.refetch()
    void context.refetch()
  }
  const fetching = run.isFetching || history.isFetching
  // The older of the two answers is the one the screen can vouch for.
  const asOf = Math.min(run.dataUpdatedAt, history.dataUpdatedAt || run.dataUpdatedAt)
  const updatedAt = clockTime(new Date(asOf).toISOString(), now)
  // Returning after a suspension: dimmed and busy until the refetch lands, never presented as
  // current (PRD guardrail), the same rule as the list.
  const stale = fetching && now - asOf > STALE_AFTER_MS
  const refreshFailed =
    (run.isError && !(run.error instanceof AuthRequiredError)) ||
    (history.isError && history.data !== undefined && !(history.error instanceof AuthRequiredError))

  return (
    <div className="flex flex-1 flex-col">
      <BackBar>
        <PlanPanel entries={plan} />
      </BackBar>

      <div aria-busy={stale} className={stale ? 'opacity-50' : undefined}>
        <RunHeader run={run.data} projectName={projectName} />

        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-sm text-text-muted">
          <p role="status">{fetching ? pl.run.refreshing : pl.run.updatedAt(updatedAt)}</p>
          <button
            type="button"
            className="touch-target rounded border border-border px-3 text-text"
            onClick={refresh}
            disabled={fetching}
          >
            {pl.run.refresh}
          </button>
        </div>

        {refreshFailed ? (
          <div role="alert" className="border-b border-border bg-surface-raised px-4 py-2 text-sm">
            {pl.run.refreshFailed(updatedAt)}
          </div>
        ) : null}

        {history.data !== undefined ? (
          <TranscriptView
            transcript={transcript}
            task={run.data.task ?? ''}
            hasOlder={history.data.hasOlder}
            footer={transcriptFooter(run.data.status, run.data.error)}
          />
        ) : history.isError && !(history.error instanceof AuthRequiredError) ? (
          <section className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p>{pl.run.transcript.loadFailed}</p>
            {history.error instanceof ApiError ? (
              <p className="text-sm text-text-muted">{history.error.message}</p>
            ) : null}
            <button
              type="button"
              className="touch-target rounded border border-border px-4 text-sm"
              onClick={() => void history.refetch()}
              disabled={history.isFetching}
            >
              {history.isFetching ? pl.run.refreshing : pl.run.retry}
            </button>
          </section>
        ) : (
          <p role="status" className="px-6 py-10 text-center text-text-muted">
            {pl.run.loading}
          </p>
        )}
      </div>
    </div>
  )
}
