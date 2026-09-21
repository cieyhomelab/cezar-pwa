import type { ReactNode } from 'react'
import type { ApiRun } from '@cezar-pwa/cezar-contract/contract'
import { deriveAttention } from '@cezar-pwa/shared'
import { formatCost, runTitle } from '../../domain/run-display.ts'
import { prLink, runnerModel, stepProgress, tokenSummary, workflowLabel } from '../../domain/run-header.ts'
import { pl } from '../../i18n/pl.ts'
import { StatusBadge } from '../runs-list/StatusBadge.tsx'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  )
}

/**
 * The task header (FR-014): status, workflow, step progress, runner and model, cost, tokens,
 * branch and PR link. A value the record does not carry leaves its row out rather than showing
 * a zero it never measured.
 */
export function RunHeader({ run, projectName }: { run: ApiRun; projectName: string }) {
  const progress = stepProgress(run)
  const agent = runnerModel(run)
  const cost = formatCost(run.costUsd)
  const tokens = tokenSummary(run)
  const pr = prLink(run)

  return (
    <section className="flex flex-col gap-2 border-b border-border px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <StatusBadge attention={deriveAttention(run)} status={run.status} />
        <span className="min-w-0 truncate text-sm text-text-muted">{projectName}</span>
      </div>
      <h2 className="text-lg leading-snug font-semibold break-words">{runTitle(run)}</h2>
      <dl className="flex flex-col gap-1 text-sm">
        <Row label={pl.run.header.workflow}>
          {workflowLabel(run)}
          {progress ? (
            <span className="block text-text-muted">
              {pl.run.header.step(progress.position, progress.total, progress.name)}
            </span>
          ) : null}
        </Row>
        {agent ? <Row label={pl.run.header.agent}>{agent}</Row> : null}
        {cost ? <Row label={pl.run.header.cost}>{cost}</Row> : null}
        {tokens ? (
          <Row label={pl.run.header.tokens}>
            {tokens.kind === 'directional'
              ? pl.run.header.tokensDirectional(tokens.input, tokens.output)
              : tokens.total}
          </Row>
        ) : null}
        {run.branch ? (
          <Row label={pl.run.header.branch}>
            <span className="font-mono text-xs">{run.branch}</span>
          </Row>
        ) : null}
        {pr ? (
          <Row label="PR">
            <a
              href={pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="touch-target inline-flex items-center text-accent underline"
            >
              {pl.run.header.pr(pr.number)}
            </a>
          </Row>
        ) : null}
      </dl>
    </section>
  )
}
