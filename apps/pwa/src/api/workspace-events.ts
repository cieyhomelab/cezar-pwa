import type { RunsIndexResponse } from '@cezar-pwa/cezar-contract/contract'
import { applyWorkspaceFrame, type WorkspaceFrame } from '../domain/live-index.ts'

/**
 * The workspace event stream (`docs/CEZAR_API.md` § 3a): one SSE connection carrying every
 * project's run changes, which is what makes the list live (FR-010) — and the source of truth
 * for whether it is (FR-012).
 *
 * Workspace-level, like `runs-index`, so it has no `/p/:projectId/` variant. The service worker
 * never sees it (rule 4): the SW only routes navigations and precached shell files.
 */
export const WORKSPACE_EVENTS_PATH = '/api/v1/workspace/events'

/**
 * The frames this client listens for. EventSource only delivers a named event to a listener
 * registered under that name, so anything the server adds later simply never arrives — the
 * append-only vocabulary (rule 5) degrades to "not shown", never to a crash.
 */
export const FRAME_TYPES = ['run', 'run-deleted', 'project-added', 'project-removed', 'usage', 'ping'] as const

/**
 * - `connecting` — the first attempt of a session with the stream (start, or back from hidden)
 * - `live` — open, and a frame arrived within the watchdog window
 * - `reconnecting` — dropped, retrying, not yet long enough to call it lost
 * - `lost` — no connection for `LOST_AFTER_MS`, or the browser says it is offline; still retrying
 */
export type LiveState = 'connecting' | 'live' | 'reconnecting' | 'lost'

/** Our own backoff rather than the browser's fixed ~3 s: a phone on a bad network should not
 *  hammer, and a server restart should be caught within a second. The last step repeats. */
export const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const

/** The server pings every 15 s. Three missed pings — or a connect that never opens, which a
 *  proxy holding the request would produce — means the stream is dead even if no error fired. */
export const WATCHDOG_MS = 45_000

/** A blip (server restart, a tunnel under the tram) reads as "reconnecting"; past this it is lost. */
export const LOST_AFTER_MS = 20_000

type SourceFactory = (url: string) => EventSource

export type WorkspaceStreamOptions = {
  onFrame: (frame: WorkspaceFrame) => void
  /** Every (re)open. There is no replay (no `id:` lines), so the caller must refetch. */
  onOpen: () => void
  /** Once per disconnection. EventSource hides the HTTP status, so a lapsed session looks like
   *  any other drop — the caller re-asks the session probe. */
  onDrop: () => void
  onState: (state: LiveState) => void
  createSource?: SourceFactory
}

/** Read at construction, not import, so a test can stub the global before the screen mounts. */
const defaultFactory = (): SourceFactory | undefined =>
  typeof EventSource === 'undefined' ? undefined : (url) => new EventSource(url)

function parse(data: unknown): unknown {
  if (typeof data !== 'string' || data === '') return null
  try {
    return JSON.parse(data)
  } catch {
    // A frame we cannot read still proves the connection is alive; its content is skipped.
    return undefined
  }
}

export class WorkspaceStream {
  private readonly options: WorkspaceStreamOptions
  private readonly createSource: SourceFactory | undefined
  private source: EventSource | null = null
  private running = false
  private offline = false
  private attempt = 0
  private disconnected = false
  private watchdog: ReturnType<typeof setTimeout> | undefined
  private retry: ReturnType<typeof setTimeout> | undefined
  private lostTimer: ReturnType<typeof setTimeout> | undefined
  state: LiveState = 'connecting'

  constructor(options: WorkspaceStreamOptions) {
    this.options = options
    this.createSource = 'createSource' in options ? options.createSource : defaultFactory()
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.attempt = 0
    this.disconnected = false
    if (this.createSource === undefined) {
      // No EventSource at all (not a browser this product supports): never claim to be live.
      this.setState('lost')
      return
    }
    this.setState(this.offline ? 'lost' : 'connecting')
    if (!this.offline) this.connect()
  }

  /** Close everything. `start()` begins afresh — used when the page is hidden. */
  stop(): void {
    this.running = false
    this.closeSource()
    clearTimeout(this.retry)
    clearTimeout(this.lostTimer)
  }

  /** The browser's own network signal. Offline is trustworthy; online only means "try now". */
  setOnline(online: boolean): void {
    this.offline = !online
    if (!this.running || this.createSource === undefined) return
    if (!online) {
      this.closeSource()
      clearTimeout(this.retry)
      this.markDisconnected()
      this.setState('lost')
    } else if (this.source === null) {
      // Only when nothing is already trying — an attempt in flight is left to finish.
      clearTimeout(this.retry)
      this.attempt = 0
      this.connect()
    }
  }

  private connect(): void {
    this.closeSource()
    const source = this.createSource!(WORKSPACE_EVENTS_PATH)
    this.source = source
    source.onopen = () => {
      if (this.source !== source) return
      this.attempt = 0
      this.disconnected = false
      clearTimeout(this.lostTimer)
      this.armWatchdog()
      this.setState('live')
      this.options.onOpen()
    }
    source.onerror = () => {
      if (this.source === source) this.drop()
    }
    for (const type of FRAME_TYPES) {
      source.addEventListener(type, (event) => {
        if (this.source !== source) return
        this.armWatchdog()
        this.options.onFrame({ type, data: parse((event as MessageEvent).data) })
      })
    }
    this.armWatchdog()
  }

  /** Take over from the browser: close, and retry on our own schedule. */
  private drop(): void {
    this.closeSource()
    if (!this.running) return
    this.markDisconnected()
    if (this.state !== 'lost') this.setState('reconnecting')
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]
    this.attempt += 1
    clearTimeout(this.retry)
    this.retry = setTimeout(() => {
      if (this.running && !this.offline) this.connect()
    }, delay)
  }

  private markDisconnected(): void {
    if (this.disconnected) return
    this.disconnected = true
    clearTimeout(this.lostTimer)
    this.lostTimer = setTimeout(() => {
      if (this.running && this.state !== 'live') this.setState('lost')
    }, LOST_AFTER_MS)
    this.options.onDrop()
  }

  private armWatchdog(): void {
    clearTimeout(this.watchdog)
    this.watchdog = setTimeout(() => this.drop(), WATCHDOG_MS)
  }

  private closeSource(): void {
    clearTimeout(this.watchdog)
    if (this.source) {
      this.source.onopen = null
      this.source.onerror = null
      this.source.close()
      this.source = null
    }
  }

  private setState(state: LiveState): void {
    if (this.state === state) return
    this.state = state
    this.options.onState(state)
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
  private readonly marks = new Set<number>()
  private frames: { at: number; frame: WorkspaceFrame }[] = []

  record(frame: WorkspaceFrame): void {
    this.sequence += 1
    if (this.marks.size > 0) this.frames.push({ at: this.sequence, frame })
  }

  /** Call before the request; pass the returned mark to `settle` or `discard`. */
  begin(): number {
    this.marks.add(this.sequence)
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
    this.marks.delete(mark)
    const oldest = Math.min(...this.marks)
    this.frames = this.marks.size === 0 ? [] : this.frames.filter((entry) => entry.at > oldest)
  }
}

/** One per page: the stream records into it, the runs-index query function reads from it. */
export const workspaceJournal = new FrameJournal()
