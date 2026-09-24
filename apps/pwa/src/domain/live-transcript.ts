import type { RunEvent, RunHistoryPage } from '@cezar-pwa/cezar-contract/contract'
import { mergeBySeq, type Transcript } from './transcript.ts'

/**
 * S-06: the newest history page, kept current from the run's event stream
 * (`GET …/runs/:id/events`, `docs/CEZAR_API.md` § 3b). Pure functions over the page the
 * `['history', projectId, runId]` query holds. The stream writes through them with
 * `setQueryData`, and the transcript fold (`reduceTranscript`) reads the result as it always did.
 *
 * The page's `asOfSeq` is the high-water mark: every event up to it is on the page (or was
 * superseded). It advances with each accepted event. That makes it both the dedup key ("nothing
 * duplicated", FR-021) and the resume point: a reconnect asks for `afterSeq=asOfSeq` and the
 * server replays every persisted line after it ("nothing lost").
 *
 * The one thing a replay cannot restore is an `item.delta`. Deltas are ephemeral: they carry a
 * `seq` but never reach the file, so any sent while the phone was frozen are gone. An item that
 * was streaming across a gap would otherwise go on growing from the wrong place, its middle
 * missing. So a delta is only applied to an item whose latest snapshot arrived after the
 * current connection's starting point. An item caught mid-stream keeps the text it had and is
 * made whole by its next snapshot (`item.updated` / `item.completed` carry the full item).
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A line the fold can use: the envelope the server stamps on every event. */
export function asRunEvent(value: unknown): RunEvent | undefined {
  return isRecord(value) && typeof value.seq === 'number' && typeof value.type === 'string'
    ? (value as RunEvent)
    : undefined
}

const SNAPSHOTS = new Set(['item.started', 'item.updated', 'item.completed'])

/** The v2 item an event is about, keyed as the fold keys it (step + item id). */
function itemOf(event: RunEvent): string | undefined {
  const step = typeof event.stepId === 'string' ? event.stepId : ''
  if (event.type === 'item.delta') {
    return typeof event.itemId === 'string' ? `${step}\0${event.itemId}` : undefined
  }
  if (SNAPSHOTS.has(event.type) && isRecord(event.item) && typeof event.item.id === 'string') {
    return `${step}\0${event.item.id}`
  }
  return undefined
}

/** The seq of the item's newest snapshot on the page, or -1 when it has none. */
function latestSnapshotSeq(events: readonly RunEvent[], item: string): number {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!
    if (SNAPSHOTS.has(event.type) && itemOf(event) === item) return event.seq
  }
  return -1
}

/**
 * Accept one event off the stream. Returns the same page when nothing changed, so a caller can
 * skip the cache write.
 *
 * - An event at or below `asOfSeq` is already here: dropped (a replay overlapping the page, or a
 *   reconnect overlapping the last connection).
 * - A delta for an item whose newest snapshot is not newer than `boundary` is dropped (see the
 *   module note). Consecutive deltas for the same item and field merge into one line, so a long
 *   answer costs one line, not hundreds.
 * - A snapshot supersedes the item's earlier deltas, which are removed: the page grows with the
 *   persisted file, not with the token rate.
 */
export function appendLiveEvent(page: RunHistoryPage, event: RunEvent, boundary: number): RunHistoryPage {
  if (event.seq <= page.asOfSeq) return page
  const advanced = { ...page, asOfSeq: event.seq }
  const item = itemOf(event)

  if (event.type === 'item.delta') {
    if (item === undefined || typeof event.delta !== 'string' || event.delta === '') return advanced
    if (latestSnapshotSeq(page.events, item) <= boundary) return advanced
    const last = page.events.at(-1)
    if (last?.type === 'item.delta' && itemOf(last) === item && last.field === event.field) {
      const merged = { ...last, seq: event.seq, delta: `${String(last.delta)}${event.delta}` }
      return { ...advanced, events: [...page.events.slice(0, -1), merged] }
    }
    return { ...advanced, events: [...page.events, event] }
  }

  if (item !== undefined && event.type !== 'item.started') {
    const kept = page.events.filter((line) => !(line.type === 'item.delta' && itemOf(line) === item))
    return { ...advanced, events: [...kept, event] }
  }
  return { ...advanced, events: [...page.events, event] }
}

