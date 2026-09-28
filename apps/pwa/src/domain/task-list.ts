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
  /**
   * #101: the dispatched subtasks folded under this row — direct children only, each carrying
   * its own. Absent on a row that dispatched nothing (or whose children sit elsewhere).
   */
  children?: ListRow[]
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

  return SECTION_ORDER.filter((key) => bySection.has(key)).map((key) => {
    const rows = bySection.get(key) as ListRow[]
    return { key, rows: key === 'attention' ? rows : foldSubtasks(rows) }
  })
}

const rowKey = (run: Pick<RunIndexEntry, 'projectId' | 'id'>) => `${run.projectId}/${run.id}`

/**
 * #101: fold dispatched subtasks under their parent row — the grouping of Cezar 0.12.0's
 * `buildTaskTree` (`packages/web/src/lib/task-tree.ts`, #1110), without its rendering.
 *
 * Takes one section's ALREADY-ORDERED rows and keeps that order: roots stay where the sort put
 * them, and a parent's children keep theirs beneath it. A row folds under its DIRECT parent
 * (`dispatch.parentRunId`), so a grandchild sits under its child, not the root — as upstream.
 *
 * A row whose parent is not among these rows stays top-level: the parent may be in another
 * section, archived, filtered out or beyond the index's limit, and hiding the child with an
 * absent parent would make it vanish with no way to say why. A run that is its own ancestor
 * roots too, so a store hand-edited into a cycle cannot hang the list.
 *
 * Never applied to the attention section: every run that wants the operator keeps its own row
 * there, because the badge and the pushes count it and the list must give the same answer.
 */
export function foldSubtasks(rows: readonly ListRow[]): ListRow[] {
  const byKey = new Map<string, ListRow>()
  for (const row of rows) {
    // First entry wins on a duplicate key, so a list that somehow carries one paints it once.
    if (!byKey.has(rowKey(row.run))) byKey.set(rowKey(row.run), row)
  }

  const parentKeyOf = (run: RunIndexEntry): string | undefined => {
    const parentId = run.dispatch?.parentRunId
    return parentId === undefined ? undefined : `${run.projectId}/${parentId}`
  }

  /** The key of the parent row present in this section, or null when the run is a root here. */
  const parentOf = (run: RunIndexEntry): string | null => {
    const key = parentKeyOf(run)
    if (key === undefined || !byKey.has(key)) return null
    // Walk up from the parent looking for this run: finding it means a cycle, so it roots.
    const seen = new Set<string>([rowKey(run)])
    for (let cursor: string | undefined = key; cursor !== undefined && byKey.has(cursor); ) {
      if (seen.has(cursor)) return null
      seen.add(cursor)
      cursor = parentKeyOf((byKey.get(cursor) as ListRow).run)
    }
    return key
  }

  const roots: ListRow[] = []
  const childrenOf = new Map<string, ListRow[]>()
  for (const row of rows) {
    // Only the entry this row's key kept — a duplicate has already been placed.
    if (byKey.get(rowKey(row.run)) !== row) continue
    const parent = parentOf(row.run)
    if (parent === null) roots.push(row)
    else childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), row])
  }

  const attach = (row: ListRow): ListRow => {
    const children = childrenOf.get(rowKey(row.run))
    return children ? { ...row, children: children.map(attach) } : row
  }
  return roots.map(attach)
}

/** A row and everything folded under it, top to bottom — every run the row stands for. */
export function flattenRows(rows: readonly ListRow[]): ListRow[] {
  return rows.flatMap((row) => [row, ...flattenRows(row.children ?? [])])
}

/**
 * How many runs want the operator — the number US-02's "at a glance" answers with. The attention
 * section is never folded (see `foldSubtasks`), so its rows are exactly those runs.
 */
export function attentionCount(sections: readonly ListSection[]): number {
  return sections.find((section) => section.key === 'attention')?.rows.length ?? 0
}
