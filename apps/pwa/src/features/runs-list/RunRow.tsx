import type { RunIndexEntry } from '@cezar-pwa/cezar-contract/contract'
import { deriveAttention, isReadDoneItem, isUnread } from '@cezar-pwa/shared'
import { Link } from 'react-router'
import { runPath } from '../../domain/run-header.ts'
import { en } from '../../i18n/en.ts'
import {
  formatCost,
  refPrefixMatches,
  runTiming,
  runTitle,
  splitRefPrefix,
  taskReference,
  type RunTiming,
} from '../../domain/run-display.ts'
import { StatusBadge } from './StatusBadge.tsx'

function timingText(timing: RunTiming): string {
  switch (timing.kind) {
    case 'queued':
      return en.runs.timing.queued(timing.position)
    case 'scheduled':
      return en.runs.timing.scheduled(timing.at)
    case 'since':
      return en.runs.timing.since(timing.age)
    case 'ago':
      return en.runs.timing.ago(timing.age)
    default:
      return ''
  }
}

/**
 * One task, readable without opening it (FR-009): status, title, project, timing, cost,
 * unread marker and PR/issue number. The whole row is the link to the task (S-05). The
 * reference stays text: a nested link inside a tappable row would fight it for the tap.
 */
export function RunRow({
  run,
  queuePosition,
  projectName,
  now,
}: {
  run: RunIndexEntry
  queuePosition: number | null
  projectName: string
  now: number
}) {
  const attention = deriveAttention(run)
  const reference = taskReference(run)
  const title = runTitle(run)
  // The cockpit's #788 rule: `79: fixing docs` beside a `PR #79` chip says the number once.
  const displayTitle = refPrefixMatches(title, reference?.number) ? splitRefPrefix(title).rest : title
  const unread = isUnread(run)
  const cost = formatCost(run.costUsd)
  const timing = timingText(runTiming(run, queuePosition, now))
  const meta = [projectName, timing, cost].filter(Boolean)

  return (
    <li
      data-run-id={run.id}
      data-run-key={`${run.projectId}/${run.id}`}
      className={`border-b border-border ${isReadDoneItem(run) ? 'opacity-70' : ''}`}
    >
      <Link to={runPath(run.projectId, run.id)} className="block px-4 py-3 active:bg-surface-raised">
        <div className="flex items-center justify-between gap-3">
          <StatusBadge attention={attention} status={run.status} />
          {reference ? (
            <span className="shrink-0 rounded border border-border px-1.5 text-xs text-text-muted">
              {en.runs.reference[reference.kind](reference.number)}
            </span>
          ) : null}
        </div>
        <p className={`mt-1 line-clamp-2 break-words ${unread ? 'font-semibold' : ''}`}>
          {displayTitle}
          {unread ? (
            <>
              {' '}
              <span aria-hidden="true" className="text-violet">
                ●
              </span>
              <span className="sr-only">({en.runs.unread})</span>
            </>
          ) : null}
        </p>
        <p className="mt-0.5 text-sm text-text-muted">{meta.join(' · ')}</p>
      </Link>
    </li>
  )
}
