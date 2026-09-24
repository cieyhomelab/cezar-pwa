import type { GithubMergeMethod } from '@cezar-pwa/cezar-contract/contract'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useState } from 'react'
import { HEALTH_QUERY_KEY } from '../../api/health.ts'
import { AuthRequiredError } from '../../api/http.ts'
import { mergeStateQueryOptions } from '../../api/merge.ts'
import {
  type CheckState,
  type MergeCheck,
  type MergeHeadline,
  type MergeView,
  mergeGate,
  mergePanelState,
  selectedMethod,
} from '../../domain/merge.ts'
import { apiErrorDetail } from '../../i18n/errors.ts'
import { en } from '../../i18n/en.ts'
import { type MergeActions, useMerge } from './useMerge.ts'

const BASE = 'touch-target inline-flex items-center justify-center rounded px-4 text-sm disabled:opacity-60'
const PRIMARY = `${BASE} bg-accent font-semibold text-white`
const OUTLINE = `${BASE} border border-border bg-surface-raised text-text`

/** A glyph beside every state word, so none rests on colour alone (NFR). */
const CHECK_GLYPH: Record<CheckState, string> = { passing: '✓', failing: '✕', pending: '…', unknown: '?' }
const CHECK_TONE: Record<CheckState, string> = {
  passing: 'text-success',
  failing: 'text-danger',
  pending: 'text-pending',
  unknown: 'text-text-muted',
}
const HEADLINE_TONE: Record<MergeHeadline, string> = {
  merged: 'text-violet',
  closed: 'text-text-muted',
  draft: 'text-text-muted',
  conflicts: 'text-danger',
  ready: 'text-success',
  failing: 'text-danger',
  pending: 'text-pending',
  blocked: 'text-danger',
  unknown: 'text-text-muted',
}

function CheckLine({ check }: { check: MergeCheck }) {
  const t = en.run.merge
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0 break-words">
        <span aria-hidden="true" className={`mr-1 inline-block w-4 text-center ${CHECK_TONE[check.state]}`}>
          {CHECK_GLYPH[check.state]}
        </span>
        {check.name}
        <span className="text-text-muted">
          {' · '}
          {t.checkState[check.state]}
          {check.required === true ? ` · ${t.required}` : ''}
        </span>
      </span>
      {check.url ? (
        <a
          href={check.url}
          target="_blank"
          rel="noopener noreferrer"
          className="touch-target inline-flex shrink-0 items-center px-1 text-accent"
        >
          {t.details}
        </a>
      ) : null}
    </li>
  )
}

