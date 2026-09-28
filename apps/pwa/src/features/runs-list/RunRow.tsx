import type { RunIndexEntry } from '@cezar-pwa/cezar-contract/contract'
import { deriveAttention, isReadDoneItem, isUnread } from '@cezar-pwa/shared'
import { useId, useState } from 'react'
import { Link } from 'react-router'
import { runPath } from '../../domain/run-header.ts'
import type { ListRow } from '../../domain/task-list.ts'
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
 * #101: the "N subtasks" chip as the fold's handle — a real button outside the row's link, so
 * a tap on it never opens the task. Collapsed is the default; the state lives here and is not
 * persisted, as in the cockpit (Cezar #1110, `subtask-toggle.tsx`).
 */
function Subtasks({
  rows,
  projectName,
  now,
}: {
  rows: ListRow[]
  projectName: (projectId: string) => string
  now: number
}) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const label = en.runs.subtasks.count(rows.length)
  return (
    <>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-label={expanded ? en.runs.subtasks.collapse(label) : en.runs.subtasks.expand(label)}
        onClick={() => setExpanded((value) => !value)}
        className="touch-target -mt-2 mb-1 ml-3 inline-flex items-center gap-1.5 rounded px-1 text-xs text-text-muted active:bg-surface-raised"
      >
        <span
          aria-hidden="true"
          className={`inline-block w-3 text-center text-base leading-none transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          ›
        </span>
        <span className="rounded-full border border-border px-2 py-0.5">{label}</span>
      </button>
      {expanded ? (
        <ul id={listId} className="ml-4 border-t border-l border-border">
          {rows.map((row) => (
            <RunRow
              key={`${row.run.projectId}/${row.run.id}`}
              run={row.run}
              queuePosition={row.queuePosition}
              subtasks={row.children}
              projectName={projectName}
              now={now}
            />
          ))}
        </ul>
      ) : null}
    </>
  )
}

/**
 * One task, readable without opening it (FR-009): status, title, project, timing, cost,
 * unread marker and PR/issue number. The whole row is the link to the task (S-05). The
 * reference stays text: a nested link inside a tappable row would fight it for the tap.
 * A parent of dispatched subtasks also carries their fold, below its link.
 */
export function RunRow({
  run,
  queuePosition,
  subtasks,
  projectName,
  now,
}: {
  run: RunIndexEntry
  queuePosition: number | null
  /** #101: dispatched subtasks folded under this row. */
  subtasks?: ListRow[] | undefined
  projectName: (projectId: string) => string
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
  const meta = [projectName(run.projectId), timing, cost].filter(Boolean)

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
      {subtasks && subtasks.length > 0 ? (
        <Subtasks rows={subtasks} projectName={projectName} now={now} />
      ) : null}
    </li>
  )
}
