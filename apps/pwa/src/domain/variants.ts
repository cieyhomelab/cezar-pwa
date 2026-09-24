import type { GroupResponse } from '@cezar-pwa/cezar-contract/contract'
import { isRunActive } from './answer.ts'

/**
 * S-21: the variants of a task started ×2 or ×3, and keeping one of them (#71). Cezar groups the
 * runs itself: every run sharing a `groupId` is one group, answered side by side by
 * `GET /groups/:groupId`. The runs index carries no `groupId`, so the task screen starts from its
 * own record and asks for the group.
 *
 * Choosing between the variants by reading their diffs next to each other stays in the cockpit
 * (PRD Non-Goals, N07). The phone only lists them and keeps the one the operator is looking at.
 */

export interface VariantRow {
  id: string
  /** 'A' | 'B' | 'C' in practice; `'?'` for a record that lost its letter. */
  variant: string
  title: string
  status: string
  archived: boolean
  costUsd?: number
  /** Files changed in the variant's worktree. Absent when the worktree is gone or unreadable. */
  changedFiles?: number
  /** The task on screen. */
  current: boolean
}

/**
 * The file count out of the group's `diffStat`, which is the raw `git diff --stat` TEXT rather
 * than the record's numbers: its last line reads ` 3 files changed, 10 insertions(+)`. `0` for an
 * empty diff of a worktree that exists is not knowable from `''`, which the server also sends for
 * a removed worktree, so both are absent.
 */
export function changedFileCount(diffStat: string): number | undefined {
  const match = /(\d+) files? changed/.exec(diffStat)
  return match ? Number(match[1]) : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The group's runs as rows, in variant order. An entry without an id or a status costs itself,
 * not the list; unknown fields are ignored (rule 5).
 */
export function variantRows(group: Pick<GroupResponse, 'runs'>, currentRunId: string): VariantRow[] {
  const runs: unknown[] = Array.isArray(group.runs) ? group.runs : []
  return runs
    .filter(isRecord)
    .filter((run) => typeof run.id === 'string' && typeof run.status === 'string')
    .map((run) => {
      const changedFiles = typeof run.diffStat === 'string' ? changedFileCount(run.diffStat) : undefined
      const cost = run.costUsd
      return {
        id: run.id as string,
        variant: typeof run.variant === 'string' && run.variant !== '' ? run.variant : '?',
        title: typeof run.title === 'string' ? run.title : '',
        status: run.status as string,
        archived: run.archived === true,
        ...(typeof cost === 'number' && Number.isFinite(cost) ? { costUsd: cost } : {}),
        ...(changedFiles !== undefined ? { changedFiles } : {}),
        current: run.id === currentRunId,
      }
    })
    .sort((a, b) => a.variant.localeCompare(b.variant))
}

export type PickOffer =
  /** Keeping this one is available. */
  | 'offer'
  /** The server refuses to pick a variant the engine still owns (`409`); say so up front. */
  | 'wait'
  /** Nothing to pick: a single run, this one already lost, or the group was already decided. */
  | 'none'

/**
 * Whether the task on screen can be kept. A pick archives every other variant, so a group whose
 * other variants are all archived has been decided already — offering it again would only redo
 * the archive. An archived current run is a variant that lost (or that the operator retired).
 */
export function pickOffer(rows: readonly VariantRow[]): PickOffer {
  const current = rows.find((row) => row.current)
  if (current === undefined || current.archived) return 'none'
  if (!rows.some((row) => !row.current && !row.archived)) return 'none'
  return isRunActive(current.status) ? 'wait' : 'offer'
}
