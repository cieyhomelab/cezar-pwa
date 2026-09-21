import type { RunStatus } from './types.ts'

/**
 * Copy of Cezar's `packages/web/src/lib/read-state.ts` at the commit in
 * `packages/cezar-contract/UPSTREAM` (tag `v0.11.0`) — the email-style "which finished tasks
 * still need my eyes?" signal, i.e. the list row's unread marker (FR-009).
 *
 * Copied rather than re-derived for the same reason as `attention.ts`: a row the cockpit calls
 * read and the phone calls unread is a disagreement the operator can see. Only the parts the
 * PWA reads are carried; when re-syncing, diff against upstream.
 */

/** The terminal statuses a *done item* can be. */
const DONE_STATUSES: readonly RunStatus[] = ['done', 'failed', 'cancelled']

/** The subset that can be unread. Cancelled is excluded: you stopped it yourself. */
const UNREAD_ELIGIBLE: readonly RunStatus[] = ['done', 'failed']

export type ReadStateInput = {
  status: RunStatus
  finishedAt?: string
  seenAt?: string
  archived: boolean
  autoResumeAt?: string
}

/** A usage-limit failure with a resume booked — not a done item at all. */
function isScheduledResume(run: ReadStateInput): boolean {
  return run.status === 'failed' && run.autoResumeAt !== undefined
}

export function isDoneItem(status: RunStatus): boolean {
  return DONE_STATUSES.includes(status)
}

/** Whether a run could wear the unread marker at all — the receipt-independent half. */
export function canBeUnread(run: ReadStateInput): boolean {
  if (run.archived) return false
  if (isScheduledResume(run)) return false
  if (!UNREAD_ELIGIBLE.includes(run.status)) return false
  return run.finishedAt !== undefined
}

/**
 * A finished run not opened since it finished. `seenAt < finishedAt` rather than "has a
 * receipt", so a resumed-and-re-finished run goes unread again. ISO-8601 strings compare
 * lexicographically because Cezar writes every timestamp in UTC (`toISOString()`).
 */
export function isUnread(run: ReadStateInput): boolean {
  const finishedAt = run.finishedAt
  if (finishedAt === undefined) return false
  if (!canBeUnread(run)) return false
  return run.seenAt === undefined || run.seenAt < finishedAt
}

/** A finished row that is not unread — what the cockpit dims so unread rows stand out. */
export function isReadDoneItem(run: ReadStateInput): boolean {
  if (isScheduledResume(run)) return false
  return isDoneItem(run.status) && !isUnread(run)
}
