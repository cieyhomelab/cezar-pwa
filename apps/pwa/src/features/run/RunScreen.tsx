import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router'
import { HEALTH_QUERY_KEY, healthQueryOptions } from '../../api/health.ts'
import { ApiError, AuthRequiredError } from '../../api/http.ts'
import { historyContextQueryOptions, historyQueryOptions, runQueryOptions } from '../../api/run.ts'
import { composerOpen, openAsk } from '../../domain/answer.ts'
import { cockpitTaskPath } from '../../domain/cockpit-link.ts'
import { clockTime } from '../../domain/run-display.ts'
import { transcriptSignature } from '../../domain/live-transcript.ts'
import { latestPlan, mergeBySeq, reduceTranscript, transcriptFooter } from '../../domain/transcript.ts'
import { apiErrorDetail } from '../../i18n/errors.ts'
import { en } from '../../i18n/en.ts'
import { ConnectionStatus } from '../runs-list/ConnectionStatus.tsx'
import { STALE_AFTER_MS } from '../runs-list/RunsListScreen.tsx'
import { useNow } from '../runs-list/useNow.ts'
import { Composer } from './Composer.tsx'
import { PlanPanel } from './PlanPanel.tsx'
import { RunActionBar } from './RunActionBar.tsx'
import { RunHeader } from './RunHeader.tsx'
import { TranscriptView } from './TranscriptView.tsx'
import { useDeliver } from './useDeliver.ts'
import { useFollowBottom } from './useFollowBottom.ts'
import { useLiveTranscript } from './useLiveTranscript.ts'
import { useMarkRead } from './useMarkRead.ts'
import { usePickVariant } from './usePickVariant.ts'
import { useRunActions } from './useRunActions.ts'
import { VariantsPanel } from './VariantsPanel.tsx'

/** The route: `/m/p/:projectId/runs/:runId`, the same shape S-10's notifications will open. */
export function RunScreen() {
  const { projectId = '', runId = '' } = useParams()
  // Keyed on the ids so a navigation between two tasks starts from a clean screen.
  return <RunScreenFor key={`${projectId}\0${runId}`} projectId={projectId} runId={runId} />
}

/**
 * Back to the list, and across to the same task in the full cockpit (S-12, FR-048). A plain link,
 * not a router one: the cockpit is the site at `/`, outside this app.
 */
function BackBar({ projectId, runId, children }: { projectId: string; runId: string; children?: ReactNode }) {
  return (
    <div className="sticky top-0 z-20 border-b border-border bg-surface">
      <div className="flex items-center justify-between gap-3 px-2">
        <Link to="/" className="touch-target inline-flex items-center px-2 text-accent">
          <span aria-hidden="true">‹&nbsp;</span>
          {en.run.back}
        </Link>
        <a
          href={cockpitTaskPath(projectId, runId)}
          aria-label={en.shell.openTaskInCockpitLabel}
          className="touch-target inline-flex items-center px-2 text-sm text-accent"
        >
          {en.shell.openTaskInCockpit}
          <span aria-hidden="true">&nbsp;↗</span>
        </a>
      </div>
      {children}
    </div>
  )
}

/**
 * S-05: one task's header, its plan and the newest stretch of its transcript (US-01, FR-014,
 * FR-015, FR-017, FR-018, FR-020). S-07: the agent's open question is answerable in place and
 * a docked composer messages the task (FR-022, FR-023, FR-032). S-08: under the header, the
 * task's own actions — cancel, finish, draft PR, continue, pin, archive (FR-025 to FR-029).
 * S-21: a task started as variants lists its siblings and can be kept (#71).
 * Rendered behind `AuthGate`.
 *
 * S-06: kept live by the task's event stream (FR-016), following the newest entry only while the
 * operator is at the end (FR-019), and resumed after a suspension from where it stopped (FR-021).
 * While the stream is not live, the reads fall back to S-05's refetching.
 *
 * Three reads, one screen. The record is authoritative for the header. The newest history page
 * is the transcript body. The history context adds the latest plan snapshot when it is older
 * than the page (the cockpit's `currentEvents`). The context is an optimization: when it fails,
 * the plan is folded from the page alone rather than failing the screen.
 */
