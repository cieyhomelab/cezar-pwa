import type { PlanEntry } from '@cezar-pwa/cezar-contract/protocol'
import { planProgress } from '../../domain/transcript.ts'
import { pl } from '../../i18n/pl.ts'

const GLYPH: Record<string, string> = {
  completed: '✓',
  in_progress: '◐',
  pending: '○',
  cancelled: '–',
}

/**
 * The agent's current plan as a checklist (FR-018). It lives in the screen's sticky bar, so it
 * stays pinned above the transcript while that scrolls. Collapsed, it is one line with the
 * progress and the step in hand. Expanded, it shows the whole list, capped so it can never
 * cover the screen. Nothing renders without a plan, and nothing renders for an emptied one: an
 * empty snapshot replaced the plan with nothing.
 */
export function PlanPanel({ entries }: { entries: PlanEntry[] | undefined }) {
  if (entries === undefined || entries.length === 0) return null
  const { done, total } = planProgress(entries)
  const current = entries.find((entry) => entry.status === 'in_progress')

  return (
    <details className="border-t border-border text-sm" data-testid="plan">
      <summary className="touch-target flex cursor-pointer list-none items-center gap-2 px-4">
        <span className="font-semibold">{pl.run.plan.title}</span>
        <span className="text-text-muted">{pl.run.plan.progress(done, total)}</span>
        {current ? (
          <span className="min-w-0 flex-1 truncate text-text-muted">· {current.activeForm ?? current.content}</span>
        ) : (
          <span className="flex-1" />
        )}
        <span aria-hidden="true" className="text-text-muted">
          ▾
        </span>
      </summary>
      <ul className="max-h-[40vh] overflow-y-auto px-4 pb-2">
        {entries.map((entry, index) => {
          const word = pl.run.plan.status[entry.status] ?? entry.status
          return (
            <li key={index} className="flex gap-2 py-1">
              <span
                className={`inline-block w-4 shrink-0 text-center ${
                  entry.status === 'completed'
                    ? 'text-success'
                    : entry.status === 'in_progress'
                      ? 'text-pending'
                      : 'text-text-muted'
                }`}
              >
                <span aria-hidden="true">{GLYPH[entry.status] ?? '•'}</span>
                <span className="sr-only">{word}</span>
              </span>
              <span
                className={`min-w-0 break-words ${
                  entry.status === 'cancelled' ? 'text-text-muted line-through' : ''
                } ${entry.status === 'completed' ? 'text-text-muted' : ''}`}
              >
                {entry.content}
              </span>
            </li>
          )
        })}
      </ul>
    </details>
  )
}
