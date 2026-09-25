import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { Link } from 'react-router'
import { HEALTH_QUERY_KEY } from '../../api/health.ts'
import { ApiError, AuthRequiredError } from '../../api/http.ts'
import { limitsQueryOptions } from '../../api/limits.ts'
import { limitCards } from '../../domain/limits.ts'
import { apiErrorDetail } from '../../i18n/errors.ts'
import { en } from '../../i18n/en.ts'
import { useNow } from '../runs-list/useNow.ts'
import { LimitCard } from './LimitCard.tsx'

/**
 * #93: how much of each agent account's 5-hour and weekly window is used, and when it resets —
 * read from the push sidecar (`GET /m/push/limits`, #92). Refreshes on open and on return to the
 * foreground; the countdowns tick while it stays open, but nothing polls in the background.
 */
export function LimitsScreen() {
  const t = en.limits
  const queryClient = useQueryClient()
  const now = useNow(15_000)
  const limits = useQuery(limitsQueryOptions())
  const cards = useMemo(() => (limits.data ? limitCards(limits.data, now) : []), [limits.data, now])

  // A refusal means the session lapsed: the gate knows how to say so (FR-004).
  const refused = limits.error instanceof AuthRequiredError
  useEffect(() => {
    if (refused) void queryClient.invalidateQueries({ queryKey: HEALTH_QUERY_KEY })
  }, [refused, queryClient])

  // A 404 from the sidecar is not a transient failure: its bundle predates `GET /m/push/limits`
  // (#92), and no amount of retrying fixes that — say what does.
  const outdated = limits.error instanceof ApiError && limits.error.status === 404
  const detail = outdated ? t.sidecarOutdated : apiErrorDetail(limits.error)
  const retry = (
    <button
      type="button"
      className="touch-target rounded border border-border px-4 text-sm disabled:opacity-60"
      onClick={() => void limits.refetch()}
      disabled={limits.isFetching}
    >
      {limits.isFetching ? t.retrying : t.retry}
    </button>
  )

  let body
  if (limits.data === undefined) {
    body =
      limits.isError && !refused ? (
        <section role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p>{t.loadFailed}</p>
          {detail ? <p className="text-sm text-text-muted">{detail}</p> : null}
          {retry}
        </section>
      ) : (
        <p role="status" className="flex flex-1 items-center justify-center px-6 text-text-muted">
          {t.loading}
        </p>
      )
  } else {
    body = (
      <>
        {limits.isError && !refused ? (
          <div role="alert" className="mx-4 flex flex-col gap-2 rounded bg-surface-raised px-3 py-2 text-sm">
            <p>{t.refreshFailed}</p>
            {detail ? <p className="text-text-muted">{detail}</p> : null}
            <div>{retry}</div>
          </div>
        ) : null}
        {cards.length === 0 ? (
          <p className="px-6 py-8 text-center text-text-muted">{t.empty}</p>
        ) : (
          <ul aria-label={t.title} className="flex flex-col gap-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {cards.map((card) => (
              <LimitCard key={card.key} card={card} />
            ))}
          </ul>
        )}
      </>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="sticky top-0 z-20 flex h-11 items-center border-b border-border bg-surface px-2">
        <Link to="/" className="touch-target inline-flex items-center px-2 text-accent">
          <span aria-hidden="true">‹&nbsp;</span>
          {t.back}
        </Link>
      </div>
      <h2 className="px-4 pt-3 pb-3 text-lg font-semibold">{t.title}</h2>
      {body}
    </div>
  )
}
