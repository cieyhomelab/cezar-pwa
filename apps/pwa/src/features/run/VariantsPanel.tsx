import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { Link } from 'react-router'
import { type AttentionInput, deriveAttention } from '@cezar-pwa/shared'
import { groupQueryOptions } from '../../api/groups.ts'
import { HEALTH_QUERY_KEY } from '../../api/health.ts'
import { AuthRequiredError } from '../../api/http.ts'
import { formatCost } from '../../domain/run-display.ts'
import { runPath } from '../../domain/run-header.ts'
import { pickOffer, type VariantRow, variantRows } from '../../domain/variants.ts'
import { apiErrorDetail } from '../../i18n/errors.ts'
import { en } from '../../i18n/en.ts'
import { StatusBadge } from '../runs-list/StatusBadge.tsx'
import type { PickVariant } from './usePickVariant.ts'

const BASE = 'touch-target inline-flex items-center justify-center rounded px-4 text-sm disabled:opacity-60'
const PRIMARY = `${BASE} bg-accent font-semibold text-white`
const OUTLINE = `${BASE} border border-border bg-surface-raised text-text`

function VariantLine({ row, projectId }: { row: VariantRow; projectId: string }) {
  const t = en.run.variants
  const cost = formatCost(row.costUsd)
  const details = [
    row.changedFiles !== undefined ? t.changes(row.changedFiles) : t.changesUnknown,
    ...(cost ? [cost] : []),
    ...(row.archived ? [t.archived] : []),
  ].join(' · ')
  const name = (
    <span>
      <span className="font-semibold">{t.variant(row.variant)}</span>
      {row.current ? <span className="text-text-muted"> · {t.thisOne}</span> : null}
    </span>
  )
  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex items-center justify-between gap-3">
        {row.current ? (
          <span aria-current="page" className="touch-target inline-flex items-center">
            {name}
          </span>
        ) : (
          <Link to={runPath(projectId, row.id)} className="touch-target inline-flex items-center text-accent">
            {name}
          </Link>
        )}
        <StatusBadge attention={deriveAttention({ status: row.status } as AttentionInput)} status={row.status} />
      </div>
      <p className="text-sm text-text-muted">{details}</p>
    </li>
  )
}

/**
 * S-21 (#71): under the actions of a task started ×2 or ×3, its sibling variants with their
 * status, change count and cost, each opening its own task screen, and "Keep this one" behind a
 * confirmation. Side-by-side diff comparison is the cockpit's (N07).
 *
 * `pick` lives on the screen, so the task's other actions wait for it as it waits for them
 * (`busy`: an action or a send in flight).
 */
export function VariantsPanel({
  projectId,
  runId,
  groupId,
  pick,
  busy,
}: {
  projectId: string
  runId: string
  groupId: string
  pick: PickVariant
  busy: boolean
}) {
  const queryClient = useQueryClient()
  const t = en.run.variants
  const group = useQuery(groupQueryOptions(projectId, groupId))
  const rows = useMemo(() => (group.data ? variantRows(group.data, runId) : []), [group.data, runId])
  const current = rows.find((row) => row.current)
  const offer = pickOffer(rows)
  // Every other variant, archived ones included: an archived task keeps its worktree, and the
  // pick removes the worktree and branch of each loser all the same.
  const others = rows.filter((row) => !row.current).length

  const refused = group.error instanceof AuthRequiredError
  useEffect(() => {
    if (refused) void queryClient.invalidateQueries({ queryKey: HEALTH_QUERY_KEY })
  }, [refused, queryClient])

  if (group.data === undefined) {
    if (group.isError && !refused) {
      return (
        <section aria-label={t.label} className="flex flex-col gap-2 border-b border-border px-4 py-3 text-sm">
          <p>{t.loadFailed}</p>
          {apiErrorDetail(group.error) ? <p className="text-text-muted">{apiErrorDetail(group.error)}</p> : null}
          <div>
            <button type="button" className={OUTLINE} onClick={() => void group.refetch()} disabled={group.isFetching}>
              {t.retry}
            </button>
          </div>
        </section>
      )
    }
    return (
      <p role="status" aria-label={t.label} className="border-b border-border px-4 py-3 text-sm text-text-muted">
        {t.loading}
      </p>
    )
  }

  // A group of one (the others deleted) is not a choice.
  if (rows.length < 2) return null

  return (
    <section aria-label={t.label} className="flex flex-col gap-1 border-b border-border px-4 py-3">
      <h3 className="text-sm font-semibold text-text-muted">{t.label}</h3>
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((row) => (
          <VariantLine key={row.id} row={row} projectId={projectId} />
        ))}
      </ul>

      {pick.confirming && offer === 'offer' && current ? (
        <div
          role="alertdialog"
          aria-labelledby="pick-title"
          aria-describedby="pick-body"
          className="mt-2 flex flex-col gap-2 rounded bg-surface-raised p-3"
        >
          <h4 id="pick-title" className="font-semibold">
            {t.confirm.title(current.variant)}
          </h4>
          <p id="pick-body" className="text-sm text-text-muted">
            {t.confirm.body(others)}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={OUTLINE} onClick={pick.back}>
              {t.confirm.back}
            </button>
            <button type="button" className={PRIMARY} disabled={busy || pick.pending} onClick={() => void pick.keep()}>
              {t.confirm.confirm(current.variant)}
            </button>
          </div>
        </div>
      ) : offer === 'offer' ? (
        <div className="mt-2">
          <button type="button" className={PRIMARY} disabled={busy || pick.pending} onClick={pick.ask}>
            {pick.pending ? t.keeping : t.keep}
          </button>
        </div>
      ) : offer === 'wait' ? (
        <p className="mt-1 text-sm text-text-muted">{t.waitToKeep}</p>
      ) : null}

      {pick.error ? (
        <p role="alert" className="text-sm break-words text-danger">
          {pick.error}
        </p>
      ) : pick.notice ? (
        <p role="status" className="text-sm text-text-muted">
          {pick.notice}
        </p>
      ) : null}
    </section>
  )
}
