import type { RunEvent, RunHistoryPage } from '@cezar-pwa/cezar-contract/contract'
import { describe, expect, it } from 'vitest'
import {
  appendLiveEvent,
  asRunEvent,
  carryOver,
  transcriptSignature,
} from './live-transcript.ts'
import { reduceTranscript } from './transcript.ts'

const ts = '2026-09-21T10:00:00.000Z'
const ev = (seq: number, type: string, rest: Record<string, unknown> = {}): RunEvent =>
  ({ seq, ts, type, ...rest }) as RunEvent

const message = (seq: number, type: string, text: string, id = 'm1') =>
  ev(seq, type, { item: { kind: 'message', id, role: 'assistant', text } })
const delta = (seq: number, text: string, itemId = 'm1', field = 'text') =>
  ev(seq, 'item.delta', { itemId, field, delta: text })

const page = (events: RunEvent[], asOfSeq = events.at(-1)?.seq ?? 0): RunHistoryPage => ({
  events,
  itemCount: events.length,
  liveCursor: 'live',
  asOfSeq,
  hasOlder: false,
})

/** Feed events one by one, the way the stream does, and read the newest assistant text. */
function textAfter(start: RunHistoryPage, events: RunEvent[], boundary: number): string {
  const result = events.reduce((acc, event) => appendLiveEvent(acc, event, boundary), start)
  const last = reduceTranscript(result.events).turns.at(-1)?.entries.at(-1)
  return last && 'text' in last ? String(last.text) : ''
}

describe('appendLiveEvent', () => {
  it('appends a new event and advances the high-water mark', () => {
    const start = page([ev(1, 'turn.started', { turnId: 't1' })])
    const next = appendLiveEvent(start, message(2, 'item.started', ''), 1)
    expect(next.events.map((e) => e.seq)).toEqual([1, 2])
    expect(next.asOfSeq).toBe(2)
  })

  it.each([
    ['at the mark', 5],
    ['below the mark', 3],
  ])('drops an event %s — it is already on the page (nothing duplicated)', (_, seq) => {
    const start = page([ev(5, 'note', { message: 'hi' })])
    expect(appendLiveEvent(start, ev(seq, 'note', { message: 'again' }), 0)).toBe(start)
  })

  it('streams deltas into an item started on this connection', () => {
    const start = page([ev(10, 'turn.started', { turnId: 't1' })])
    const text = textAfter(start, [message(11, 'item.started', ''), delta(12, 'Hel'), delta(13, 'lo')], 10)
    expect(text).toBe('Hello')
  })

  it('merges consecutive deltas for the same item and field into one line', () => {
    const start = page([message(11, 'item.started', '')])
    const next = [delta(12, 'a'), delta(13, 'b'), delta(14, 'c')].reduce(
      (acc, event) => appendLiveEvent(acc, event, 10),
      start,
    )
    expect(next.events).toHaveLength(2)
    expect(next.events[1]).toMatchObject({ seq: 14, delta: 'abc' })
    expect(next.asOfSeq).toBe(14)
  })

  it('keeps deltas for different fields apart', () => {
    const start = page([ev(11, 'item.started', { item: { kind: 'tool', id: 't', name: 'Bash', status: 'running' } })])
    const next = [delta(12, 'out', 't', 'output'), delta(13, 'x', 't', 'text')].reduce(
      (acc, event) => appendLiveEvent(acc, event, 10),
      start,
    )
    expect(next.events).toHaveLength(3)
  })

  it('a snapshot supersedes the item’s deltas, which leave the page', () => {
    const start = page([message(11, 'item.started', ''), delta(12, 'Hel')])
    const next = appendLiveEvent(start, message(13, 'item.completed', 'Hello there'), 10)
    expect(next.events.map((e) => e.type)).toEqual(['item.started', 'item.completed'])
    expect(reduceTranscript(next.events).turns[0]?.entries[0]).toMatchObject({ text: 'Hello there' })
  })

  it('does not touch another item’s deltas', () => {
    const start = page([message(11, 'item.started', '', 'a'), message(12, 'item.started', '', 'b'), delta(13, 'x', 'a')])
    const next = appendLiveEvent(start, message(14, 'item.completed', 'done', 'b'), 10)
    expect(next.events.map((e) => e.seq)).toEqual([11, 12, 13, 14])
  })

  it('after a gap, an item caught mid-stream keeps its text until its snapshot (never garbled)', () => {
    // Before the freeze: "Hel" arrived. While frozen: "lo, wor" was sent and is gone for good.
    const before = page([message(11, 'item.started', ''), delta(12, 'Hel')])
    // Reconnected with afterSeq=12, so the new connection's boundary is 12.
    const frozen = textAfter(before, [delta(20, 'ld')], 12)
    expect(frozen).toBe('Hel')
    const healed = textAfter(before, [delta(20, 'ld'), message(21, 'item.completed', 'Hello, world')], 12)
    expect(healed).toBe('Hello, world')
  })

  it('after a gap, deltas resume once a fresh snapshot of the item arrived', () => {
    const before = page([message(11, 'item.started', ''), delta(12, 'Hel')])
    const text = textAfter(before, [message(20, 'item.updated', 'Hello, wor'), delta(21, 'ld')], 12)
    expect(text).toBe('Hello, world')
  })

  it('drops a delta for an item it has never seen, and an empty or malformed one', () => {
    const start = page([ev(1, 'turn.started')])
    for (const event of [delta(2, 'x', 'ghost'), delta(3, ''), ev(4, 'item.delta', { delta: 'no id' })]) {
      const next = appendLiveEvent(start, event, 0)
      expect(next.events).toBe(start.events)
      expect(next.asOfSeq).toBe(event.seq)
    }
  })

  it('appends an unknown type as-is — the fold decides it renders nothing (rule 5)', () => {
    const start = page([ev(1, 'turn.started')])
    const next = appendLiveEvent(start, ev(2, 'hologram.projected', { beam: true }), 0)
    expect(next.events).toHaveLength(2)
    expect(() => reduceTranscript(next.events)).not.toThrow()
  })
})

