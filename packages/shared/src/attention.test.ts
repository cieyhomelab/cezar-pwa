import { describe, expect, it } from 'vitest'
import {
  ATTENTION_RANK,
  deriveAttention,
  wantsAttention,
  type Attention,
  type AttentionInput,
} from './attention.ts'
import type { RunStatus } from './types.ts'

/**
 * Ported from Cezar's `packages/web/src/lib/attention.test.ts` (tag `v0.11.0`). The expected
 * values are upstream's, so a failure here means this copy drifted from the cockpit — fix the
 * copy, not the table.
 */

const run = (over: Partial<AttentionInput> = {}): AttentionInput => ({ status: 'running', ...over })

/** Every status the API can send. Stops type-checking if `RunStatus` grows. */
const ALL_STATUSES: readonly RunStatus[] = [
  'queued',
  'running',
  'waiting',
  'review',
  'done',
  'failed',
  'cancelled',
]

describe('deriveAttention', () => {
  const cases: ReadonlyArray<[RunStatus, Attention]> = [
    ['waiting', { bucket: 'waiting', tone: 'pending', pulse: true, label: 'needs you' }],
    ['review', { bucket: 'waiting', tone: 'violet', pulse: true, label: 'needs review' }],
    ['running', { bucket: 'running', tone: 'violet', pulse: true, label: 'running' }],
    ['queued', { bucket: 'none', tone: 'neutral', pulse: false, label: 'queued' }],
    ['done', { bucket: 'none', tone: 'success', pulse: false, label: 'done' }],
    ['failed', { bucket: 'error', tone: 'danger', pulse: false, label: 'failed' }],
    ['cancelled', { bucket: 'none', tone: 'neutral', pulse: false, label: 'cancelled' }],
  ]

  it.each(cases)('maps %s', (status, expected) => {
    expect(deriveAttention(run({ status }))).toEqual(expected)
  })

  it('answers for every status the API can send', () => {
    expect(cases.map(([status]) => status).sort()).toEqual([...ALL_STATUSES].sort())
  })

  it('pulses exactly the transitioning states', () => {
    const pulsing = ALL_STATUSES.filter((status) => deriveAttention(run({ status })).pulse)
    expect(pulsing).toEqual(['running', 'waiting', 'review'])
  })

  it('never claims a permission prompt — Cezar emits none (docs/CEZAR_API.md § 5a)', () => {
    for (const status of ALL_STATUSES) {
      expect(deriveAttention(run({ status })).bucket).not.toBe('permission')
    }
  })

  it('never claims unseen — unread rides its own channel', () => {
    for (const status of ALL_STATUSES) {
      expect(deriveAttention(run({ status })).bucket).not.toBe('unseen')
    }
  })

  it('ignores fields it does not read', () => {
    const wider = { ...run({ status: 'done' }), archived: true, prNumber: 7, somethingNew: 'x' }
    expect(deriveAttention(wider)).toEqual(deriveAttention(run({ status: 'done' })))
  })
})

describe('ATTENTION_RANK', () => {
  it('is the ladder: permission > error > waiting > running > unseen', () => {
    const order = Object.entries(ATTENTION_RANK)
      .sort(([, a], [, b]) => a - b)
      .map(([bucket]) => bucket)
    expect(order).toEqual(['permission', 'error', 'waiting', 'running', 'unseen', 'none'])
  })
})

describe('a run waiting out a usage limit', () => {
  const scheduled = run({ status: 'failed', autoResumeAt: '2026-08-03T19:33:53.000Z' })

  it('reads as scheduled and parked, never as a red failure', () => {
    expect(deriveAttention(scheduled)).toEqual({
      bucket: 'none',
      tone: 'pending',
      pulse: false,
      label: 'scheduled',
    })
  })

  it('asks for nothing, while a plain failure does', () => {
    expect(wantsAttention(scheduled)).toBe(false)
    expect(wantsAttention(run({ status: 'failed' }))).toBe(true)
  })

  it('only applies to a FAILED run — a live run with a stale stamp is still live', () => {
    expect(
      deriveAttention(run({ status: 'running', autoResumeAt: '2026-08-03T19:33:53.000Z' })).label,
    ).toBe('running')
  })
})

describe('wantsAttention', () => {
  it.each(ALL_STATUSES)('%s', (status) => {
    const expected = status === 'waiting' || status === 'review' || status === 'failed'
    expect(wantsAttention(run({ status }))).toBe(expected)
  })
})

describe("running activity: 'monitoring'", () => {
  it('is a distinct, non-attention sub-state of running', () => {
    expect(deriveAttention(run({ status: 'running', activity: 'monitoring' }))).toEqual({
      bucket: 'running',
      tone: 'violet',
      pulse: true,
      label: 'monitoring',
    })
    expect(wantsAttention(run({ status: 'running', activity: 'monitoring' }))).toBe(false)
  })

  it('is inert on non-running statuses', () => {
    expect(deriveAttention(run({ status: 'done', activity: 'monitoring' })).label).toBe('done')
  })

  it('treats an activity it does not know as plain running (append-only vocabulary)', () => {
    expect(deriveAttention(run({ status: 'running', activity: 'compacting' })).label).toBe(
      'running',
    )
  })
})
