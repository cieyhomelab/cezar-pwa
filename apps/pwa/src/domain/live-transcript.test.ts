import type { RunEvent, RunHistoryPage } from '@cezar-pwa/cezar-contract/contract'
import { describe, expect, it } from 'vitest'
import {
  appendLiveEvent,
  asRunEvent,
  carryOver,
  prependOlder,
  transcriptSignature,
} from './live-transcript.ts'
import longPages from '../../test/fixtures/history-pages.long.json'
import longRecording from '../../test/fixtures/transcript-long.ndjson?raw'
import { reduceTranscript } from './transcript.ts'

const ts = '2026-09-21T10:00:00.000Z'
const ev = (seq: number, type: string, rest: Record<string, unknown> = {}): RunEvent =>
  ({ seq, ts, type, ...rest }) as RunEvent

const message = (seq: number, type: string, text: string, id = 'm1') =>
  ev(seq, type, { item: { kind: 'message', id, role: 'assistant', text } })
const note = (seq: number) => ev(seq, 'note', { message: `n${seq}` })
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

  // FR-049: what the operator scrolled back through survives the 30 s refetch.
  const older = (events: RunEvent[], olderCursor?: string): RunHistoryPage => ({
    ...page(events),
    hasOlder: olderCursor !== undefined,
    ...(olderCursor !== undefined ? { olderCursor } : {}),
  })

  it('keeps the earlier lines a refetched page no longer reaches, with the way further back', () => {
    const previous = older([note(1), note(2), note(3), note(4)], 'c-before-1')
    const fresh = older([note(3), note(4), note(5)], 'c-before-3')
    const merged = carryOver(fresh, previous)
    expect(merged.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5])
    expect(merged.olderCursor).toBe('c-before-1')
    expect(merged.hasOlder).toBe(true)
    expect(merged.asOfSeq).toBe(5)
    expect(merged.liveCursor).toBe(fresh.liveCursor)
  })

  it('keeps the start of the file once it was reached', () => {
    const previous = page([note(1), note(2), note(3)])
    const merged = carryOver(older([note(2), note(3), note(4)], 'c-before-2'), previous)
    expect(merged.events.map((e) => e.seq)).toEqual([1, 2, 3, 4])
    expect(merged.hasOlder).toBe(false)
    expect(merged.olderCursor).toBeUndefined()
  })

  it('takes the fresh page alone when lines between the two are on neither (no hole)', () => {
    const previous = older([note(1), note(2), note(3)], 'c-before-1')
    const fresh = older([note(8), note(9)], 'c-before-8')
    expect(carryOver(fresh, previous)).toEqual(fresh)
  })

  it('does not count the turn opener the server repeats in front of a page as an overlap', () => {
    // The opener (seq 2) is on both pages; the fresh page's first item (9) is past the previous
    // page's mark, so 4 to 8 are on neither.
    const previous = older([note(1), ev(2, 'user-message', { text: 'go' }), note(3), note(4)], 'c-before-1')
    const fresh = older([ev(2, 'user-message', { text: 'go' }), note(9), note(10)], 'c-before-9')
    expect(carryOver(fresh, previous)).toEqual(fresh)
  })

  it("drops the stream's deltas below the fresh mark: the page's snapshot supersedes them", () => {
    const previous = older([message(1, 'item.started', '', 'm0'), delta(2, 'x', 'm0'), note(3), note(4)], 'c-0')
    const fresh = older([note(3), note(4), note(5)], 'c-3')
    expect(carryOver(fresh, previous).events.map((e) => e.seq)).toEqual([1, 3, 4, 5])
  })
})

describe('prependOlder', () => {
  const file = longRecording
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as RunEvent)
  const pages = longPages as { cursor: string | null; page: RunHistoryPage }[]

  it('walks back from the newest page to the whole file, one cursor at a time', () => {
    let held = pages[0]!.page
    for (const { cursor, page: olderPage } of pages.slice(1)) {
      expect(held.olderCursor).toBe(cursor)
      held = prependOlder(held, olderPage, cursor!)
    }
    expect(held.events.map((e) => e.seq)).toEqual(file.map((e) => e.seq))
    expect(held.hasOlder).toBe(false)
    expect(held.olderCursor).toBeUndefined()
    // The newest page's resume point is untouched: the stream still continues from it.
    expect(held.asOfSeq).toBe(pages[0]!.page.asOfSeq)
    expect(held.liveCursor).toBe(pages[0]!.page.liveCursor)
    expect(reduceTranscript(held.events)).toEqual(reduceTranscript(file))
  })

  it('ignores a page asked for with a cursor the held page no longer has', () => {
    const [newest, second] = pages
    const once = prependOlder(newest!.page, second!.page, second!.cursor!)
    expect(prependOlder(once, second!.page, second!.cursor!)).toBe(once)
    expect(prependOlder(newest!.page, second!.page, 'another-cursor')).toBe(newest!.page)
  })

  it('keeps what the stream added while the older page was on its way', () => {
    const [newest, second] = pages
    const extended = appendLiveEvent(newest!.page, note(newest!.page.asOfSeq + 1), 0)
    const held = prependOlder(extended, second!.page, second!.cursor!)
    expect(held.events.at(-1)?.seq).toBe(newest!.page.asOfSeq + 1)
    expect(held.asOfSeq).toBe(newest!.page.asOfSeq + 1)
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
