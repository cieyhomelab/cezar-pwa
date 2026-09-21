import type { RunIndexEntry } from '@cezar-pwa/cezar-contract/contract'
import { wantsAttention } from '@cezar-pwa/shared'

/**
 * How the task list is filtered, bucketed and ordered (FR-007, FR-008). Pure, so the part
 * worth testing is a table and the screen only paints.
 *
 * The SECTIONS are the PRD's — Needs attention / Running / Queued / Finished — not the
 * cockpit's sidebar buckets (Pinned / Needs you / Working / Recent), because the PRD makes the
 * top section the same answer as the notification and the badge. The ORDER inside a section is
 * the cockpit's (`packages/web/src/lib/task-groups.ts` → `sortRuns`, tag `v0.11.0`), so two
 * runs never swap places between the phone and the laptop.
 */

export type SectionKey = 'attention' | 'running' | 'queued' | 'finished'

/** Rendering order; also the exhaustive set. */
export const SECTION_ORDER: readonly SectionKey[] = ['attention', 'running', 'queued', 'finished']

export type ListRow = {
  run: RunIndexEntry
  /** 1-based place in the queue, `null` unless the run is queued. */
  queuePosition: number | null
}

export type ListSection = { key: SectionKey; rows: ListRow[] }

/** A `failed` run with a resume booked (provider usage limit) — work with an appointment. */
export function isScheduled(run: Pick<RunIndexEntry, 'status' | 'autoResumeAt'>): boolean {
  return run.status === 'failed' && run.autoResumeAt !== undefined
}

/**
 * The section a run sits under.
 *
 * Attention is decided by the shared rule and nothing else. A scheduled resume joins the
 * queue: it is waiting to start again, asks for nothing, and the cockpit ranks it just ahead
 * of queued work. A status this client has never heard of lands under Finished — visible,
 * never dropped (CLAUDE.md rule 5), which is also where the cockpit files it.
 */
export function sectionOf(run: RunIndexEntry): SectionKey {
  if (wantsAttention(run)) return 'attention'
  if (run.status === 'running') return 'running'
  if (run.status === 'queued' || isScheduled(run)) return 'queued'
  return 'finished'
}

/** Cockpit's `STATUS_ORDER`: needs-you first, then the pipeline in the order it will happen. */
const STATUS_ORDER: Partial<Record<string, number>> = {
  waiting: 0,
  review: 1,
  running: 2,
  queued: 4,
  done: 5,
  failed: 6,
  cancelled: 7,
}
const SCHEDULED_WEIGHT = 3

const statusWeight = (run: RunIndexEntry): number =>
  isScheduled(run) ? SCHEDULED_WEIGHT : (STATUS_ORDER[run.status] ?? 9)

/**
 * The cockpit's `sortRuns` without pins (the index row carries no `pinned`): status weight,
 * then soonest appointment for scheduled runs, FIFO for the queue, newest first otherwise.
 * ISO-8601 UTC strings compare lexicographically.
 */
export function compareRuns(a: RunIndexEntry, b: RunIndexEntry): number {
  const weight = statusWeight(a) - statusWeight(b)
  if (weight !== 0) return weight
  if (statusWeight(a) === SCHEDULED_WEIGHT && a.autoResumeAt && b.autoResumeAt) {
    const order = a.autoResumeAt.localeCompare(b.autoResumeAt)
    if (order !== 0) return order
  }
  if (a.status === 'queued' && b.status === 'queued') {
    return a.createdAt.localeCompare(b.createdAt)
  }
  return b.createdAt.localeCompare(a.createdAt)
}

/**
 * Queue positions over every active queued run, by creation order — the order the engine
 * starts them in. Computed BEFORE the project filter: the number is the run's real place in
 * Cezar's queue, which a filter on the phone does not change.
 *
 * Upstream's `queuePositions` numbers one project's list, because that cockpit view shows one
 * project. Here the list spans projects, and so does Cezar's queue: `maxParallel` is
 * workspace-wide and a freed slot goes to the workspace's longest-waiting run
 * (`packages/cezar/src/workspace/semaphore.ts`). A per-project concurrency override can let a
 * later run start first, so the number is the order of arrival, not a promise.
 */
export function queuePositions(runs: readonly RunIndexEntry[]): Map<string, number> {
  const queued = runs
    .filter((run) => !run.archived && run.status === 'queued')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return new Map(queued.map((run, index) => [`${run.projectId}/${run.id}`, index + 1]))
}

/**
 * The whole list, ready to paint: archived hidden (FR-008), narrowed to one project when a
 * filter is set (FR-013), bucketed and ordered. Empty sections are omitted; an empty result is
 * the screen's cue for its empty state.
 */
export function buildTaskList(
  runs: readonly RunIndexEntry[],
  projectId: string | null,
): ListSection[] {
  const positions = queuePositions(runs)
  const bySection = new Map<SectionKey, ListRow[]>()

  const visible = runs
    .filter((run) => !run.archived)
    .filter((run) => projectId === null || run.projectId === projectId)
    .sort(compareRuns)

  for (const run of visible) {
    const key = sectionOf(run)
    const row: ListRow = { run, queuePosition: positions.get(`${run.projectId}/${run.id}`) ?? null }
    const rows = bySection.get(key)
    if (rows) rows.push(row)
    else bySection.set(key, [row])
  }

  return SECTION_ORDER.filter((key) => bySection.has(key)).map((key) => ({
    key,
    rows: bySection.get(key) as ListRow[],
  }))
}

/** How many runs want the operator — the number US-02's "at a glance" answers with. */
export function attentionCount(sections: readonly ListSection[]): number {
  return sections.find((section) => section.key === 'attention')?.rows.length ?? 0
}
