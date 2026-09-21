import type { ApiRun } from '@cezar-pwa/cezar-contract/contract'
import { describe, expect, it } from 'vitest'
import {
  compactTokens,
  diffPath,
  prLink,
  runPath,
  runnerModel,
  stepProgress,
  tokenSummary,
  workflowLabel,
} from './run-header.ts'

type Step = ApiRun['steps'][number]
const stepOf = (id: string, status: Step['status'], kind: Step['kind'] = 'agent'): Step => ({
  id,
  name: `Step ${id}`,
  kind,
  status,
  iterations: 1,
  tokensUsed: 0,
})

describe('workflowLabel', () => {
  it.each([
    ['quick-task', [], 'quick-task'],
    ['(planned)', [stepOf('c', 'done', 'check'), stepOf('a', 'done')], 'Step a'],
    ['(inbox)', [], '(inbox)'],
  ] as const)('%s', (workflow, steps, expected) => {
    expect(workflowLabel({ workflow, steps: [...steps] })).toBe(expected)
  })
})

describe('stepProgress', () => {
  it('names the current step', () => {
    expect(
      stepProgress({ currentStepId: 'b', steps: [stepOf('a', 'done'), stepOf('b', 'running'), stepOf('c', 'pending')] }),
    ).toEqual({ position: 2, total: 3, name: 'Step b' })
  })

  it('falls back to the last step that started once the run clears currentStepId', () => {
    expect(stepProgress({ steps: [stepOf('a', 'done'), stepOf('b', 'failed'), stepOf('c', 'pending')] })).toEqual({
      position: 2,
      total: 3,
      name: 'Step b',
    })
  })

  it('starts at the first step before anything ran, and says nothing for a single step', () => {
    expect(stepProgress({ steps: [stepOf('a', 'pending'), stepOf('b', 'pending')] })?.position).toBe(1)
    expect(stepProgress({ steps: [stepOf('a', 'done')] })).toBeNull()
    expect(stepProgress({ steps: undefined as unknown as Step[] })).toBeNull()
  })
})

describe('runnerModel', () => {
  it.each([
    [{ runner: 'claude' as const, model: 'claude-opus-5' }, 'claude · claude-opus-5'],
    [{ runner: 'codex' as const }, 'codex'],
    [{ model: 'm' }, 'm'],
    [{}, ''],
  ])('%j', (run, expected) => {
    expect(runnerModel(run)).toBe(expected)
  })
})

describe('compactTokens', () => {
  it.each([
    [0, '0'],
    [-5, '0'],
    [812, '812'],
    [96_250, '96.2k'],
    [999_999, '999.9k'],
    [1_450_000, '1.4M'],
  ])('%d → %s', (tokens, expected) => {
    expect(compactTokens(tokens)).toBe(expected)
  })
})

describe('tokenSummary', () => {
  it('prefers directional counts, falls back to the total, and says nothing for nothing', () => {
    expect(tokenSummary({ tokensUsed: 5000, inputTokens: 1200, outputTokens: 300 })).toEqual({
      kind: 'directional',
      input: '1.2k',
      output: '300',
    })
    expect(tokenSummary({ tokensUsed: 73_452 })).toEqual({ kind: 'total', total: '73.4k' })
    expect(tokenSummary({ tokensUsed: 0, inputTokens: 0, outputTokens: 0 })).toBeNull()
  })
})

describe('prLink', () => {
  it('links the PR the task created before the one it is about', () => {
    expect(
      prLink({
        pullRequestUrl: 'https://github.com/o/r/pull/7',
        referencedPullRequestUrl: 'https://github.com/o/r/pull/3',
      }),
    ).toEqual({ url: 'https://github.com/o/r/pull/7', number: '7' })
    expect(prLink({ referencedPullRequestUrl: 'https://github.com/o/r/pull/3' })?.number).toBe('3')
  })

  it('adopts no stray PR for an issue-subject run, and links only http(s)', () => {
    expect(prLink({ referencedPullRequestUrl: 'https://github.com/o/r/pull/3', markerRefs: { issue: 9 } })).toBeNull()
    expect(prLink({ pullRequestUrl: 'javascript:alert(1)' })).toBeNull()
    expect(prLink({ pullRequestUrl: 'https://gitlab.example/o/r/-/merge_requests/x' })?.number).toBeNull()
  })
})

describe('runPath', () => {
  it('encodes the ids', () => {
    expect(runPath('cezar-pwa', 'e5eb57e0')).toBe('/p/cezar-pwa/runs/e5eb57e0')
    expect(runPath('a b', 'x/y')).toBe('/p/a%20b/runs/x%2Fy')
  })
})

describe('diffPath', () => {
  it('sits under the task path', () => {
    expect(diffPath('a b', 'x/y')).toBe('/p/a%20b/runs/x%2Fy/diff')
  })
})