function Confirmation({ view, merge, override }: { view: MergeView; merge: MergeActions; override: boolean }) {
  const t = en.run.merge
  const id = useId()
  const [chosen, setChosen] = useState<GithubMergeMethod>()
  const method = selectedMethod(view, chosen)
  const busy = merge.pending !== undefined
  const head = merge.confirmedHead ?? view.headSha
  // New commits arrived while the confirmation was open: they have not been seen, so no merge.
  const moved = head !== view.headSha
  return (
    <div
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      className="flex flex-col gap-2 rounded bg-surface-raised p-3"
    >
      <h4 id={`${id}-title`} className="font-semibold">
        {t.confirm.title(view.number)}
      </h4>
      <div id={`${id}-body`} className="flex flex-col gap-1 text-sm text-text-muted">
        <p className="break-words">{t.confirm.body(view.title, view.baseRef)}</p>
        <p>{t.confirm.head(head.slice(0, 7))}</p>
        {moved ? <p className="text-danger">{t.confirm.moved(view.headSha.slice(0, 7))}</p> : null}
        {override ? <p className="text-danger">{t.confirm.override}</p> : null}
      </div>
      {view.methods.length > 1 ? (
        <fieldset className="flex flex-col">
          <legend className="text-sm font-semibold">{t.methodLabel}</legend>
          {view.methods.map((candidate) => (
            <label key={candidate} className="touch-target flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`${id}-method`}
                value={candidate}
                checked={method === candidate}
                disabled={busy}
                onChange={() => setChosen(candidate)}
                className="size-5 accent-accent"
              />
              {t.method[candidate]}
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={OUTLINE} disabled={busy} onClick={merge.back}>
          {t.confirm.back}
        </button>
        <button
          type="button"
          className={PRIMARY}
          disabled={busy || method === null || moved}
          onClick={() => method && !moved && void merge.merge({ method, headSha: head, override })}
        >
          {merge.pending === 'merge' ? t.merging : method ? t.method[method] : t.mergeButton}
        </button>
      </div>
    </div>
  )
}

function MergeState({ view, merge }: { view: MergeView; merge: MergeActions }) {
  const t = en.run.merge
  const [override, setOverride] = useState(false)
  const gate = mergeGate(view, override)
  const busy = merge.pending !== undefined
  const total = view.checks.length
  const offered = !view.terminal && (view.canMerge || view.canOverride)

  return (
    <>
      <p className={`font-semibold ${HEADLINE_TONE[view.headline]}`}>{t.headline[view.headline]}</p>
      <p className="text-sm break-words text-text-muted">{view.title}</p>

      {total === 0 ? (
        <p className="text-sm text-text-muted">{t.noChecks}</p>
      ) : (
        <>
          <p className="text-sm text-text-muted">{t.checksSummary(view.counts.passing, total)}</p>
          <ul className="flex flex-col">
            {view.checks.map((check, index) => (
              <CheckLine key={`${check.name}\0${index}`} check={check} />
            ))}
          </ul>
        </>
      )}

      {!view.terminal && view.headline !== 'ready' && view.blockers.length > 0 ? (
        <ul className="flex list-disc flex-col pl-5 text-sm text-text-muted">
          {view.blockers.map((blocker, index) => (
            <li key={`${blocker}\0${index}`} className="break-words">
              {blocker}
            </li>
          ))}
        </ul>
      ) : null}

      {offered && view.canOverride && !merge.confirming ? (
        <label className="touch-target flex items-start gap-2 rounded border border-border p-2 text-sm">
          <input
            type="checkbox"
            checked={override}
            disabled={busy}
            onChange={(event) => setOverride(event.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-accent"
          />
          <span>
            <span className="block font-semibold">{t.override}</span>
            <span className="block text-text-muted">{t.overrideHint}</span>
          </span>
        </label>
      ) : null}

      {offered && merge.confirming && gate.allowed ? (
        <Confirmation view={view} merge={merge} override={gate.override} />
      ) : offered ? (
        <div>
          <button type="button" className={PRIMARY} disabled={busy || !gate.allowed} onClick={() => merge.ask(view.headSha)}>
            {merge.pending === 'merge' ? t.merging : t.mergeButton}
          </button>
        </div>
      ) : null}
    </>
  )
}

/**
 * S-19 (#69): under the task's actions, its pull request's CI checks and merge state, and a merge
 * behind a confirmation naming the PR's number and title (brief R03). Browsing the PR's files,
 * reviews and comments stays on GitHub (N06).
 *
 * The server judges eligibility; the panel shows its judgement and offers the merge exactly when
 * the server would take it — or, where the server allows a bypass (`canOverride`), after the
 * operator ticks "merge without waiting". The merge names the head the operator saw, so a push in
 * between is refused rather than merged unseen. After every attempt the state is re-read.
 */
export function MergePanel({
  projectId,
  runId,
  number,
  prUrl,
}: {
  projectId: string
  runId: string
  number: number
  prUrl: string
}) {
  const queryClient = useQueryClient()
  const t = en.run.merge
  const query = useQuery(mergeStateQueryOptions(projectId, number))
  const merge = useMerge(projectId, runId, number)
  const panel = useMemo(() => (query.data ? mergePanelState(query.data, prUrl) : null), [query.data, prUrl])

  const refused = query.error instanceof AuthRequiredError
  useEffect(() => {
    if (refused) void queryClient.invalidateQueries({ queryKey: HEALTH_QUERY_KEY })
  }, [refused, queryClient])

  let body
  if (panel === null) {
    body =
      query.isError && !refused ? (
        <>
          <p className="text-sm">{t.loadFailed}</p>
          {apiErrorDetail(query.error) ? <p className="text-sm text-text-muted">{apiErrorDetail(query.error)}</p> : null}
        </>
      ) : (
        <p role="status" className="text-sm text-text-muted">
          {t.loading}
        </p>
      )
  } else if (panel.kind === 'unavailable') {
    body = (
      <p className="text-sm break-words">
        {t.unavailable} <span className="text-text-muted">{panel.reason}</span>
      </p>
    )
  } else if (panel.kind === 'unreadable') {
    body = <p className="text-sm text-text-muted">{t.unreadable}</p>
  } else if (panel.kind === 'other-pr') {
    body = <p className="text-sm text-text-muted">{t.otherPr}</p>
  } else {
    body = <MergeState view={panel.view} merge={merge} />
  }

  const canRefresh = panel?.kind !== 'other-pr'
  return (
    <section aria-label={t.label(number)} aria-busy={merge.pending !== undefined} className="flex flex-col gap-2 border-b border-border px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text-muted">{t.label(number)}</h3>
        {canRefresh ? (
          <button
            type="button"
            className={OUTLINE}
            disabled={merge.pending !== undefined || query.isFetching}
            onClick={() => void (query.data === undefined ? query.refetch() : merge.refresh())}
          >
            {merge.pending === 'refresh' ? t.refreshing : query.data === undefined && query.isError ? t.retry : t.refresh}
          </button>
        ) : null}
      </div>

      {body}

      {merge.error ? (
        <p role="alert" className="text-sm break-words text-danger">
          {merge.error}
        </p>
      ) : merge.notice ? (
        <p role="status" className="text-sm text-text-muted">
          {merge.notice}
        </p>
      ) : null}
    </section>
  )
}
