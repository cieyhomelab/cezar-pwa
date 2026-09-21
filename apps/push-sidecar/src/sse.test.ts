import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readStream, SseParser } from './sse.ts'

const LIVE = readFileSync(
  new URL('../../pwa/test/fixtures/workspace-events.live-0.11.0.txt', import.meta.url),
  'utf8',
)

describe('SseParser', () => {
  it('reads the recorded live stream into named frames', () => {
    const frames = new SseParser().push(LIVE)
    expect(frames[0]).toEqual({ type: 'ping', data: '' })
    expect(frames.filter((frame) => frame.type === 'usage').length).toBeGreaterThan(0)
    for (const frame of frames.filter((f) => f.type === 'usage')) {
      expect(() => JSON.parse(frame.data)).not.toThrow()
    }
  })

  it('holds a frame split across chunks until its blank line arrives', () => {
    const parser = new SseParser()
    expect(parser.push('event: run\ndata: {"a"')).toEqual([])
    expect(parser.push(':1}\n')).toEqual([])
    expect(parser.push('\n')).toEqual([{ type: 'run', data: '{"a":1}' }])
  })

  it('accepts CRLF, including a CRLF split between chunks', () => {
    const parser = new SseParser()
    expect(parser.push('event: ping\r')).toEqual([])
    expect(parser.push('\ndata: x\r\n\r\n')).toEqual([{ type: 'ping', data: 'x' }])
  })

  it('joins multi-line data, skips comments and unknown fields, defaults the name', () => {
    const frames = new SseParser().push(': hello\nid: 7\nretry: 10\ndata: a\ndata: b\n\n')
    expect(frames).toEqual([{ type: 'message', data: 'a\nb' }])
  })
})

describe('readStream', () => {
  const streamResponse = (body: string, init: ResponseInit = {}) =>
    new Response(body, { headers: { 'content-type': 'text/event-stream' }, ...init })

  it('yields frames and reports the open', async () => {
    let opened = false
    const frames = []
    for await (const frame of readStream('http://cezar/events', {
      signal: new AbortController().signal,
      fetch: async () => streamResponse('event: ping\ndata:\n\n'),
      onOpen: () => {
        opened = true
      },
    })) {
      frames.push(frame)
    }
    expect(opened).toBe(true)
    expect(frames).toEqual([{ type: 'ping', data: '' }])
  })

  it('refuses a non-2xx answer and a non-stream answer', async () => {
    const drain = async (response: Response) => {
      for await (const _ of readStream('http://cezar/events', {
        signal: new AbortController().signal,
        fetch: async () => response,
      })) {
        // nothing
      }
    }
    await expect(drain(streamResponse('', { status: 403 }))).rejects.toThrow('403')
    await expect(drain(new Response('<html>', { headers: { 'content-type': 'text/html' } }))).rejects.toThrow(
      'text/html',
    )
  })
})
