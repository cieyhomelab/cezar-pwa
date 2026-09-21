import type { Attention, AttentionTone, RunStatus } from '@cezar-pwa/shared'
import { pl } from '../../i18n/pl.ts'

const TONE_CLASS: Record<AttentionTone, string> = {
  success: 'text-success',
  pending: 'text-pending',
  danger: 'text-danger',
  violet: 'text-violet',
  neutral: 'text-text-muted',
}

/** A glyph per label, so two statuses sharing a tone (waiting/scheduled, review/running) still
 *  look different to someone who cannot tell the colours apart. */
const GLYPH: Record<string, string> = {
  'needs permission': '!',
  'needs you': '?',
  'needs review': '◆',
  failed: '✕',
  scheduled: '◷',
  monitoring: '◌',
  running: '●',
  queued: '…',
  done: '✓',
  cancelled: '–',
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set<RunStatus>([
  'queued',
  'running',
  'waiting',
  'review',
  'done',
  'failed',
  'cancelled',
])

/**
 * A run's status as the cockpit derives it (`deriveAttention`), said three ways at once: a
 * colour, a glyph and a word. The word is what a screen reader reads.
 *
 * A status this client has never heard of (the vocabulary only grows) is shown as its own raw
 * name, neutral and still. `deriveAttention` would call it `cancelled` — its last rung is a
 * catch-all — and telling the operator a task was cancelled when it is in some new state is
 * exactly the confidently-wrong status the PRD calls the worst failure.
 */
export function StatusBadge({ attention, status }: { attention: Attention; status: string }) {
  const known = KNOWN_STATUSES.has(status)
  const text = (known ? pl.runs.status[attention.label] : undefined) ?? status
  const tone: AttentionTone = known ? attention.tone : 'neutral'
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${TONE_CLASS[tone]}`}>
      <span
        aria-hidden="true"
        className={`inline-block w-4 text-center ${known && attention.pulse ? 'motion-safe:animate-pulse' : ''}`}
      >
        {(known ? GLYPH[attention.label] : undefined) ?? '•'}
      </span>
      {text}
    </span>
  )
}
