/**
 * A server-sent event stream read over `fetch` — Node 20 has no `EventSource`.
 *
 * Only what Cezar's workspace stream uses: `event:` and `data:` lines, blank-line dispatch,
 * comments. It sends no `id:` lines (`docs/CEZAR_API.md` § 3a), so there is no resume point and
 * every reconnect is a fresh start — the watcher re-seeds for exactly that reason.
 */

/** One dispatched event: its name (`message` when unnamed) and its raw `data`. */
export type SseFrame = { type: string; data: string }

export class SseParser {
  private buffer = ''
  private type = ''
  private data: string[] = []

  /** Feed a decoded chunk; get back every event it completed. */
  push(chunk: string): SseFrame[] {
    this.buffer += chunk
    const frames: SseFrame[] = []
    let newline: number
    while ((newline = this.buffer.search(/\r\n|\r|\n/)) !== -1) {
      const line = this.buffer.slice(0, newline)
      const width = this.buffer.startsWith('\r\n', newline) ? 2 : 1
      // A lone `\r` at the very end may be the first half of `\r\n` still in flight.
      if (width === 1 && this.buffer[newline] === '\r' && newline === this.buffer.length - 1) break
      this.buffer = this.buffer.slice(newline + width)
      const frame = this.line(line)
      if (frame) frames.push(frame)
    }
    return frames
  }

  private line(line: string): SseFrame | undefined {
    if (line === '') {
      const frame = this.data.length > 0 || this.type !== '' ? { type: this.type || 'message', data: this.data.join('\n') } : undefined
      this.type = ''
      this.data = []
      return frame
    }
    if (line.startsWith(':')) return undefined
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') this.type = value
    else if (field === 'data') this.data.push(value)
    // `id`, `retry` and anything newer are ignored — the vocabulary only grows (rule 5).
    return undefined
  }
}

/**
 * Open `url` and yield its frames until the server closes it or `signal` aborts.
 *
 * @throws when the answer is not a 2xx event stream — the caller's backoff treats it like a drop.
 */
export async function* readStream(
  url: string,
  options: { signal: AbortSignal; fetch?: typeof fetch; onOpen?: () => void; onBytes?: () => void },
): AsyncGenerator<SseFrame> {
  const doFetch = options.fetch ?? fetch
  const response = await doFetch(url, {
    headers: { Accept: 'text/event-stream' },
    signal: options.signal,
  })
  if (!response.ok || !response.body) {
    throw new Error(`stream answered ${response.status}`)
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error(`stream answered ${response.headers.get('content-type') ?? 'no content type'}`)
  }
  options.onOpen?.()
  const parser = new SseParser()
  const decoder = new TextDecoder()
  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    options.onBytes?.()
    yield* parser.push(decoder.decode(chunk, { stream: true }))
  }
}
