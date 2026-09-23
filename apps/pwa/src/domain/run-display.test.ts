import { describe, expect, it } from 'vitest'
import {
  clockTime,
  formatCost,
  refPrefixMatches,
  runTiming,
  runTitle,
  shortAge,
  splitRefPrefix,
  taskReference,
} from './run-display.ts'

const NOW = new Date('2026-09-21T10:00:00.000Z').getTime()

describe('runTitle (cockpit copy)', () => {
  it.each([
    ['no summary → the title', { title: 'Raw' }, 'Raw'],
    ['a summary wins', { title: 'Raw', titleSummary: 'fixing the list' }, 'fixing the list'],
    [
      'a malformed auto summary falls back to the title',
      { title: 'Raw', titleSummary: 'Done.Next step', titleOrigin: 'auto' as const },
      'Raw',
    ],
    [
      'a user title is authoritative even when it looks malformed',
      { title: 'Raw', titleSummary: 'Done.Next step', titleOrigin: 'user' as const },
      'Done.Next step',
    ],
  ])('%s', (_name, run, expected) => {
    expect(runTitle(run)).toBe(expected)
  })
})

describe('ref prefix', () => {
  it('splits exactly the `NNN: ` shape', () => {
    expect(splitRefPrefix('79: correcting docs')).toEqual({ ref: 79, rest: 'correcting docs' })
    expect(splitRefPrefix('fix: the login bug')).toEqual({ ref: null, rest: 'fix: the login bug' })
  })

  it('only drops the prefix when the chip shows the same number', () => {
    expect(refPrefixMatches('79: correcting docs', 79)).toBe(true)
    expect(refPrefixMatches('788: correcting docs', 790)).toBe(false)
    expect(refPrefixMatches('79: correcting docs', undefined)).toBe(false)
  })
})

describe('taskReference (cockpit copy)', () => {
  it.each([
    ['nothing known', {}, undefined],
    ['the PR it created', { pullRequestUrl: 'https://github.com/o/r/pull/12' }, { kind: 'PR', number: 12 }],
    [
      'the created PR beats the one it is about',
      {
        pullRequestUrl: 'https://github.com/o/r/pull/12',
        referencedPullRequestUrl: 'https://github.com/o/r/pull/9',
      },
      { kind: 'PR', number: 12 },
    ],
    ['a bare PR number', { prNumber: 7 }, { kind: 'PR', number: 7 }],
    ['an issue number', { issueNumber: 21 }, { kind: 'Issue', number: 21 }],
    ['a PR beats an issue', { prNumber: 7, issueNumber: 21 }, { kind: 'PR', number: 7 }],
    [
      'an issue-subject run does not adopt a stray PR it merely mentioned (#526)',
      { referencedPullRequestUrl: 'https://github.com/x/y/pull/1', markerRefs: { issue: 524 } },
      { kind: 'Issue', number: 524 },
    ],
    [
      'an uncorroborated CEZ:PR declaration leads',
      { pullRequestUrl: 'https://github.com/other/repo/pull/3', markerRefs: { pr: 40 } },
      { kind: 'PR', number: 40 },
    ],
    [
      'a URL on a forge without a trailing number is skipped, not invented',
      { pullRequestUrl: 'https://forge.example/o/r/merge_requests/new' },
      undefined,
    ],
  ])('%s', (_name, run, expected) => {
    expect(taskReference(run)).toEqual(expected)
  })
})

describe('formatCost (cockpit copy)', () => {
  it.each([
    [undefined, ''],
    [0, ''],
    [0.421, '$0.42'],
    [9.999, '$10.00'],
    [12.8, '$13'],
  ])('%s → %j', (usd, expected) => {
    expect(formatCost(usd)).toBe(expected)
  })
})

describe('shortAge', () => {
  it.each([
    ['2026-09-21T09:59:56.000Z', '4 s'],
    ['2026-09-21T09:34:00.000Z', '26 min'],
    ['2026-09-21T07:30:00.000Z', '2 h'],
    ['2026-09-20T09:00:00.000Z', '1 day'],
    ['2026-09-18T09:00:00.000Z', '3 days'],
    ['2026-09-21T10:00:30.000Z', '0 s'],
    [undefined, ''],
    ['not a date', ''],
  ])('%s → %j', (iso, expected) => {
    expect(shortAge(iso, NOW)).toBe(expected)
  })
})

describe('clockTime', () => {
  it('prints the time alone for today, and a date in front otherwise', () => {
    const today = new Date(NOW)
    today.setHours(11, 40, 0, 0)
    expect(clockTime(today.toISOString(), NOW)).toBe('11:40')

    const tomorrow = new Date(today.getTime() + 86_400_000)
    expect(clockTime(tomorrow.toISOString(), NOW)).toMatch(/^\d{2}\/\d{2} 11:40$/)
  })

  it('prints nothing for a stamp it cannot read', () => {
    expect(clockTime('soon', NOW)).toBe('')
    expect(clockTime(undefined, NOW)).toBe('')
  })
})

describe('runTiming', () => {
  const base = { createdAt: '2026-09-21T09:00:00.000Z' }

  it('shows a queued run its place in line', () => {
    expect(runTiming({ ...base, status: 'queued' }, 2, NOW)).toEqual({ kind: 'queued', position: 2 })
  })

  it('shows a scheduled resume when it resumes', () => {
    const timing = runTiming(
      { ...base, status: 'failed', autoResumeAt: '2026-09-21T11:40:00.000Z', finishedAt: '2026-09-21T09:30:00.000Z' },
      null,
      NOW,
    )
    expect(timing.kind).toBe('scheduled')
  })

  it('shows live work how long it has been going, from when it started', () => {
    expect(
      runTiming({ ...base, status: 'running', startedAt: '2026-09-21T09:34:00.000Z' }, null, NOW),
    ).toEqual({ kind: 'since', age: '26 min' })
  })

  it('shows finished work how long ago it finished', () => {
    expect(
      runTiming({ ...base, status: 'done', finishedAt: '2026-09-21T07:30:00.000Z' }, null, NOW),
    ).toEqual({ kind: 'ago', age: '2 h' })
  })

  it('says nothing rather than something false when the stamps are unreadable', () => {
    expect(runTiming({ status: 'done', createdAt: 'garbage' }, null, NOW)).toEqual({ kind: 'none' })
  })
})
