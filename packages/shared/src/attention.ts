import type { RunActivity, RunStatus } from './types.ts'

/**
 * Why a run needs the operator's attention. `null` means "no attention".
 *
 * Mirrors the reasons named in `docs/CEZAR_API.md` §5. The exact return shape of
 * upstream `deriveAttention()` is not reproducible from the docs alone; reconcile
 * it against `packages/web/src/lib/attention.ts` when the contract is synced.
 */
export type AttentionReason = 'permission' | 'waiting' | 'review' | 'failed'

/**
 * The fields the attention rule reads. A superset (a full `RunIndexEntry` or
 * `RunRecord`) is accepted — extra fields are ignored (CLAUDE.md rule 5).
 */
export type AttentionInput = {
  status: RunStatus
  /** `'monitoring'` marks a `running` run that waits on its own background work. */
  activity?: RunActivity | null
  /** Set on a `failed` run that Cezar will resume itself (provider limit). */
  autoResumeAt?: string | number | Date | null
  /**
   * Whether an unresolved `permission.requested` event is outstanding.
   *
   * Always `false`/absent on this instance: the branch is unreachable because
   * Cezar ships no emitter for the event (`docs/CEZAR_API.md` §5a, verified
   * 2026-09-20). Kept because the rule must stay 1:1 with the cockpit
   * (CLAUDE.md rule 8) and the dictionary is append-only — an emitter may land
   * in any release.
   */
  hasPendingPermissionRequest?: boolean
}

/**
 * Copy of `deriveAttention()` from Cezar's `packages/web/src/lib/attention.ts`
 * (CLAUDE.md rule 8), as documented in `docs/CEZAR_API.md` §5.
 *
 * First match wins. Order is load-bearing: branch 2 must precede branch 5, or a
 * self-resuming `failed` run would be reported as an error.
 */
export function deriveAttention(run: AttentionInput): AttentionReason | null {
  // 1. Pending permission request — highest priority. Unreachable on this
  //    instance; see AttentionInput.hasPendingPermissionRequest.
  if (run.hasPendingPermissionRequest) return 'permission'

  // 2. `failed` with a scheduled auto-resume is "scheduled", not an error.
  if (run.status === 'failed' && run.autoResumeAt != null) return null

  // 3. Waiting on an answer from the operator.
  if (run.status === 'waiting') return 'waiting'

  // 4. Awaiting review.
  if (run.status === 'review') return 'review'

  // 5. Genuinely failed.
  if (run.status === 'failed') return 'failed'

  // 6. `running` + monitoring — the agent waits on its own work, not on us.
  if (run.status === 'running' && run.activity === 'monitoring') return null

  return null
}

/** Whether a run belongs in the "Wymaga uwagi" section (`F-LIST-2`). */
export function needsAttention(run: AttentionInput): boolean {
  return deriveAttention(run) !== null
}

/**
 * Sort weight inside the attention section, per `F-LIST-2`:
 * permission → waiting → review → failed.
 */
export const ATTENTION_PRIORITY: Record<AttentionReason, number> = {
  permission: 0,
  waiting: 1,
  review: 2,
  failed: 3,
}
