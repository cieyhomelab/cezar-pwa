import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { ApiRun } from '@cezar-pwa/cezar-contract/contract'
import { deriveAttention } from '@cezar-pwa/shared'
import { formatCost, runTitle } from '../../domain/run-display.ts'
import { diffPath, prLink, runnerModel, stepProgress, tokenSummary, workflowLabel } from '../../domain/run-header.ts'
import { en } from '../../i18n/en.ts'
import { DiffCounts } from '../diff/DiffCounts.tsx'
import { StatusBadge } from '../runs-list/StatusBadge.tsx'

const ACTION = 'touch-target inline-flex items-center gap-2 rounded border border-border px-3 text-sm text-accent'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-20 shrink-0 text-text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  )
}

/**
 * The task header (FR-014): status, workflow, step progress, runner and model, cost, tokens,
 * branch and PR link. A value the record does not carry leaves its row out rather than showing
 * a zero it never measured. S-09: the changes button is always there, since the record's `diffStat`
 * only arrives with the first finished turn; the diff screen says why when there is nothing.
 * #109: the changes and the PR are actions, so they sit under the details as buttons.
 */
export function RunHeader({ run, projectId, projectName }: { run: ApiRun; projectId: string; projectName: string }) {
  const progress = stepProgress(run)
  const agent = runnerModel(run)
  const cost = formatCost(run.costUsd)
  const tokens = tokenSummary(run)
  const pr = prLink(run)

  return (
    <section className="flex flex-col gap-2 border-b border-border px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusBadge attention={deriveAttention(run)} status={run.status} />
          {/* S-08: an archived task is off the list, so the screen says where it went. */}
          {run.archived ? <span className="text-sm text-text-muted">{en.run.actions.archivedBadge}</span> : null}
          {run.pinned && !run.archived ? (
            <span className="text-sm text-text-muted">{en.run.actions.pinnedBadge}</span>
          ) : null}
        </span>
        <span className="min-w-0 truncate text-sm text-text-muted">{projectName}</span>
      </div>
      <h2 className="text-lg leading-snug font-semibold break-words">{runTitle(run)}</h2>
      <dl className="flex flex-col gap-1 text-sm">
        <Row label={en.run.header.workflow}>
          {workflowLabel(run)}
          {progress ? (
            <span className="block text-text-muted">
              {en.run.header.step(progress.position, progress.total, progress.name)}
            </span>
          ) : null}
        </Row>
        {agent ? <Row label={en.run.header.agent}>{agent}</Row> : null}
        {cost ? <Row label={en.run.header.cost}>{cost}</Row> : null}
        {tokens ? (
          <Row label={en.run.header.tokens}>
            {tokens.kind === 'directional'
              ? en.run.header.tokensDirectional(tokens.input, tokens.output)
              : tokens.total}
          </Row>
        ) : null}
        {run.branch ? (
          <Row label={en.run.header.branch}>
            <span className="font-mono text-xs">{run.branch}</span>
          </Row>
        ) : null}
      </dl>
      {/* #109: what the operator opens from here, side by side as buttons rather than as two
          more label rows with a link at the far end. */}
      <div className="flex flex-wrap gap-2 pt-1">
        <Link to={diffPath(projectId, run.id)} className={ACTION}>
          {run.diffStat && run.diffStat.files > 0 ? (
            <>
              {en.run.diff.files(run.diffStat.files)}
              <DiffCounts adds={run.diffStat.adds} dels={run.diffStat.dels} />
            </>
          ) : (
            en.run.header.showChanges
          )}
        </Link>
        {pr ? (
          <a href={pr.url} target="_blank" rel="noopener noreferrer" className={ACTION}>
            {en.run.header.pr(pr.number)}
            <span aria-hidden="true">↗</span>
          </a>
        ) : null}
      </div>
    </section>
  )
}
