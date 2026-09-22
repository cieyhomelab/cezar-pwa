import type { RunsIndexResponse } from '@cezar-pwa/cezar-contract/contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeEventSource, fakeSourceFactory } from '../../test/fake-event-source.ts'
import fixture from '../../test/fixtures/runs-index.json'
import {
  BACKOFF_MS,
  FrameJournal,
  LOST_AFTER_MS,
  WATCHDOG_MS,
  WORKSPACE_EVENTS_PATH,
  WorkspaceStream,
  type LiveState,
} from './workspace-events.ts'

function setup() {
  const states: LiveState[] = []
  const frames: { type: string; data: unknown }[] = []
  const onOpen = vi.fn()
  const onDrop = vi.fn()
  const stream = new WorkspaceStream({
    onFrame: (frame) => frames.push(frame),
    onOpen,
    onDrop,
    onState: (state) => states.push(state),
    createSource: fakeSourceFactory,
  })
  return { stream, states, frames, onOpen, onDrop }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeEventSource.reset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('WorkspaceStream', () => {
  it('opens the workspace stream and reports live once it is open', () => {
    const { stream, states, onOpen } = setup()
    stream.start()
    expect(FakeEventSource.latest.url).toBe(WORKSPACE_EVENTS_PATH)
    expect(stream.state).toBe('connecting')

    FakeEventSource.latest.open()
    expect(states).toEqual(['live'])
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('hands frames on parsed, including the ones it does not merge', () => {
    const { stream, frames } = setup()
    stream.start()
    FakeEventSource.latest.open()
    FakeEventSource.latest.emit('run', { id: 'r', project: 'p' })
    FakeEventSource.latest.emit('ping')
    FakeEventSource.latest.emit('run', '{not json')
    expect(frames).toEqual([
      { type: 'run', data: { id: 'r', project: 'p' } },
      { type: 'ping', data: null },
      { type: 'run', data: undefined },
    ])
  })

  it('on a drop, says reconnecting, re-asks the session once, and retries on its own backoff', () => {
    const { stream, states, onDrop, onOpen } = setup()
    stream.start()
    FakeEventSource.latest.open()
    const first = FakeEventSource.latest

    first.fail()
    expect(first.closed).toBe(true) // the browser's own retry is taken away
    expect(stream.state).toBe('reconnecting')
    expect(onDrop).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(BACKOFF_MS[0])
    expect(FakeEventSource.instances).toHaveLength(2)
    FakeEventSource.latest.fail()
    expect(onDrop).toHaveBeenCalledTimes(1) // once per disconnection, not per attempt

    vi.advanceTimersByTime(BACKOFF_MS[1] - 1)
    expect(FakeEventSource.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(3)

    FakeEventSource.latest.open()
    expect(states).toEqual(['live', 'reconnecting', 'live'])
    // Every open refetches — there is no replay to fill the gap.
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('calls it lost after a while without a connection, and keeps trying', () => {
    const { stream } = setup()
    stream.start()
    FakeEventSource.latest.open()
    FakeEventSource.latest.fail()

    vi.advanceTimersByTime(LOST_AFTER_MS - 1)
    expect(stream.state).toBe('reconnecting')
    vi.advanceTimersByTime(1)
    expect(stream.state).toBe('lost')

    const before = FakeEventSource.instances.length
    vi.advanceTimersByTime(BACKOFF_MS.at(-1)! * 2)
    expect(FakeEventSource.instances.length).toBeGreaterThan(before)
    FakeEventSource.latest.open()
    expect(stream.state).toBe('live')
  })

  it('never outgrows the last backoff step', () => {
    const { stream } = setup()
    stream.start()
    for (let i = 0; i < BACKOFF_MS.length + 3; i += 1) {
      FakeEventSource.latest.fail()
      vi.advanceTimersByTime(BACKOFF_MS.at(-1)!)
    }
    expect(FakeEventSource.instances).toHaveLength(BACKOFF_MS.length + 4)
  })

  it('treats three missed pings as a dead stream even when no error fired', () => {
    const { stream } = setup()
    stream.start()
    FakeEventSource.latest.open()
    vi.advanceTimersByTime(WATCHDOG_MS - 1_000)
    FakeEventSource.latest.emit('ping') // a frame re-arms the watchdog
    vi.advanceTimersByTime(WATCHDOG_MS - 1_000)
    expect(stream.state).toBe('live')

    vi.advanceTimersByTime(1_000)
    expect(stream.state).toBe('reconnecting')
    expect(FakeEventSource.instances[0].closed).toBe(true)
  })

  it('gives up on a connect that never opens', () => {
    const { stream } = setup()
    stream.start()
    vi.advanceTimersByTime(WATCHDOG_MS)
    expect(stream.state).toBe('reconnecting')
  })

  it('is lost at once when the browser goes offline, and tries again when it is back', () => {
    const { stream } = setup()
    stream.start()
    FakeEventSource.latest.open()

    stream.setOnline(false)
    expect(stream.state).toBe('lost')
    expect(FakeEventSource.latest.closed).toBe(true)
    vi.advanceTimersByTime(60_000)
    expect(FakeEventSource.instances).toHaveLength(1) // no pointless retries while offline

    stream.setOnline(true)
    expect(FakeEventSource.instances).toHaveLength(2)
    FakeEventSource.latest.open()
    expect(stream.state).toBe('live')
  })

  it('stops cleanly and starts afresh, as on hide and show', () => {
    const { stream, states } = setup()
    stream.start()
    FakeEventSource.latest.open()
    stream.stop()
    expect(FakeEventSource.latest.closed).toBe(true)
    vi.advanceTimersByTime(WATCHDOG_MS * 2)
    expect(FakeEventSource.instances).toHaveLength(1)

    stream.start()
    expect(stream.state).toBe('connecting')
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(states).toEqual(['live', 'connecting'])
  })

  it('ignores a closed connection that still speaks', () => {
    const { stream, frames } = setup()
    stream.start()
    const old = FakeEventSource.latest
    old.open()
    old.fail()
    old.emit('run', { id: 'late' })
    expect(frames).toEqual([])
    expect(stream.state).toBe('reconnecting')
  })

  it('never claims to be live without EventSource', () => {
    const states: LiveState[] = []
    const stream = new WorkspaceStream({
      onFrame: vi.fn(),
      onOpen: vi.fn(),
      onDrop: vi.fn(),
      onState: (state) => states.push(state),
      createSource: undefined,
    })
    // jsdom has no EventSource, so the default factory is absent here too.
    stream.start()
    expect(states).toEqual(['lost'])
  })
})

describe('FrameJournal', () => {
  const index = fixture as RunsIndexResponse
  const running = index.runs.find((row) => row.status === 'running')!
  const toWaiting = {
    type: 'run',
    data: { ...running, projectId: undefined, project: running.projectId, status: 'waiting' },
  }

  it('replays a frame that arrived while the request travelled onto its answer', () => {
    const journal = new FrameJournal()
    const mark = journal.begin()
    journal.record(toWaiting)
    // The answer was computed before the change: it still says running.
    const result = journal.settle(mark, index)
    expect(result.runs.find((row) => row.id === running.id)?.status).toBe('waiting')
  })

  it('does not replay frames from before the request', () => {
    const journal = new FrameJournal()
    journal.record(toWaiting)
    const mark = journal.begin()
    expect(journal.settle(mark, index)).toBe(index)
  })

  it('keeps frames for a request still in flight when an overlapping one settles', () => {
    const journal = new FrameJournal()
    const first = journal.begin()
    journal.record(toWaiting)
    const second = journal.begin()
    journal.discard(second)
    const result = journal.settle(first, index)
    expect(result.runs.find((row) => row.id === running.id)?.status).toBe('waiting')
  })

  // Two requests begun with no frame in between share a mark: the focus refetch cancelled by the
  // stream-open invalidation on an iOS wake (#32). Ending one must not end the other.
  it.each([
    ['discarded', (journal: FrameJournal, mark: number) => journal.discard(mark)],
    ['settled', (journal: FrameJournal, mark: number) => void journal.settle(mark, index)],
  ])('keeps frames for a request sharing its mark with one %s before them', (_, end) => {
    const journal = new FrameJournal()
    const first = journal.begin()
    const second = journal.begin()
    end(journal, first)
    journal.record(toWaiting)
    const result = journal.settle(second, index)
    expect(result.runs.find((row) => row.id === running.id)?.status).toBe('waiting')
  })

  it('holds nothing once every request sharing a mark has ended', () => {
    const journal = new FrameJournal()
    const first = journal.begin()
    const second = journal.begin()
    journal.discard(first)
    journal.discard(second)
    journal.record(toWaiting)
    expect(journal.settle(journal.begin(), index)).toBe(index)
  })

  it('holds nothing once no request is in flight', () => {
    const journal = new FrameJournal()
    journal.discard(journal.begin())
    journal.record(toWaiting)
    expect(journal.settle(journal.begin(), index)).toBe(index)
  })
})
