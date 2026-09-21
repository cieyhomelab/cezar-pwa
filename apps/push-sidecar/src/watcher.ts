import {
  attentionPayload,
  isEntering,
  runKey,
  type NotifiableRun,
  type PushPayload,
  type RunStatus,
} from '@cezar-pwa/shared'
import { readStream, type SseFrame } from './sse.ts'

/** Cezar's workspace stream and the two reads that seed it (`docs/CEZAR_API.md` § 2, § 3a). */
export const WORKSPACE_EVENTS_PATH = '/api/v1/workspace/events'
export const RUNS_INDEX_PATH = '/api/v1/workspace/runs-index'
export const HEALTH_PATH = '/api/v1/health'

/** The PWA's live-stream backoff (`apps/pwa/src/api/live-stream.ts`); the last step repeats. */
export const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const

/** The server pings every 15 s; three missed pings means the connection is dead. */
export const WATCHDOG_MS = 45_000

export type WatcherState = 'connecting' | 'live' | 'reconnecting' | 'stopped'

export type WatcherOptions = {
  /** Cezar on loopback, e.g. `http://127.0.0.1:4322` — past the gate, no cookie needed. */
  cezarUrl: string
  notify: (payload: PushPayload) => Promise<unknown> | void
  fetch?: typeof fetch
  log?: (message: string) => void
  backoffMs?: readonly number[]
  watchdogMs?: number
}

type Record_ = { [key: string]: unknown }

const isObject = (value: unknown): value is Record_ =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    return undefined
  }
}

/** A `run` frame's record, read defensively: the stream's vocabulary only grows (rule 5). */
function readRun(data: unknown): NotifiableRun | undefined {
  if (!isObject(data)) return undefined
  const { project, id, status, title } = data
  if (typeof project !== 'string' || typeof id !== 'string') return undefined
  if (typeof status !== 'string' || typeof title !== 'string') return undefined
  return {
    projectId: project,
    id,
    status: status as RunStatus,
    title,
    ...(typeof data.titleSummary === 'string' ? { titleSummary: data.titleSummary } : {}),
    ...(typeof data.activity === 'string' ? { activity: data.activity } : {}),
    ...(typeof data.autoResumeAt === 'string' ? { autoResumeAt: data.autoResumeAt } : {}),
  }
}

/**
 * Follows Cezar's workspace stream and turns a run ENTERING a state that needs the operator into a
 * push (FR-038). REQUIREMENTS § 6: loopback, reconnect with backoff, and after every (re)connect
 * the runs index is read and the statuses it holds are taken as the baseline — never announced.
 * A task that was already waiting when the connection came back is the list's job, not a ring.
 *
 * Holds statuses only, in memory: no titles are kept and nothing about a task is logged.
 */
export class Watcher {
  readonly statuses = new Map<string, RunStatus>()
  state: WatcherState = 'connecting'
  /** When the last baseline landed — for `/health`. */
  seededAt: string | undefined
  private readonly options: WatcherOptions
  private readonly doFetch: typeof fetch
  private readonly projectNames = new Map<string, string>()
  private controller: AbortController | undefined
  private stopped = false
  private wake: (() => void) | undefined

  constructor(options: WatcherOptions) {
    this.options = options
    this.doFetch = options.fetch ?? fetch
  }

  /** Runs until `stop()`. */
  async run(): Promise<void> {
    const backoff = this.options.backoffMs ?? BACKOFF_MS
    let attempt = 0
    while (!this.stopped) {
      this.state = attempt === 0 ? 'connecting' : 'reconnecting'
      const opened = await this.connectOnce()
      if (this.stopped) break
      attempt = opened ? 0 : attempt + 1
      await this.sleep(backoff[Math.min(attempt, backoff.length - 1)] ?? 1_000)
    }
    this.state = 'stopped'
  }

  stop(): void {
    this.stopped = true
    this.controller?.abort()
    this.wake?.()
  }

