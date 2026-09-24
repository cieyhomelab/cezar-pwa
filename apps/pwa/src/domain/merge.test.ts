import type { GithubPrMergeState } from '@cezar-pwa/cezar-contract/contract'
import { describe, expect, it } from 'vitest'
import liveMerged from '../../test/fixtures/merge-state.live-0.11.1.json'
import blockedFixture from '../../test/fixtures/merge-state.json'
import { mergeGate, mergeHeadline, mergePanelState, mergeView, samePullRequest, selectedMethod } from './merge.ts'

const PR_URL = 'https://github.com/o/r/pull/7'

/** An open PR the server judged ready; each case overrides what it is about. */
function state(extra: Partial<GithubPrMergeState> = {}): GithubPrMergeState {
  return {
    number: 7,
    title: 'feat: a thing',
    url: PR_URL,
    state: 'open',
    isDraft: false,
    headRef: 'feat/thing',
    baseRef: 'main',
    headSha: '0123456789abcdef0123456789abcdef01234567',
    mergeable: 'mergeable',
    reviewDecision: 'approved',
    checks: [{ name: 'test', state: 'passing', required: true }],
    methods: ['squash', 'merge'],
    defaultMethod: 'squash',
    eligibility: 'ready',
    blockers: [],
    canMerge: true,
    canOverride: false,
    ...extra,
  }
}

const view = (extra: Partial<GithubPrMergeState> = {}) => {
  const result = mergeView(state(extra))
  if (result === null) throw new Error('unreadable')
  return result
}

describe('mergeHeadline', () => {
  it.each([
    ['ready', {}, 'ready'],
    ['merged', { state: 'merged', canMerge: false, eligibility: 'terminal' }, 'merged'],
    ['closed', { state: 'closed', canMerge: false, eligibility: 'terminal' }, 'closed'],
    ['a draft, even with a failing check', { isDraft: true, canMerge: false, eligibility: 'blocked', checks: [{ name: 'a', state: 'failing', required: null }] }, 'draft'],
    ['conflicts', { mergeable: 'conflicting', canMerge: false, eligibility: 'blocked' }, 'conflicts'],
    ['a failing check', { canMerge: false, eligibility: 'blocked', checks: [{ name: 'a', state: 'failing', required: null }] }, 'failing'],
    ['a pending check', { canMerge: false, eligibility: 'pending', checks: [{ name: 'a', state: 'pending', required: null }] }, 'pending'],
    ['a pending check the server ranked after unknown rules', { canMerge: false, eligibility: 'unknown', checks: [{ name: 'a', state: 'pending', required: null }] }, 'pending'],
    ['a missing review', { canMerge: false, eligibility: 'blocked', reviewDecision: 'review-required' }, 'blocked'],
    ['a viewer who may not merge', { canMerge: false, eligibility: 'unauthorized' }, 'blocked'],
    ['rules GitHub would not show', { canMerge: false, eligibility: 'unknown', reviewDecision: 'unknown' }, 'unknown'],
    ['an eligibility this build does not know', { canMerge: false, eligibility: 'queued' as never }, 'unknown'],
  ] as const)('%s', (_name, extra, expected) => {
    expect(mergeHeadline(state(extra as Partial<GithubPrMergeState>))).toBe(expected)
  })
})

describe('mergeView', () => {
  it('orders checks failing, pending, unknown, passing, keeping the server order within each', () => {
    const result = view({
      checks: [
        { name: 'p1', state: 'passing', required: null },
        { name: 'x', state: 'failing', required: true },
        { name: 'u', state: 'unknown', required: null },
        { name: 'w', state: 'pending', required: false },
        { name: 'p2', state: 'passing', required: null },
      ],
    })
    expect(result.checks.map((check) => check.name)).toEqual(['x', 'w', 'u', 'p1', 'p2'])
    expect(result.counts).toEqual({ failing: 1, pending: 1, unknown: 1, passing: 2 })
  })

  it('reads a check state or method it does not know as unknown or not offered (rule 5)', () => {
    const result = mergeView({
      ...state(),
      checks: [{ name: 'new', state: 'skipped-by-policy', required: 'maybe' }],
      methods: ['squash', 'fast-forward'],
      defaultMethod: 'fast-forward',
    })
    expect(result?.checks).toEqual([{ name: 'new', state: 'unknown', required: null }])
    expect(result?.methods).toEqual(['squash'])
    expect(result?.defaultMethod).toBeNull()
  })

  it('links a check only to an http(s) address', () => {
    const result = view({
      checks: [
        { name: 'a', state: 'passing', required: null, url: 'javascript:alert(1)' },
        { name: 'b', state: 'passing', required: null, url: 'https://ci.example/b' },
      ],
    })
    expect(result.checks.map((check) => check.url)).toEqual([undefined, 'https://ci.example/b'])
  })

  it.each([
    ['not an object', null],
    ['no number', { ...state(), number: '7' }],
    ['no head', { ...state(), headSha: undefined }],
  ])('is null for an answer it cannot read: %s', (_name, raw) => {
    expect(mergeView(raw)).toBeNull()
  })

  it('never offers a merge the server did not: no method, or a closed PR claiming canMerge', () => {
    expect(view({ methods: [], defaultMethod: null }).canMerge).toBe(false)
    expect(view({ state: 'closed' }).canMerge).toBe(false)
    expect(view({ state: 'merged', canMerge: false, canOverride: true }).canOverride).toBe(false)
  })

  it('reads the live capture of a merged PR as terminal', () => {
    const panel = mergePanelState(liveMerged, 'https://github.com/cieyhomelab/cezar-pwa/pull/78')
    expect(panel.kind).toBe('state')
    if (panel.kind !== 'state') return
    expect(panel.view).toMatchObject({ headline: 'merged', terminal: true, canMerge: false, canOverride: false })
    expect(panel.view.counts.passing).toBe(3)
  })
})

