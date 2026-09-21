/**
 * A server-sent event stream the app keeps open while a screen is on (S-04's list, S-06's task):
 * its own backoff, a watchdog, and a connection state the screen can say out loud (FR-012).
 *
 * The service worker never sees these connections (rule 4): it only routes navigations and
 * precached shell files.
 */

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

/** One named SSE event, its `data` parsed: `null` when empty, `undefined` when unreadable. */
export type StreamFrame = { type: string; data: unknown }

export type LiveStreamOptions = {
  /** Asked on every connect, so a resume point can move between attempts. */
  url: () => string
  /** The named events to listen for; anything else never arrives (rule 5). */
  frameTypes: readonly string[]
  onFrame: (frame: StreamFrame) => void
  /** Every (re)open. */
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

export class LiveStream {
  private readonly options: LiveStreamOptions
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

  constructor(options: LiveStreamOptions) {
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
    const source = this.createSource!(this.options.url())
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
    for (const type of this.options.frameTypes) {
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
 * Tie a stream to the page's lifecycle and the browser's network signal. Closed while the page
 * is hidden and reopened when it is shown: iOS freezes a backgrounded app, and a connection it
 * froze is not one to trust on waking. Returns the teardown.
 */
export function bindLifecycle(stream: LiveStream): () => void {
  const onVisibility = () => {
    stream.stop()
    if (document.visibilityState === 'visible') stream.start()
  }
  const onOnline = () => stream.setOnline(true)
  const onOffline = () => stream.setOnline(false)

  stream.setOnline(navigator.onLine)
  if (document.visibilityState !== 'hidden') stream.start()
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  return () => {
    stream.stop()
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  }
}
