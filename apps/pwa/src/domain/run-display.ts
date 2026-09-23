import type { RunIndexEntry } from '@cezar-pwa/cezar-contract/contract'
import { pl } from '../i18n/pl.ts'

/**
 * What a list row says about a run (FR-009): its title, its PR/issue number, its cost and its
 * timing. The first three are copies of the cockpit's rules (`packages/web/src/lib/
 * task-groups.ts` → `runTitle`, `tasks-table.ts` → `taskReference`, `formatCost`, tag
 * `v0.11.0`), so a task is named and numbered the same on the phone as on the laptop. Diff
 * them against upstream when the contract is re-synced.
 */

// ---- title (copy of `runTitle`, `splitRefPrefix`, `refPrefixMatches`) -------------------

export type RunTitleInput = Pick<RunIndexEntry, 'title' | 'titleSummary' | 'titleOrigin'>

/**
 * `titleSummary ?? title`, except for an auto summary whose sentence punctuation was persisted
 * without following whitespace — those fall back to the raw title. User and marker titles are
 * authoritative byte for byte.
 */
export function runTitle(run: RunTitleInput): string {
  const summary = run.titleSummary
  if (summary === undefined) return run.title
  const protectedTitle = run.titleOrigin === 'user' || run.titleOrigin === 'marker'
  return !protectedTitle && /[.!?][A-Z]/.test(summary) ? run.title : summary
}

/** The `NNN: ` prefix auto-naming writes onto a title, split off. Render-only. */
export function splitRefPrefix(title: string): { ref: number | null; rest: string } {
  const match = /^(\d{1,9}): (.+)$/.exec(title)
  const digits = match?.[1]
  const rest = match?.[2]
  if (digits === undefined || rest === undefined) return { ref: null, rest: title }
  return { ref: Number(digits), rest }
}

/** The row may drop the `NNN: ` prefix only when its chip already shows that same number. */
export function refPrefixMatches(title: string, reference: number | undefined): boolean {
  return reference !== undefined && splitRefPrefix(title).ref === reference
}

// ---- PR / issue reference (copy of `taskReference` without `repoBase`) ------------------

export type TaskReferenceInput = Pick<
  RunIndexEntry,
  | 'pullRequestUrl'
  | 'referencedPullRequestUrl'
  | 'prNumber'
  | 'issueNumber'
  | 'referencedIssueUrl'
  | 'markerRefs'
>

export type TaskReference = { kind: 'PR' | 'Issue'; number: number }

/** The number at the end of a PR URL, or null on a forge whose URLs do not end in one. */
export function prNumber(url: string): string | null {
  const last = url.split('/').pop() ?? ''
  return /^\d+$/.test(last) ? last : null
}

/** PR URLs strongest first; an issue-subject run with no declared PR adopts no stray PR (#526). */
function prUrls(run: TaskReferenceInput): string[] {
  const urls: string[] = []
  if (run.pullRequestUrl) urls.push(run.pullRequestUrl)
  const suppressAboutPr = run.markerRefs?.issue !== undefined && run.markerRefs?.pr === undefined
  if (!suppressAboutPr && run.referencedPullRequestUrl) urls.push(run.referencedPullRequestUrl)
  return urls
}

/** Upstream's issue accessor, minus the link synthesis that needs the project's repo URL. */
function taskIssueUrl(run: TaskReferenceInput): string | undefined {
  return run.referencedIssueUrl
}

/**
 * The strongest tracker reference a run knows about — what a row with room for one shows.
 * An undeclared-but-uncorroborated `CEZ:PR` marker leads, then the PR it created, the PR it is
 * about, then the issue. Only the number is kept: the row is not a link (see `RunRow`).
 */
export function taskReference(run: TaskReferenceInput): TaskReference | undefined {
  const prs = prUrls(run)
  const declared = run.markerRefs?.pr
  const sources: { kind: TaskReference['kind']; url?: string; number?: number }[] = [
    ...(declared === undefined || prs.some((url) => prNumber(url) === String(declared))
      ? []
      : [{ kind: 'PR' as const, number: declared }]),
    ...prs.map((url) => ({ kind: 'PR' as const, url })),
    { kind: 'PR', number: run.prNumber },
    { kind: 'Issue', url: taskIssueUrl(run) },
    // Upstream reaches `markerRefs.issue` through a URL synthesized from the project's repo;
    // with only a number to show, reading it directly gives the same chip.
    { kind: 'Issue', number: run.markerRefs?.issue ?? run.issueNumber },
  ]
  for (const source of sources) {
    const number = source.url ? Number(prNumber(source.url)) : source.number
    if (!number || !Number.isInteger(number)) continue
    return { kind: source.kind, number }
  }
  return undefined
}

// ---- cost (copy of `formatCost`) --------------------------------------------------------

/**
 * `$0.42` / `$12`. Empty when nothing was recorded: absent is not `$0`, and the row leaves the
 * slot out rather than claim a measurement that never happened.
 */
export function formatCost(usd: number | undefined): string {
  if (!usd) return ''
  return `$${usd >= 10 ? usd.toFixed(0) : usd.toFixed(2)}`
}

// ---- timing -----------------------------------------------------------------------------

/**
 * Compact age — `4 s` / `26 min` / `2 godz.` / `3 dni`, worded by `pl.age`. One unit, never
 * rounded up, like the cockpit's `shortAge`. Empty for a missing or unparseable stamp: an empty
 * slot is honest, `NaN min` is not. Clamped at zero against clock skew.
 */
export function shortAge(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, (now - then) / 1000)
  if (seconds < 60) return pl.age.seconds(Math.floor(seconds))
  if (seconds < 3600) return pl.age.minutes(Math.floor(seconds / 60))
  if (seconds < 86_400) return pl.age.hours(Math.floor(seconds / 3600))
  return pl.age.days(Math.floor(seconds / 86_400))
}

/**
 * Wall-clock time of an instant — `11:40` today, `22.09 11:40` otherwise. Empty when the stamp
 * is unparseable, so a row never prints `Invalid Date`.
 */
export function clockTime(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const time = at.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
  if (at.toDateString() === new Date(now).toDateString()) return time
  const date = at.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })
  return `${date} ${time}`
}

export type RunTiming =
  | { kind: 'queued'; position: number }
  | { kind: 'scheduled'; at: string }
  | { kind: 'since'; age: string }
  | { kind: 'ago'; age: string }
  | { kind: 'none' }

/**
 * Which moment a row should talk about. A queued run shows its place in line; a scheduled
 * resume shows when it resumes; live work shows how long it has been going; finished work shows
 * how long ago it finished.
 */
export function runTiming(
  run: Pick<RunIndexEntry, 'status' | 'autoResumeAt' | 'createdAt' | 'startedAt' | 'finishedAt'>,
  queuePosition: number | null,
  now: number,
): RunTiming {
  if (queuePosition !== null) return { kind: 'queued', position: queuePosition }
  if (run.status === 'failed' && run.autoResumeAt !== undefined) {
    const at = clockTime(run.autoResumeAt, now)
    if (at) return { kind: 'scheduled', at }
  }
  if (run.finishedAt !== undefined && run.status !== 'running' && run.status !== 'waiting') {
    const age = shortAge(run.finishedAt, now)
    if (age) return { kind: 'ago', age }
  }
  const age = shortAge(run.startedAt ?? run.createdAt, now)
  return age ? { kind: 'since', age } : { kind: 'none' }
}
