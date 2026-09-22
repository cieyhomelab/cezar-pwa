import type { RunsIndexResponse } from '@cezar-pwa/cezar-contract/contract'
import { applyWorkspaceFrame, type WorkspaceFrame } from '../domain/live-index.ts'
import { LiveStream, type LiveStreamOptions } from './live-stream.ts'

export { BACKOFF_MS, LOST_AFTER_MS, type LiveState, WATCHDOG_MS } from './live-stream.ts'

/**
 * The workspace event stream (`docs/CEZAR_API.md` § 3a): one SSE connection carrying every
 * project's run changes, which is what makes the list live (FR-010) — and the source of truth
 * for whether it is (FR-012).
 *
 * Workspace-level, like `runs-index`, so it has no `/p/:projectId/` variant.
 */
export const WORKSPACE_EVENTS_PATH = '/api/v1/workspace/events'

/**
 * The frames this client listens for. EventSource only delivers a named event to a listener
 * registered under that name, so anything the server adds later simply never arrives — the
 * append-only vocabulary (rule 5) degrades to "not shown", never to a crash.
 */
export const FRAME_TYPES = ['run', 'run-deleted', 'project-added', 'project-removed', 'usage', 'ping'] as const

export type WorkspaceStreamOptions = Omit<LiveStreamOptions, 'url' | 'frameTypes' | 'onFrame'> & {
  onFrame: (frame: WorkspaceFrame) => void
}

/** The workspace stream has no `id:` lines, so no replay: every (re)open means refetch. */
export class WorkspaceStream extends LiveStream {
  constructor(options: WorkspaceStreamOptions) {
    super({ ...options, url: () => WORKSPACE_EVENTS_PATH, frameTypes: FRAME_TYPES })
  }
}

/**
 * Frames that arrive while a `runs-index` request is travelling.
 *
 * The response is computed on the server before those frames were sent, so landing it as-is
 * would silently undo them — a status shown as current that no longer is, the guardrail this
 * slice exists for. The query function marks the start of its request and, once the answer is
 * in, replays every frame recorded since onto it. Replaying a frame the answer already reflects
 * is harmless: a `run` frame is the whole record, and order is kept.
 */
export class FrameJournal {
  private sequence = 0
  /**
   * Open marks, counted: two requests begun with no frame in between share a mark (a focus
   * refetch cancelled by the stream-open invalidation), and ending one must not end the other.
   */
  private readonly marks = new Map<number, number>()
  private frames: { at: number; frame: WorkspaceFrame }[] = []

  record(frame: WorkspaceFrame): void {
    this.sequence += 1
    if (this.marks.size > 0) this.frames.push({ at: this.sequence, frame })
  }

  /** Call before the request; pass the returned mark to `settle` or `discard`. */
  begin(): number {
    this.marks.set(this.sequence, (this.marks.get(this.sequence) ?? 0) + 1)
    return this.sequence
  }

  settle(mark: number, index: RunsIndexResponse): RunsIndexResponse {
    const result = this.frames
      .filter((entry) => entry.at > mark)
      .reduce((acc, entry) => applyWorkspaceFrame(acc, entry.frame), index)
    this.discard(mark)
    return result
  }

  discard(mark: number): void {
    const open = this.marks.get(mark) ?? 0
    if (open > 1) this.marks.set(mark, open - 1)
    else this.marks.delete(mark)
    const oldest = Math.min(...this.marks.keys())
    this.frames = this.marks.size === 0 ? [] : this.frames.filter((entry) => entry.at > oldest)
  }
}

/** One per page: the stream records into it, the runs-index query function reads from it. */
export const workspaceJournal = new FrameJournal()
