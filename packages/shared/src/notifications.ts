import { deriveAttention, wantsAttention, type AttentionInput } from './attention.ts'
import type { RunStatus } from './types.ts'

/**
 * The notification rule (FR-038, FR-043), shared by the push sidecar that decides and the service
 * worker that displays.
 *
 * The decision is a port of `diffRunTransitions()` in Cezar's `packages/web/src/lib/notifications.ts`
 * @ `v0.11.0` — the cockpit's own browser notifications — so the phone rings for exactly what makes
 * the cockpit ring. Upstream diffs whole lists; the sidecar sees one run record per stream frame,
 * so the same clauses are spelled here per run. Runs are keyed by project too, because the
 * workspace stream carries every project and run ids are only unique within one.
 */

/** What the rule reads from a run: its identity and what `deriveAttention` reads. */
export type NotifiableRun = AttentionInput & {
  projectId: string
  id: string
  title: string
  titleSummary?: string
}

/** One entry per run, across projects. */
export function runKey(projectId: string, runId: string): string {
  return `${projectId}/${runId}`
}

/**
 * Whether this observation of a run is a run ENTERING a state that needs the operator.
 *
 * Upstream's two deliberate silences hold: a run seen for the first time never notifies (the
 * sidecar's start and every reconnect seed what is already there — a task that has been waiting
 * for an hour is the list's job, not a fresh ring), and an unchanged status never notifies (a
 * running task re-sends its record on every turn). A CHANGED status that still wants attention
 * does notify: `waiting` → `failed` is news.
 */
export function isEntering(before: RunStatus | undefined, run: AttentionInput): boolean {
  if (before === undefined || before === run.status) return false
  return wantsAttention(run)
}

/**
 * The wire format from the sidecar to the service worker. Structured rather than prose, so the
 * words stay in the PWA's `i18n/en.ts` and the sidecar never ships copy.
 *
 * Carries no code and no transcript content (FR-043): the task's display title, its project, and
 * the attention label — the reason, as the same key the list's status dot translates.
 */
export type PushPayload = {
  /** `attention` for a transition, `test` for the operator's own test (FR-045). */
  kind: 'attention' | 'test'
  projectId?: string
  projectName?: string
  runId?: string
  title?: string
  /** `deriveAttention().label`: `needs you`, `needs review`, `failed`, `needs permission`. */
  reason?: string
}

/**
 * A display title is a summary, but for a task that never got one it is the operator's own
 * prompt, which can be long and can hold anything they pasted. The notification carries its first
 * line, whitespace collapsed, cut to this length.
 */
export const MAX_TITLE_LENGTH = 100

export function notificationTitle(run: Pick<NotifiableRun, 'title' | 'titleSummary'>): string {
  const source = run.titleSummary?.trim() ? run.titleSummary : run.title
  const line = (source.split('\n').find((part) => part.trim() !== '') ?? '').replace(/\s+/g, ' ').trim()
  return line.length > MAX_TITLE_LENGTH ? `${line.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…` : line
}

export function attentionPayload(run: NotifiableRun, projectName?: string): PushPayload {
  return {
    kind: 'attention',
    projectId: run.projectId,
    projectName: projectName ?? run.projectId,
    runId: run.id,
    title: notificationTitle(run),
    reason: deriveAttention(run).label,
  }
}