describe('carryOver', () => {
  it('replays what the stream delivered past the fresh page onto it', () => {
    const previous = page([ev(1, 'note', { message: 'a' }), ev(2, 'note', { message: 'b' }), ev(3, 'note', { message: 'c' })])
    const fresh = page([ev(1, 'note', { message: 'a' }), ev(2, 'note', { message: 'b' })])
    const merged = carryOver(fresh, previous)
    expect(merged.events.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(merged.asOfSeq).toBe(3)
  })

  it('keeps the fresh page when it is already ahead', () => {
    const previous = page([ev(1, 'note', { message: 'a' })])
    const fresh = page([ev(1, 'note', { message: 'a' }), ev(2, 'note', { message: 'b' })])
    expect(carryOver(fresh, previous)).toEqual(fresh)
  })

  it('is the fresh page when nothing was cached', () => {
    const fresh = page([ev(1, 'note', { message: 'a' })])
    expect(carryOver(fresh, undefined)).toBe(fresh)
  })
})

describe('asRunEvent', () => {
  it.each([
    [{ seq: 1, ts, type: 'note' }, true],
    [{ seq: '1', type: 'note' }, false],
    [{ seq: 1 }, false],
    [null, false],
    [[1], false],
  ])('%j → %s', (value, ok) => {
    expect(asRunEvent(value) !== undefined).toBe(ok)
  })
})

describe('transcriptSignature', () => {
  const events = [ev(1, 'turn.started', { turnId: 't' }), message(2, 'item.started', 'Hi')]

  it('does not move when only the status changes the fold', () => {
    expect(transcriptSignature(reduceTranscript(events, { activeTurn: true }))).toBe(
      transcriptSignature(reduceTranscript(events, { activeTurn: false })),
    )
  })

  it('moves when a word arrives', () => {
    const grown = [...events, delta(3, ' there')]
    expect(transcriptSignature(reduceTranscript(grown))).not.toBe(transcriptSignature(reduceTranscript(events)))
  })

  it('moves when an entry arrives', () => {
    const grown = [...events, ev(3, 'note', { message: 'x' })]
    expect(transcriptSignature(reduceTranscript(grown))).not.toBe(transcriptSignature(reduceTranscript(events)))
  })
})