function RunScreenFor({ projectId, runId }: { projectId: string; runId: string }) {
  const queryClient = useQueryClient()
  const health = useQuery(healthQueryOptions())
  // The stream starts from the first page, and the page's refetch policy depends on the stream: a
  // passive observer (never fetches) reads whether the page is in without closing that loop.
  const historyReady = useQuery({ ...historyQueryOptions(projectId, runId), enabled: false }).data !== undefined
  const live = useLiveTranscript(projectId, runId, historyReady)
  const streaming = live.state === 'live'
  const run = useQuery(runQueryOptions(projectId, runId, streaming))
  const history = useQuery(historyQueryOptions(projectId, runId, streaming))
  const context = useQuery(historyContextQueryOptions(projectId, runId, streaming))
  const now = useNow()

  useMarkRead(projectId, runId, run.data)
  // S-07: one delivery for the question card and the composer alike.
  const delivery = useDeliver(projectId, runId, run.data)
  // S-08: cancel, finish, draft PR, continue, pin and archive.
  const actions = useRunActions(projectId, runId, run.data)
  // S-21: a task started ×2 or ×3 lists its siblings and can be kept (#71).
  const groupId = typeof run.data?.groupId === 'string' && run.data.groupId !== '' ? run.data.groupId : undefined
  const pick = usePickVariant(projectId, runId, groupId ?? '', run.data?.variant ?? '?')

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
  const ask = useMemo(() => openAsk(transcript), [transcript])
  const plan = useMemo(
    () => latestPlan(reduceTranscript(mergeBySeq(context.data?.contextEvents ?? [], history.data?.events ?? []))),
    [context.data, history.data],
  )

  const ready = run.data !== undefined && history.data !== undefined
  const follow = useFollowBottom(transcriptSignature(transcript), ready)

  const projectName =
    health.data?.projects?.find((project) => project.id === projectId)?.name ?? projectId

  if (run.data === undefined) {
    if (run.isError && !(run.error instanceof AuthRequiredError)) {
      const notFound = run.error instanceof ApiError && run.error.status === 404
      return (
        <div className="flex flex-1 flex-col">
          <BackBar projectId={projectId} runId={runId} />
          <section className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <p>{notFound ? en.run.notFound : en.run.loadFailed}</p>
            {!notFound && apiErrorDetail(run.error) ? (
              <p className="text-sm text-text-muted">{apiErrorDetail(run.error)}</p>
            ) : null}
            {notFound ? null : (
              <button
                type="button"
                className="touch-target rounded border border-border px-4 text-sm"
                onClick={() => void run.refetch()}
                disabled={run.isFetching}
              >
                {run.isFetching ? en.run.refreshing : en.run.retry}
              </button>
            )}
          </section>
        </div>
      )
    }
    return (
      <div className="flex flex-1 flex-col">
        <BackBar projectId={projectId} runId={runId} />
        <p role="status" className="flex flex-1 items-center justify-center px-6 text-text-muted">
          {en.run.loading}
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
  // The older of the two answers is the one the screen can vouch for — or, when the stream carried
  // it further, the last moment it was live.
  const fetchedAt = Math.min(run.dataUpdatedAt, history.dataUpdatedAt || run.dataUpdatedAt)
  const asOf = streaming ? now : Math.max(fetchedAt, live.liveUntil ?? 0)
  const updatedAt = clockTime(new Date(asOf).toISOString(), now)
  // Returning after a suspension: dimmed and busy until the refetch lands, never presented as
  // current (PRD guardrail), the same rule as the list.
  const stale = !streaming && fetching && now - asOf > STALE_AFTER_MS
  const refreshFailed =
    (run.isError && !(run.error instanceof AuthRequiredError)) ||
    (history.isError && history.data !== undefined && !(history.error instanceof AuthRequiredError))
  const composer = history.data !== undefined && composerOpen(run.data, ask)

  return (
    <div className="flex flex-1 flex-col">
      <BackBar projectId={projectId} runId={runId}>
        <PlanPanel entries={plan} />
      </BackBar>

      <div aria-busy={stale} className={stale ? 'opacity-50' : undefined}>
        <RunHeader run={run.data} projectId={projectId} projectName={projectName} />
        <RunActionBar run={run.data} actions={actions} busy={delivery.pending || pick.pending} />
        {groupId !== undefined ? (
          <VariantsPanel
            projectId={projectId}
            runId={runId}
            groupId={groupId}
            pick={pick}
            busy={delivery.pending || actions.pending !== undefined}
          />
        ) : null}

        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-sm text-text-muted">
          <ConnectionStatus
            state={live.state}
            detail={fetching ? en.runs.refreshingInline : streaming ? undefined : en.run.stateFrom(updatedAt)}
          />
          <button
            type="button"
            className="touch-target rounded border border-border px-3 text-text"
            onClick={refresh}
            disabled={fetching}
          >
            {en.run.refresh}
          </button>
        </div>

        {refreshFailed ? (
          <div role="alert" className="border-b border-border bg-surface-raised px-4 py-2 text-sm">
            {en.run.refreshFailed(updatedAt)}
          </div>
        ) : null}

        {history.data !== undefined ? (
          <TranscriptView
            transcript={transcript}
            task={run.data.task ?? ''}
            hasOlder={history.data.hasOlder}
            olderHref={cockpitTaskPath(projectId, runId)}
            footer={transcriptFooter(run.data.status, run.data.error)}
            answering={{ delivery, ...(ask !== undefined ? { openAskId: ask.id } : {}) }}
          />
        ) : history.isError && !(history.error instanceof AuthRequiredError) ? (
          <section className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p>{en.run.transcript.loadFailed}</p>
            {apiErrorDetail(history.error) ? (
              <p className="text-sm text-text-muted">{apiErrorDetail(history.error)}</p>
            ) : null}
            <button
              type="button"
              className="touch-target rounded border border-border px-4 text-sm"
              onClick={() => void history.refetch()}
              disabled={history.isFetching}
            >
              {history.isFetching ? en.run.refreshing : en.run.retry}
            </button>
          </section>
        ) : (
          <p role="status" className="px-6 py-10 text-center text-text-muted">
            {en.run.loading}
          </p>
        )}
      </div>

      {/* One dock at the bottom: the composer (S-07) and, floating above it, "new messages"
          (S-06). Two separately pinned things would sit on top of each other. */}
      <div className="sticky bottom-0 z-30">
        {follow.unseen ? (
          <button
            type="button"
            onClick={follow.jump}
            className="touch-target absolute left-1/2 -translate-x-1/2 rounded-full bg-accent px-4 text-sm font-semibold whitespace-nowrap text-white shadow-lg"
            style={{ bottom: composer ? 'calc(100% + 0.75rem)' : 'calc(env(safe-area-inset-bottom) + 1rem)' }}
          >
            {en.run.newMessages} <span aria-hidden="true">↓</span>
          </button>
        ) : null}
        {composer ? (
          <Composer
            status={run.data.status}
            delivery={delivery}
            {...(ask !== undefined ? { openAskId: ask.id } : {})}
            queuedMessages={run.data.queuedMessages ?? []}
          />
        ) : null}
      </div>
    </div>
  )
}
