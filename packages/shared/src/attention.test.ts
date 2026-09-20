import { describe, expect, it } from 'vitest'
import {
  ATTENTION_PRIORITY,
  deriveAttention,
  needsAttention,
  type AttentionInput,
  type AttentionReason,
} from './attention.ts'

type Case = {
  name: string
  run: AttentionInput
  expected: AttentionReason | null
}

// One case per branch of `docs/CEZAR_API.md` §5, plus the orderings that the
// first-match-wins rule makes load-bearing.
const cases: Case[] = [
  // Branch 1 — unreachable on this instance (§5a), asserted anyway so the copy
  // stays 1:1 with the cockpit if Cezar ever wires the emitter.
  {
    name: 'pending permission request wins over everything',
    run: { status: 'running', hasPendingPermissionRequest: true },
    expected: 'permission',
  },
  {
    name: 'permission outranks waiting',
    run: { status: 'waiting', hasPendingPermissionRequest: true },
    expected: 'permission',
  },
  // Branch 2 — must precede branch 5.
  {
    name: 'failed with autoResumeAt is scheduled, not attention',
    run: { status: 'failed', autoResumeAt: '2026-09-20T18:00:00Z' },
    expected: null,
  },
  {
    name: 'failed with autoResumeAt as epoch millis is still scheduled',
    run: { status: 'failed', autoResumeAt: 1_790_000_000_000 },
    expected: null,
  },
  {
    name: 'failed with null autoResumeAt is a real failure',
    run: { status: 'failed', autoResumeAt: null },
    expected: 'failed',
  },
  // Branch 3.
  { name: 'waiting needs an answer', run: { status: 'waiting' }, expected: 'waiting' },
  // Branch 4.
  { name: 'review needs a review', run: { status: 'review' }, expected: 'review' },
  // Branch 5.
  { name: 'failed needs attention', run: { status: 'failed' }, expected: 'failed' },
  // Branch 6.
  {
    name: 'running while monitoring does not need attention',
    run: { status: 'running', activity: 'monitoring' },
    expected: null,
  },
  { name: 'plain running does not need attention', run: { status: 'running' }, expected: null },
  // Statuses with no branch at all.
  { name: 'queued does not need attention', run: { status: 'queued' }, expected: null },
  { name: 'done does not need attention', run: { status: 'done' }, expected: null },
  { name: 'cancelled does not need attention', run: { status: 'cancelled' }, expected: null },
]

describe('deriveAttention', () => {
  it.each(cases)('$name', ({ run, expected }) => {
    expect(deriveAttention(run)).toBe(expected)
  })

  it('ignores unknown fields — the vocabulary is append-only', () => {
    const run = {
      status: 'waiting',
      activity: 'some-future-activity',
      somethingCezarAddedLater: true,
    } as AttentionInput
    expect(deriveAttention(run)).toBe('waiting')
  })

  it('does not throw on a status outside the known union', () => {
    const run = { status: 'a-status-from-the-future' } as unknown as AttentionInput
    expect(() => deriveAttention(run)).not.toThrow()
    expect(deriveAttention(run)).toBeNull()
  })
})

describe('needsAttention', () => {
  it.each(cases)('$name', ({ run, expected }) => {
    expect(needsAttention(run)).toBe(expected !== null)
  })
})

describe('ATTENTION_PRIORITY', () => {
  it('orders the attention section permission → waiting → review → failed', () => {
    const ordered = (Object.keys(ATTENTION_PRIORITY) as AttentionReason[]).sort(
      (a, b) => ATTENTION_PRIORITY[a] - ATTENTION_PRIORITY[b],
    )
    expect(ordered).toEqual(['permission', 'waiting', 'review', 'failed'])
  })
})
