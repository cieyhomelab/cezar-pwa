import { describe, expect, it } from 'vitest'
import {
  attentionPayload,
  isEntering,
  MAX_TITLE_LENGTH,
  notificationTitle,
  runKey,
  type NotifiableRun,
} from './notifications.ts'
import type { RunStatus } from './types.ts'

const run = (over: Partial<NotifiableRun> = {}): NotifiableRun => ({
  projectId: 'cezar-pwa',
  id: 'a1b2c3d4',
  title: 'Add the settings screen',
  status: 'waiting',
  ...over,
})

describe('isEntering', () => {
  /**
   * The clauses of upstream's `diffRunTransitions` (`web/src/lib/notifications.test.ts` @
   * `v0.11.0`), one row each.
   */
  const rows: [string, RunStatus | undefined, Partial<NotifiableRun>, boolean][] = [
    ['first sight never notifies, whatever the status', undefined, { status: 'waiting' }, false],
    ['first sight of a failed run is silent too', undefined, { status: 'failed' }, false],
    ['an unchanged status never notifies', 'waiting', { status: 'waiting' }, false],
    ['running → waiting notifies', 'running', { status: 'waiting' }, true],
    ['running → review notifies', 'running', { status: 'review' }, true],
    ['running → failed notifies', 'running', { status: 'failed' }, true],
    ['waiting → failed is news, and notifies', 'waiting', { status: 'failed' }, true],
    ['review → waiting notifies (a continued run asks again)', 'review', { status: 'waiting' }, true],
    ['running → done does not (no human needed)', 'running', { status: 'done' }, false],
    ['waiting → running does not', 'waiting', { status: 'running' }, false],
    ['queued → running does not', 'queued', { status: 'running' }, false],
    ['running → cancelled does not', 'running', { status: 'cancelled' }, false],
    [
      'running → failed with a booked auto-resume is scheduled, not an error',
      'running',
      { status: 'failed', autoResumeAt: '2026-09-21T12:00:00.000Z' },
      false,
    ],
    ['an unknown status is not attention', 'running', { status: 'paused' as RunStatus }, false],
  ]

  it.each(rows)('%s', (_name, before, over, expected) => {
    expect(isEntering(before, run(over))).toBe(expected)
  })
})

describe('runKey', () => {
  it('keys by project, since run ids are only unique within one', () => {
    expect(runKey('cezar-pwa', 'a1')).not.toBe(runKey('kai-phone', 'a1'))
    expect(runKey('cezar-pwa', 'a1')).toBe('cezar-pwa/a1')
  })
})

describe('notificationTitle', () => {
  it('prefers the summary', () => {
    expect(notificationTitle({ title: 'raw prompt', titleSummary: 'Summary' })).toBe('Summary')
  })

  it('falls back to the title when the summary is blank', () => {
    expect(notificationTitle({ title: 'raw prompt', titleSummary: '  ' })).toBe('raw prompt')
  })

  it('keeps only the first non-empty line, whitespace collapsed', () => {
    const title = '\n  Fix   the\tlist  \n```ts\nconst secret = 1\n```'
    expect(notificationTitle({ title })).toBe('Fix the list')
  })

  it('cuts a long line to the limit, with an ellipsis', () => {
    const title = notificationTitle({ title: 'word '.repeat(60) })
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH)
    expect(title.endsWith('…')).toBe(true)
  })
})

describe('attentionPayload', () => {
  it('says which task, which project and why — and nothing else (FR-038, FR-043)', () => {
    const payload = attentionPayload(
      run({ status: 'review', titleSummary: 'Settings screen', title: 'long prompt' }),
      'Cezar PWA',
    )
    expect(payload).toEqual({
      kind: 'attention',
      projectId: 'cezar-pwa',
      projectName: 'Cezar PWA',
      runId: 'a1b2c3d4',
      title: 'Settings screen',
      reason: 'needs review',
    })
  })

  it('names the project by its id when the name is unknown', () => {
    expect(attentionPayload(run({ status: 'failed' })).projectName).toBe('cezar-pwa')
  })

  it('does not copy any other field of the record', () => {
    const record = { ...run(), prompt: 'secret code', lastMessage: 'transcript' } as NotifiableRun
    expect(JSON.stringify(attentionPayload(record))).not.toMatch(/secret code|transcript/)
  })
})
