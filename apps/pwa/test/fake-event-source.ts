/**
 * A stand-in for the browser's `EventSource`, driven by hand: jsdom has none, and a real one
 * would need a server. Every instance ever created is kept, so a test can reach the current
 * connection (`FakeEventSource.latest`) and count reconnects (`FakeEventSource.instances`).
 */
export class FakeEventSource {
  static instances: FakeEventSource[] = []

  static get latest(): FakeEventSource {
    const last = FakeEventSource.instances.at(-1)
    if (!last) throw new Error('no EventSource was created')
    return last
  }

  static reset(): void {
    FakeEventSource.instances = []
  }

  readonly url: string
  closed = false
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  private readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  close(): void {
    this.closed = true
  }

  open(): void {
    this.onopen?.(new Event('open'))
  }

  fail(): void {
    this.onerror?.(new Event('error'))
  }

  /** Deliver one named frame, `data` serialised the way the server does. */
  emit(type: string, data: unknown = ''): void {
    const payload = typeof data === 'string' ? data : JSON.stringify(data)
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data: payload }))
    }
  }
}

export const fakeSourceFactory = (url: string) => new FakeEventSource(url) as unknown as EventSource
