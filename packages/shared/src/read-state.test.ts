import { describe, expect, it } from 'vitest'
import { canBeUnread, isDoneItem, isReadDoneItem, isUnread, type ReadStateInput } from './read-state.ts'
import type { RunStatus } from './types.ts'

/**
 * Ported from Cezar's `packages/web/src/lib/read-state.test.ts` (tag `v0.11.0`). Expected
 * values are upstream's — a failure means the copy drifted from the cockpit.
 */

/** A done run that finished at a fixed instant and has never been opened — i.e. unread. */
const done = (over: Partial<ReadStateInput> = {}): ReadStateInput => ({
  status: 'done',
  finishedAt: '2026-08-01T10:00:00.000Z',
  seenAt: undefined,
  archived: false,
  ...over,
})

const LIVE: RunStatus[] = ['queued', 'running', 'waiting', 'review']

describe('isDoneItem', () => {
  it('is true for the terminal statuses and false for live ones', () => {
    for (const status of ['done', 'failed', 'cancelled'] as RunStatus[]) {
      expect(isDoneItem(status)).toBe(true)
    }
    for (const status of LIVE) expect(isDoneItem(status)).toBe(false)
  })
})

describe('isUnread', () => {
  it('is unread when a done or failed run has never been seen', () => {
    expect(isUnread(done())).toBe(true)
    expect(isUnread(done({ status: 'failed' }))).toBe(true)
  })

  it('is read once seen at or after it finished', () => {
    expect(isUnread(done({ seenAt: '2026-08-01T10:00:00.000Z' }))).toBe(false)
    expect(isUnread(done({ seenAt: '2026-08-01T10:05:00.000Z' }))).toBe(false)
  })

  it('goes unread again when the run re-finished after the last receipt', () => {
    expect(
      isUnread(done({ seenAt: '2026-08-01T10:00:00.000Z', finishedAt: '2026-08-01T11:00:00.000Z' })),
    ).toBe(true)
  })

  it('is never unread for a cancelled, live, unfinished or archived run', () => {
    expect(isUnread(done({ status: 'cancelled' }))).toBe(false)
    for (const status of LIVE) expect(isUnread(done({ status, finishedAt: undefined }))).toBe(false)
    expect(isUnread(done({ finishedAt: undefined }))).toBe(false)
    expect(isUnread(done({ archived: true }))).toBe(false)
  })

  it('is never unread for a failure waiting out a usage limit — there is no outcome yet', () => {
    expect(isUnread(done({ status: 'failed', autoResumeAt: '2026-08-01T12:00:00.000Z' }))).toBe(
      false,
    )
  })
})

describe('canBeUnread', () => {
  it('is true for a finished done/failed run regardless of its receipt', () => {
    expect(canBeUnread(done())).toBe(true)
    expect(canBeUnread(done({ status: 'failed', seenAt: '2026-08-01T10:05:00.000Z' }))).toBe(true)
  })

  it('is false for the rows that can never wear the marker', () => {
    expect(canBeUnread(done({ status: 'cancelled' }))).toBe(false)
    expect(canBeUnread(done({ archived: true }))).toBe(false)
    expect(canBeUnread(done({ finishedAt: undefined }))).toBe(false)
  })
})

describe('isReadDoneItem', () => {
  it('is true for a read done item and a cancelled run', () => {
    expect(isReadDoneItem(done({ seenAt: '2026-08-01T10:05:00.000Z' }))).toBe(true)
    expect(isReadDoneItem(done({ status: 'cancelled' }))).toBe(true)
  })

  it('is false for an unread done item, a live run and a scheduled resume', () => {
    expect(isReadDoneItem(done())).toBe(false)
    expect(isReadDoneItem(done({ status: 'running', finishedAt: undefined }))).toBe(false)
    expect(isReadDoneItem(done({ status: 'failed', autoResumeAt: '2026-08-01T12:00:00.000Z' }))).toBe(
      false,
    )
  })
})
