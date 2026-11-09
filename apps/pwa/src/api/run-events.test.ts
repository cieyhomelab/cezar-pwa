import { describe, expect, it } from 'vitest'
import { RUN_FRAME_TYPES, runEventsUrl } from './run-events.ts'

/**
 * Cezar 0.19.0 (#882): a CURSORLESS connect with no `afterSeq` replays only the newest ~1.5 MB and
 * sends a `history-truncated` frame first. A resume with `afterSeq` is never truncated, so the PWA
 * always sends one — and only listens to the frames it names, so the new one is dropped unread.
 */
describe('runEventsUrl', () => {
  it.each([
    ['a fresh connect', { afterSeq: 0 }, 'afterSeq=0'],
    ['a resume', { afterSeq: 41 }, 'afterSeq=41'],
    ['a resume with a cursor', { cursor: 'c1', afterSeq: 7 }, 'cursor=c1&afterSeq=7'],
  ] as const)('always carries afterSeq on %s', (_, resume, query) => {
    expect(runEventsUrl('p 1', 'r/1', resume)).toBe(`/api/v1/p/p%201/runs/r%2F1/events?${query}`)
  })
})

describe('RUN_FRAME_TYPES', () => {
  it('does not subscribe to history-truncated', () => {
    expect(RUN_FRAME_TYPES).not.toContain('history-truncated')
  })
})
