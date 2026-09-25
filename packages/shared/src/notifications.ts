import { deriveAttention, wantsAttention, type AttentionInput } from './attention.ts'
import type { LimitsProvider, LimitWindow, LimitWindowKind, ProviderLimits } from './limits.ts'
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
  /**
   * `attention` for a transition, `test` for the operator's own test (FR-045), `limit` for a
   * usage-limit window crossing while tasks are queued (#94).
   */
  kind: 'attention' | 'test' | 'limit'
  projectId?: string
  projectName?: string
  runId?: string
  title?: string
  /** `deriveAttention().label`: `needs you`, `needs review`, `failed`, `needs permission`. */
  reason?: string
  /** `limit` only (#94): which window of which account, how full, and when it resets. */
  provider?: LimitsProvider
  account?: string
  window?: LimitWindowKind
  model?: string
  level?: LimitLevel
  usedPercent?: number
  resetsAt?: string
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

/**
 * #94: a usage-limit window nearing exhaustion while tasks are queued. The PRD's Non-Goals were
 * narrowed by the operator (2026-09-25) to allow exactly this one non-task notification: work is
 * waiting to run, and it is about to park until the window resets.
 *
 * `near` is at or past the threshold, `exhausted` is at 100%. A window notifies when it ENTERS a
 * level it has not been announced at since its last reset — never on every poll.
 */
export type LimitLevel = 'near' | 'exhausted'

const LEVEL_RANK: Record<LimitLevel, number> = { near: 1, exhausted: 2 }

/** The sidecar's default threshold, in percent (`LIMITS_NOTIFY_PERCENT`). */
export const DEFAULT_LIMIT_THRESHOLD = 90

export function limitLevel(usedPercent: number, threshold: number): LimitLevel | undefined {
  if (!Number.isFinite(usedPercent)) return undefined
  if (usedPercent >= 100) return 'exhausted'
  if (usedPercent >= threshold) return 'near'
  return undefined
}

/** One entry per window of one account: `claude/default/weekly_model:opus`. */
export function limitWindowKey(
  provider: string,
  account: string,
  window: Pick<LimitWindow, 'kind' | 'model'>,
): string {
  return `${provider}/${account}/${window.kind}${window.model ? `:${window.model}` : ''}`
}

/** What has been announced for a window since its last reset. Persisted by the sidecar. */
export type LimitMemory = { level: LimitLevel; resetsAt?: string }

export type LimitCrossingInput = {
  providers: readonly ProviderLimits[]
  memory: Readonly<Record<string, LimitMemory>>
  threshold: number
  /** Whether any task is queued or running. Nothing waiting to run → nothing to warn about. */
  busy: boolean
  now: Date
}

/**
 * The limit rule (#94). Returns the payloads to send and the memory to keep.
 *
 * - A window notifies when its level is above the one remembered for it — so at most once per
 *   level between two resets, and `near` → `exhausted` is news.
 * - A window's memory is forgotten when its recorded reset time has passed, or when a reading
 *   shows it back under the threshold — both mean the window reset.
 * - Nothing notifies, and nothing is remembered, while no task is queued or running: a window
 *   that is still full when work is queued later is announced then.
 * - An unavailable row or an absent window changes nothing: a failed read is not a reset, and
 *   must not lead to a second ring once the read works again.
 */
export function limitCrossings(input: LimitCrossingInput): {
  notify: PushPayload[]
  memory: Record<string, LimitMemory>
} {
  const now = input.now.getTime()
  const memory: Record<string, LimitMemory> = {}
  for (const [key, entry] of Object.entries(input.memory)) {
    const resetAt = entry.resetsAt === undefined ? Number.NaN : Date.parse(entry.resetsAt)
    if (!(resetAt <= now)) memory[key] = entry
  }
  const notify: PushPayload[] = []
  for (const row of input.providers) {
    if (row.status !== 'ok') continue
    for (const window of row.windows) {
      const key = limitWindowKey(row.provider, row.account, window)
      const level = limitLevel(window.usedPercent, input.threshold)
      if (level === undefined) {
        delete memory[key]
        continue
      }
      const before = memory[key]
      if (before && LEVEL_RANK[before.level] >= LEVEL_RANK[level]) continue
      if (!input.busy) continue
      memory[key] = { level, ...(window.resetsAt ? { resetsAt: window.resetsAt } : {}) }
      notify.push(limitPayload(row, window, level))
    }
  }
  return { notify, memory }
}

/** Names the account and the window, and when it resets — no token, no path, no credential. */
export function limitPayload(
  row: Pick<ProviderLimits, 'provider' | 'account'>,
  window: LimitWindow,
  level: LimitLevel,
): PushPayload {
  return {
    kind: 'limit',
    provider: row.provider,
    account: row.account,
    window: window.kind,
    ...(window.model ? { model: window.model } : {}),
    level,
    usedPercent: Math.min(100, Math.max(0, Math.round(window.usedPercent))),
    ...(window.resetsAt ? { resetsAt: window.resetsAt } : {}),
  }
}