/**
 * A refetched page landing over one the stream has been extending. The fresh page was computed
 * on the server before it travelled, so anything the stream delivered past its `asOfSeq` would be
 * silently undone by writing it as-is (the list's `FrameJournal` guards the same race). Those
 * events are replayed onto it.
 *
 * FR-049: the fresh page is only the newest 100 items, so it would also drop every older page
 * the operator scrolled back through, and whatever of the previous page it no longer reaches.
 * Those earlier lines are kept, with the previous page's way further back, as long as the two
 * pages overlap (`overlaps`). When they do not, the lines between them are on neither, and
 * keeping the earlier ones would show a hole as if nothing happened there: the fresh page stands
 * alone, as it always did.
 */
export function carryOver(fresh: RunHistoryPage, previous: RunHistoryPage | undefined): RunHistoryPage {
  if (previous === undefined) return fresh
  const newer = previous.events.filter((event) => event.seq > fresh.asOfSeq)
  // No boundary for deltas here: they were accepted once already, against the connection that
  // delivered them.
  return newer.reduce((page, event) => appendLiveEvent(page, event, -1), keepEarlier(fresh, previous))
}

/**
 * How far back a page's lines run without a gap: the `seq` of its second line. The server may
 * put the turn's opening line in front of the page's first item, however far back it is
 * (`pageEventSlice`), so the first line proves nothing; the second is the page's own first item.
 * (Where there is no opener in front, this is one line short: taken as reaching less far, which
 * is never wrong, only cautious.) Undefined for a page of fewer than two lines.
 *
 * FR-049: it only moves back when older lines landed in front, never on a refetch that kept them
 * (`carryOver`): the screen's cue that the new content is above, not at the end.
 */
export function pageReach(page: RunHistoryPage): number | undefined {
  return page.events[1]?.seq
}

/** Whether `fresh` reaches back into what `previous` already holds, leaving no line unread. */
function overlaps(fresh: RunHistoryPage, previous: RunHistoryPage): boolean {
  const reach = pageReach(fresh)
  return reach !== undefined && reach <= previous.asOfSeq
}

function keepEarlier(fresh: RunHistoryPage, previous: RunHistoryPage): RunHistoryPage {
  const reach = pageReach(fresh)
  const held = pageReach(previous)
  // The fresh page reaches the start of the file, or at least as far back as the previous one.
  // Compared past the openers: inside one long turn, both pages start with the same one.
  if (!fresh.hasOlder || reach === undefined || held === undefined || held >= reach) return fresh
  if (!overlaps(fresh, previous)) return fresh
  // Up to the fresh page's mark it is the authority. Deltas are the stream's, never in the file:
  // whatever of them the fresh page does not cover has been superseded by a snapshot on it.
  const earlier = previous.events.filter((event) => event.seq <= fresh.asOfSeq && event.type !== 'item.delta')
  return withOlder({ ...fresh, events: mergeBySeq(earlier, fresh.events) }, previous)
}

/** `page` with `from`'s way further back: its `hasOlder`, and its cursor only while there is one. */
function withOlder(page: RunHistoryPage, from: RunHistoryPage): RunHistoryPage {
  const next: RunHistoryPage = { ...page, hasOlder: from.hasOlder }
  if (from.hasOlder && from.olderCursor !== undefined) next.olderCursor = from.olderCursor
  else delete next.olderCursor
  return next
}

/**
 * FR-049: an older page, fetched with `cursor`, in front of the page the screen holds. The fold
 * runs over the raw lines of both, merged by `seq` (`mergeBySeq`), never over two folded halves:
 * a turn can span the boundary, and the v1/v2 dedup in `transcript.ts` works per turn. The server
 * repeats a turn's opening line on the page after it, which the merge collapses.
 *
 * Returns the page unchanged when it has moved on since the request (a refetch replaced it, or
 * the same page already landed): the older page then no longer ends where it begins.
 */
export function prependOlder(page: RunHistoryPage, older: RunHistoryPage, cursor: string): RunHistoryPage {
  if (!page.hasOlder || page.olderCursor !== cursor) return page
  return withOlder({ ...page, events: mergeBySeq(older.events, page.events) }, older)
}

/**
 * What the reader sees change: turns, entries, and how long the newest entry is. A status flip
 * re-folds the transcript without changing a word of it, and that must not announce "new
 * messages" (FR-019).
 */
export function transcriptSignature(transcript: Transcript): string {
  let entries = 0
  for (const turn of transcript.turns) entries += turn.entries.length + (turn.userMessage ? 1 : 0)
  const last = transcript.turns.at(-1)?.entries.at(-1)
  let size = 0
  if (last !== undefined) {
    if ('text' in last && typeof last.text === 'string') size = last.text.length
    else if (last.kind === 'tool') size = (last.output?.length ?? 0) + last.status.length
  }
  return `${transcript.turns.length}:${entries}:${size}`
}