  /**
   * One connection's lifetime. Frames that arrive before the baseline lands are applied to it
   * silently: whether they are older or newer than the index answer cannot be told, and a missed
   * ring is the lesser failure next to a false one.
   *
   * @returns whether the stream opened and its baseline landed, which resets the backoff.
   */
  async connectOnce(): Promise<boolean> {
    const controller = new AbortController()
    this.controller = controller
    const watchdogMs = this.options.watchdogMs ?? WATCHDOG_MS
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const kick = () => {
      clearTimeout(watchdog)
      watchdog = setTimeout(() => controller.abort(new Error('watchdog: no ping')), watchdogMs)
    }
    let opened = false
    let seeded = false
    const early: SseFrame[] = []
    const onOpen = () => {
      this.state = 'live'
      this.seed(controller.signal).then(
        () => {
          for (const frame of early.splice(0)) this.handleFrame(frame, { silent: true })
          seeded = true
          // Only a landed baseline resets the backoff: a stream that opens while the index read
          // keeps failing must not reconnect every second.
          opened = true
          this.options.log?.(`stream live, baseline of ${this.statuses.size} runs`)
        },
        (error: unknown) => {
          this.options.log?.(`baseline failed: ${describe(error)}`)
          controller.abort()
        },
      )
    }

    kick()
    try {
      const frames = readStream(new URL(WORKSPACE_EVENTS_PATH, this.options.cezarUrl).href, {
        signal: controller.signal,
        fetch: this.doFetch,
        onOpen,
        onBytes: kick,
      })
      for await (const frame of frames) {
        if (seeded) this.handleFrame(frame)
        else early.push(frame)
      }
      this.options.log?.('stream closed by the server')
    } catch (error) {
      if (!this.stopped) this.options.log?.(`stream dropped: ${describe(error)}`)
    } finally {
      clearTimeout(watchdog)
      controller.abort()
    }
    return opened
  }

  /** Replace the baseline with the runs index, and refresh the project names. */
  async seed(signal?: AbortSignal): Promise<void> {
    const [index, health] = await Promise.all([
      this.getJson(RUNS_INDEX_PATH, signal),
      this.getJson(HEALTH_PATH, signal).catch(() => undefined),
    ])
    const runs = isObject(index) && Array.isArray(index.runs) ? index.runs : undefined
    if (!runs) throw new Error('runs-index answered in an unknown shape')
    this.statuses.clear()
    for (const row of runs) {
      if (!isObject(row)) continue
      const { projectId, id, status } = row
      if (typeof projectId === 'string' && typeof id === 'string' && typeof status === 'string') {
        this.statuses.set(runKey(projectId, id), status as RunStatus)
      }
    }
    this.readProjectNames(health)
    this.seededAt = new Date().toISOString()
  }

  /** One frame. `silent` updates the baseline without ever notifying. */
  handleFrame(frame: SseFrame, { silent = false }: { silent?: boolean } = {}): void {
    switch (frame.type) {
      case 'run': {
        const run = readRun(parseJson(frame.data))
        if (!run) return
        const key = runKey(run.projectId, run.id)
        const before = this.statuses.get(key)
        this.statuses.set(key, run.status)
        if (silent || !isEntering(before, run)) return
        const payload = attentionPayload(run, this.projectNames.get(run.projectId))
        // The status is already recorded, so a failed push is never retried into a second ring.
        // A notifier that throws synchronously is a rejection too, never a dropped stream.
        new Promise((resolve) => resolve(this.options.notify(payload))).catch((error: unknown) => {
          this.options.log?.(`notify failed: ${describe(error)}`)
        })
        return
      }
      case 'run-deleted': {
        const data = parseJson(frame.data)
        if (isObject(data) && typeof data.project === 'string' && typeof data.id === 'string') {
          this.statuses.delete(runKey(data.project, data.id))
        }
        return
      }
      case 'project-added':
        // Only the name is missing; a lookup failure falls back to the project id.
        this.getJson(HEALTH_PATH).then(
          (health) => this.readProjectNames(health),
          () => {},
        )
        return
      default:
        // `ping`, `usage`, and whatever Cezar adds next (rule 5).
        return
    }
  }

  private readProjectNames(health: unknown): void {
    if (!isObject(health) || !Array.isArray(health.projects)) return
    for (const project of health.projects) {
      if (isObject(project) && typeof project.id === 'string' && typeof project.name === 'string') {
        this.projectNames.set(project.id, project.name)
      }
    }
  }

  private async getJson(path: string, signal?: AbortSignal): Promise<unknown> {
    const response = await this.doFetch(new URL(path, this.options.cezarUrl).href, {
      headers: { Accept: 'application/json' },
      // Bounded even under the connection's own signal: until the baseline lands, frames queue.
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`${path} answered ${response.status}`)
    return response.json()
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms)
      function done() {
        clearTimeout(timer)
        resolve()
      }
      this.wake = done
    })
  }
}

/** An error's message, never a response body. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
