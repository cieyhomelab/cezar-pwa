import type { ApiRun } from '@cezar-pwa/cezar-contract/contract'
import { isRunActive, lastSessionId } from './answer.ts'

/**
 * S-08: which actions a task offers (FR-025 to FR-029), as a pure function of the record. A port
 * of the cockpit's policy at `v0.11.0`: `runActionFlags` in
 * `packages/web/src/routes/task-thread/run-actions.ts` for the header, plus the review panel's
 * Draft PR gate (`review-panel.tsx`). The phone offers an action exactly when the laptop does,
 * so the two never disagree about what a task can still do.
 */

/** Only these fields decide the actions, so the tests do not need whole records. */
export type ActionRun = Pick<ApiRun, 'status' | 'steps' | 'archived' | 'pinned' | 'pullRequestUrl'>

export interface RunActionFlags {
  /** Stop the run, behind a confirmation (FR-025). While the engine owns it. */
  cancel: boolean
  /** `POST …/finish`: `review` accepts the changes without a PR (FR-026), `waiting` closes the
   *  session. The cockpit offers both on one button with two meanings. */
  finish: boolean
  /** Open a draft PR (FR-027). Only at the review gate, and only while no PR is known: a second
   *  tap would open a duplicate. The server refuses a run without a worktree, with its reason. */
  draftPr: boolean
  /** Reopen the last agent session (FR-028). Needs a closed run with a recorded session. */
  continueRun: boolean
  /** Pin or unpin (FR-029). Not for an archived run: archiving retires the pin server-side. */
  pin: boolean
  /** Archive, or restore from the archive (FR-029). Not while the engine owns the run. */
  archive: boolean
}

function isHttpUrl(url: unknown): boolean {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
}

export function runActionFlags(run: ActionRun): RunActionFlags {
  const active = isRunActive(run.status)
  const hasSession = lastSessionId(run) !== undefined
  return {
    cancel: active,
    finish: run.status === 'waiting' || run.status === 'review',
    draftPr: run.status === 'review' && !isHttpUrl(run.pullRequestUrl),
    continueRun: !active && hasSession,
    pin: run.archived !== true,
    archive: !active,
  }
}

/** Every action the task screen can take. One at a time: two writes in flight at once would
 *  reach Cezar in an order nobody chose. */
export type RunActionId = 'cancel' | 'finish' | 'draftPr' | 'continue' | 'pin' | 'archive'