describe('mergeGate — can merge, and the reason it cannot', () => {
  it.each([
    ['ready: merge', {}, false, { allowed: true, override: false }],
    ['ready: the override box changes nothing', {}, true, { allowed: true, override: false }],
    [
      'checks failing: the server says why',
      { canMerge: false, canOverride: true, eligibility: 'blocked', blockers: [{ code: 'checks-failing', message: 'One or more checks are failing.' }] },
      false,
      { allowed: false, reason: 'One or more checks are failing.' },
    ],
    [
      'checks failing, override ticked: merge asks GitHub to bypass',
      { canMerge: false, canOverride: true, eligibility: 'blocked', blockers: [{ code: 'checks-failing', message: 'One or more checks are failing.' }] },
      true,
      { allowed: true, override: true },
    ],
    [
      'rules unconfirmed (this repository on the host): only with the override',
      { canMerge: false, canOverride: true, eligibility: 'unknown', reviewDecision: 'unknown', blockers: [{ code: 'rules-unknown', message: 'GitHub could not confirm review and branch-protection requirements.' }] },
      false,
      { allowed: false, reason: 'GitHub could not confirm review and branch-protection requirements.' },
    ],
    [
      'a draft: no override either',
      { isDraft: true, canMerge: false, canOverride: false, eligibility: 'blocked', blockers: [{ code: 'draft', message: 'Mark the pull request ready for review before merging.' }] },
      true,
      { allowed: false, reason: 'Mark the pull request ready for review before merging.' },
    ],
    [
      'conflicts: the first blocker leads',
      { mergeable: 'conflicting', canMerge: false, canOverride: false, eligibility: 'blocked', blockers: [{ code: 'conflicts', message: 'Conflicts must be resolved before merging.' }, { code: 'x', message: 'second' }] },
      true,
      { allowed: false, reason: 'Conflicts must be resolved before merging.' },
    ],
    ['no method allowed by the repository', { methods: [], defaultMethod: null }, false, { allowed: false, reason: null }],
    ['merged', { state: 'merged', canMerge: false, eligibility: 'terminal', blockers: [{ code: 'terminal', message: 'This pull request is merged.' }] }, true, { allowed: false, reason: 'This pull request is merged.' }],
  ] as const)('%s', (_name, extra, override, expected) => {
    expect(mergeGate(view(extra as Partial<GithubPrMergeState>), override)).toEqual(expected)
  })

  it('the hand-written fixture: blocked by a failing check, bypassable', () => {
    const panel = mergePanelState(blockedFixture, PR_URL)
    if (panel.kind !== 'state') throw new Error(panel.kind)
    expect(panel.view.headline).toBe('failing')
    expect(mergeGate(panel.view, false)).toEqual({ allowed: false, reason: 'One or more checks are failing.' })
    expect(mergeGate(panel.view, true)).toEqual({ allowed: true, override: true })
  })
})

describe('mergePanelState', () => {
  it('passes the server reason through when the forge is unavailable', () => {
    expect(mergePanelState({ available: false, reason: 'gh: not logged in' }, PR_URL)).toEqual({
      kind: 'unavailable',
      reason: 'gh: not logged in',
    })
  })

  it.each([
    ['not an object', 'nope'],
    ['available with no state', { available: true }],
    ['no availability flag', { mergeState: state() }],
  ])('is unreadable: %s', (_name, response) => {
    expect(mergePanelState(response, PR_URL).kind).toBe('unreadable')
  })

  it('refuses an answer about a PR in another repository with the same number', () => {
    expect(mergePanelState({ available: true, mergeState: state() }, 'https://github.com/other/repo/pull/7').kind).toBe('other-pr')
  })
})

describe('samePullRequest', () => {
  it.each([
    [PR_URL, PR_URL, true],
    ['https://github.com/O/R/pull/7', 'https://github.com/o/r/pull/7/files', true],
    ['https://github.com/o/r/pull/7', 'https://github.com/o/r/pull/70', false],
    ['https://github.com/o/r/pull/7', 'https://github.com/o/s/pull/7', false],
    ['https://github.com/o/r/issues/7', 'https://github.com/o/r/issues/7', false],
    ['', PR_URL, false],
  ])('%s vs %s → %s', (a, b, expected) => {
    expect(samePullRequest(a, b)).toBe(expected)
  })
})

describe('selectedMethod', () => {
  it.each([
    ['nothing chosen: the repository default', undefined, { methods: ['merge', 'squash'], defaultMethod: 'squash' }, 'squash'],
    ['a choice still allowed', 'merge', { methods: ['merge', 'squash'], defaultMethod: 'squash' }, 'merge'],
    ['a choice no longer allowed falls back', 'rebase', { methods: ['merge', 'squash'], defaultMethod: 'squash' }, 'squash'],
    ['no default: the first allowed', undefined, { methods: ['rebase'], defaultMethod: null }, 'rebase'],
    ['nothing allowed', undefined, { methods: [], defaultMethod: null }, null],
  ] as const)('%s', (_name, chosen, from, expected) => {
    expect(selectedMethod({ methods: [...from.methods], defaultMethod: from.defaultMethod }, chosen)).toBe(expected)
  })
})
