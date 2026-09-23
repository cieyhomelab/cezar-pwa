import type { LiveState } from '../../api/workspace-events.ts'
import { en } from '../../i18n/en.ts'

const DOT: Record<LiveState, { glyph: string; className: string }> = {
  live: { glyph: '●', className: 'text-success' },
  connecting: { glyph: '◌', className: 'text-text-muted motion-safe:animate-pulse' },
  reconnecting: { glyph: '◌', className: 'text-pending motion-safe:animate-pulse' },
  lost: { glyph: '○', className: 'text-danger' },
}

/**
 * FR-012: healthy, reconnecting or lost — in words, with a glyph and a colour, never colour
 * alone. When the list is not live the age of what is on screen follows (US-02: "a stale list is
 * never mistaken for a quiet one"); while live there is nothing to add, it is current.
 */
export function ConnectionStatus({
  state,
  detail,
}: {
  state: LiveState
  /** Freshness or activity, said after the state — `en.runs.listFrom`, `en.runs.refreshingInline`. */
  detail?: string
}) {
  const dot = DOT[state] ?? DOT.lost
  return (
    <p role="status" data-live-state={state} className="flex min-w-0 items-center gap-1.5">
      <span aria-hidden="true" className={`inline-block w-3 text-center ${dot.className}`}>
        {dot.glyph}
      </span>
      <span className="truncate">
        {en.runs.live[state] ?? state}
        {detail ? ` · ${detail}` : ''}
      </span>
    </p>
  )
}
