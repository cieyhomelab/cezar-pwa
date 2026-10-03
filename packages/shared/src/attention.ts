import type { RunActivity, RunStatus } from './types.ts'

/**
 * Copy of Cezar's `packages/web/src/lib/attention.ts` (CLAUDE.md rule 8), at the commit in
 * `packages/cezar-contract/UPSTREAM` (tag `v0.14.0`). Unchanged from `v0.11.0` through `v0.13.0` (re-diffed for #72, #98 and #106);
 * `v0.14.0` added `budgetStop` and the `budget reached` label (Cezar #1150, synced in #111).
 *
 * The PRD's worst failure is a phone that disagrees with the cockpit about what needs a human,
 * so this is a transcription, not a re-derivation: same ladder, same buckets, same tones, same
 * labels, same first-match-wins order. Only the imports and these comments differ. When the
 * contract is re-synced, diff this file against the upstream one at the new sha.
 *
 * UI-free on purpose, like the original: the PWA list and the push sidecar both call it, and
 * the sidecar has no React.
 */

/**
 * The attention priority ladder, highest first (upstream spec: permission > error >
 * waiting/review > running > unseen). `rank` is the contract — the table test asserts it.
 */
export const ATTENTION_RANK = {
  permission: 0,
  error: 1,
  waiting: 2,
  running: 3,
  unseen: 4,
  none: 5,
} as const

export type AttentionBucket = keyof typeof ATTENTION_RANK

/** The cockpit's dot tones. The PWA maps them onto its own colour tokens. */
export type AttentionTone = 'success' | 'pending' | 'danger' | 'violet' | 'neutral'

export interface Attention {
  bucket: AttentionBucket
  tone: AttentionTone
  /** True while the run is *transitioning* — "pulsing while transitioning". */
  pulse: boolean
  /**
   * Lower-case English phrase, verbatim from upstream. It is a KEY, not copy: the PWA
   * translates it through `src/i18n/en.ts`, so an upstream label this copy has never seen
   * shows up as a missing translation rather than as a wrong one.
   */
  label: string
}

/**
 * Whether a run is blocked on a permission prompt.
 *
 * Always false, exactly as upstream: Cezar emits no `permission.*` events and `RunRecord`
 * carries no field meaning "a tool wants approval" (`docs/CEZAR_API.md` § 5a). The rung stays
 * in the ladder so this file keeps matching the cockpit when upstream wires it.
 */
function hasPendingPermission(_run: AttentionInput): boolean {
  return false
}

/**
 * Whether a run finished while the operator was not looking. Always false upstream by design:
 * "unread" rides its own channel (`read-state.ts`) so it never recolours the status dot.
 */
function isUnseen(_run: AttentionInput): boolean {
  return false
}

/**
 * What attention derivation reads. Upstream is `Pick<RunRecord, 'status' | 'activity' |
 * 'autoResumeAt' | 'dispatch' | 'costUsd'>`; spelled out here because this package does not
 * depend on the contract, with `dispatch` narrowed to what the rule reads.
 * A `RunIndexEntry` or a `RunRecord` satisfies it, extra fields ignored (CLAUDE.md rule 5).
 *
 * The index entry's `dispatch` carries only `rootRunId`, `parentRunId` and `kind`, so anything
 * fed by the runs index (the PWA's list row, like the cockpit's global Tasks page) never says
 * `budget reached`. The full record does: the task screen, and the push sidecar, which reads
 * the workspace stream's `run` frames.
 */
export type AttentionInput = {
  status: RunStatus
  activity?: RunActivity
  autoResumeAt?: string
  /** `rootRunId` is not read: it is the key every `dispatch` carries, so the index entry's
   *  narrower object (no budget keys at all) still type-checks against this one. */
  dispatch?: { rootRunId?: string; budgetUsd?: number; overBudget?: boolean }
  costUsd?: number
}

export type BudgetStop = {
  spent: number
  ceiling: number
}

/**
 * Why a dispatched task is parked on its spend ceiling, or `undefined` when it is not. Still an
 * attention state: the operator decides whether to send a message once the ceiling is reached.
 * It only explains the brake the server persisted (`dispatch.overBudget`).
 */
export function budgetStop(run: Pick<AttentionInput, 'status' | 'dispatch' | 'costUsd'>): BudgetStop | undefined {
  const ceiling = run.dispatch?.overBudget ? run.dispatch.budgetUsd : undefined
  if (run.status !== 'waiting' || ceiling === undefined) return undefined
  return { spent: run.costUsd ?? 0, ceiling }
}

/**
 * Run → attention. The chain below IS the priority order — first match wins.
 *
 * Two rungs are the counter-intuitive ones the PRD calls out (Business Logic): a `failed` run
 * with a booked auto-resume is `scheduled`, not an error, and must come before the `failed`
 * rung; a `running` run that is only `monitoring` its own background work asks nothing.
 */
export function deriveAttention(run: AttentionInput): Attention {
  if (hasPendingPermission(run)) {
    return { bucket: 'permission', tone: 'violet', pulse: true, label: 'needs permission' }
  }
  if (run.status === 'failed' && run.autoResumeAt) {
    return { bucket: 'none', tone: 'pending', pulse: false, label: 'scheduled' }
  }
  if (run.status === 'failed') {
    return { bucket: 'error', tone: 'danger', pulse: false, label: 'failed' }
  }
  if (run.status === 'waiting') {
    return {
      bucket: 'waiting',
      tone: 'pending',
      pulse: true,
      label: budgetStop(run)?.ceiling !== undefined ? 'budget reached' : 'needs you',
    }
  }
  if (run.status === 'review') {
    return { bucket: 'waiting', tone: 'violet', pulse: true, label: 'needs review' }
  }
  if (run.status === 'running' && run.activity === 'monitoring') {
    return { bucket: 'running', tone: 'violet', pulse: true, label: 'monitoring' }
  }
  if (run.status === 'running') {
    return { bucket: 'running', tone: 'violet', pulse: true, label: 'running' }
  }
  if (isUnseen(run)) {
    return { bucket: 'unseen', tone: 'violet', pulse: false, label: 'unseen' }
  }
  if (run.status === 'queued') {
    return { bucket: 'none', tone: 'neutral', pulse: false, label: 'queued' }
  }
  if (run.status === 'done') {
    return { bucket: 'none', tone: 'success', pulse: false, label: 'done' }
  }
  return { bucket: 'none', tone: 'neutral', pulse: false, label: 'cancelled' }
}

/**
 * True when a run is asking for a human: a permission prompt, an error, or a waiting/review
 * gate — the top three rungs. Upstream's notification predicate.
 *
 * The PRD makes this ONE answer for three surfaces — the list's top section, the notification,
 * and the icon badge ("all three must agree, always") — so the PWA's "Wymaga uwagi" section is
 * exactly this. Note that the cockpit's sidebar "Needs you" bucket is narrower (waiting/review
 * only, failed runs sit under Recent); the PRD sides with the notification rule, not the sidebar.
 */
export function wantsAttention(run: AttentionInput): boolean {
  return ATTENTION_RANK[deriveAttention(run).bucket] <= ATTENTION_RANK.waiting
}
