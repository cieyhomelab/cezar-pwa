import type { RunIndexEntry, RunRecord, RunsIndexResponse } from '@cezar-pwa/cezar-contract/contract'

/**
 * One frame of `GET /api/v1/workspace/events`: the SSE `event:` name and its parsed `data:`.
 * `data` is whatever the server sent — nothing here trusts its shape.
 */
export type WorkspaceFrame = { type: string; data: unknown }

type Record_ = { [key: string]: unknown }

const isObject = (value: unknown): value is Record_ =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The index row a run record projects to — a transcription of `runIndexEntry()` in Cezar's
 * `server/server.js` @ v0.11.0, the function that builds `runs-index` itself. A `run` frame
 * therefore becomes exactly the row a refetch would have served, and the list cannot tell a
 * live update from a fresh load.
 *
 * `usage` is not carried over from the record (it never has it — the sampler attaches it on the
 * way out); the caller keeps the previous row's sample instead.
 */
export function toIndexEntry(projectId: string, run: RunRecord): RunIndexEntry {
  const optional = <K extends keyof RunRecord>(key: K) =>
    run[key] !== undefined ? { [key]: run[key] } : {}
  return {
    projectId,
    id: run.id,
    title: run.title,
    ...optional('titleSummary'),
    ...optional('titleOrigin'),
    status: run.status,
    ...optional('activity'),
    createdAt: run.createdAt,
    ...optional('finishedAt'),
    ...optional('seenAt'),
    archived: run.archived,
    ...optional('autoResumeAt'),
    workflow: run.workflow,
    ...optional('branch'),
    ...(run.dispatch !== undefined
      ? {
          dispatch: {
            rootRunId: run.dispatch.rootRunId,
            ...(run.dispatch.parentRunId !== undefined ? { parentRunId: run.dispatch.parentRunId } : {}),
            ...(run.dispatch.kind !== undefined ? { kind: run.dispatch.kind } : {}),
          },
        }
      : {}),
    ...optional('startedAt'),
    ...optional('pullRequestUrl'),
    ...optional('referencedPullRequestUrl'),
    ...optional('prNumber'),
    ...optional('issueNumber'),
    ...optional('referencedIssueUrl'),
    ...optional('markerRefs'),
    ...optional('costUsd'),
    ...optional('peakRssBytes'),
    ...optional('peakProcCount'),
  } as RunIndexEntry
}

/**
 * The minimum a record needs before it may become a row: the join keys, and the fields the list
 * reads unconditionally. Anything else is optional on the row too. A frame failing this is
 * skipped rather than half-applied — the next refetch still carries the truth.
 */
function readableRecord(data: Record_): data is Record_ & RunRecord & { project: string } {
  return (
    typeof data.project === 'string' &&
    typeof data.id === 'string' &&
    typeof data.status === 'string' &&
    typeof data.title === 'string' &&
    typeof data.createdAt === 'string'
  )
}

const sameRow = (a: RunIndexEntry, projectId: string, id: string) =>
  a.projectId === projectId && a.id === id

/** Key-by-key, so a row fetched with its keys in another order still compares equal. */
function sameFields(a: RunIndexEntry, b: RunIndexEntry): boolean {
  const left = a as Record_
  const right = b as Record_
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return false
  }
  return true
}

/**
 * Fold one workspace frame into the cached index.
 *
 * Returns the SAME object when the frame changes nothing, so the caller can skip a cache write
 * and the screen a render. Unknown frame types and payloads it cannot read are ignored, never
 * thrown on (CLAUDE.md rule 5: the vocabulary only grows).
 *
 * - `run` — upsert. A run the index has never seen is a new task and is added; the list's own
 *   ordering places it, so position here does not matter.
 * - `run-deleted` — remove.
 */
export function applyWorkspaceFrame(
  index: RunsIndexResponse,
  frame: WorkspaceFrame,
): RunsIndexResponse {
  const { data } = frame
  switch (frame.type) {
    case 'run': {
      if (!isObject(data) || !readableRecord(data)) return index
      const { project, ...record } = data
      const at = index.runs.findIndex((row) => sameRow(row, project, record.id))
      const previous = at === -1 ? undefined : index.runs[at]
      const next: RunIndexEntry = {
        ...toIndexEntry(project, record as RunRecord),
        // The live sample rides on the index answer, never on the record; keep the last one.
        ...(previous?.usage !== undefined ? { usage: previous.usage } : {}),
      }
      // A running task sends a record on every turn; most change nothing the row shows.
      if (previous !== undefined && sameFields(previous, next)) return index
      const runs = [...index.runs]
      if (at === -1) runs.unshift(next)
      else runs[at] = next
      return { ...index, runs }
    }
    case 'run-deleted': {
      if (!isObject(data) || typeof data.project !== 'string' || typeof data.id !== 'string') {
        return index
      }
      const { project, id } = data
      if (!index.runs.some((row) => sameRow(row, project, id))) return index
      return { ...index, runs: index.runs.filter((row) => !sameRow(row, project, id)) }
    }
    default:
      return index
  }
}
