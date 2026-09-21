import type { RunEvent } from '@cezar-pwa/cezar-contract/contract'
import type { UiAskQuestion } from '@cezar-pwa/cezar-contract/protocol'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/http.ts'
import {
  type DeliveryRun,
  IDLE_TEARDOWN_RETRY_DELAYS_MS,
  combineAnswers,
  composerOpen,
  deliveryMode,
  formatAnswer,
  isOneTap,
  isRunActive,
  lastSessionId,
  openAsk,
  resumeAfterIdleTeardown,
  toggleSelection,
} from './answer.ts'
import { reduceTranscript } from './transcript.ts'

const step = (sessionId?: string) =>
  ({ id: 'task', name: 'Task', kind: 'agent', status: 'done', iterations: 1, tokensUsed: 0, ...(sessionId ? { sessionId } : {}) }) as DeliveryRun['steps'][number]

const run = (status: string, ...sessions: (string | undefined)[]): DeliveryRun =>
  ({ status, steps: sessions.map(step) }) as DeliveryRun

const branch: UiAskQuestion = {
  header: 'Branch',
  question: 'Which branch?',
  options: [{ label: 'main' }, { label: 'dev' }],
}
const checks: UiAskQuestion = {
  header: 'Checks',
  question: 'Which checks?',
  multiSelect: true,
  options: [{ label: 'lint' }, { label: 'test' }, { label: 'e2e' }],
}

const ev = (seq: number, type: string, fields: Record<string, unknown> = {}) =>
  ({ seq, ts: `2026-09-21T08:00:${String(seq).padStart(2, '0')}.000Z`, type, ...fields }) as RunEvent

describe('isRunActive — upstream run-actions.ts', () => {
  it.each([
    ['running', true],
    ['queued', true],
    ['waiting', true],
    ['review', false],
    ['done', false],
    ['failed', false],
    ['cancelled', false],
    ['some-future-status', false],
  ])('%s → %s', (status, active) => {
    expect(isRunActive(status)).toBe(active)
  })
})

describe('lastSessionId', () => {
  it('takes the latest step that recorded a session', () => {
    expect(lastSessionId(run('done', 's-1', 's-2', undefined))).toBe('s-2')
  })
  it('is undefined when no step did, or the steps are missing', () => {
    expect(lastSessionId(run('done', undefined))).toBeUndefined()
    expect(lastSessionId({ status: 'done' } as DeliveryRun)).toBeUndefined()
  })
})

describe('deliveryMode — upstream askDeliveryMode', () => {
  it.each([
    ['running', ['s-1'], 'live'],
    ['waiting', ['s-1'], 'live'],
    // Not started yet: the message is folded into the prompt, no session needed.
    ['queued', [], 'live'],
    ['review', ['s-1'], 'resume'],
    ['done', ['s-1'], 'resume'],
    ['failed', ['s-1'], 'resume'],
    ['cancelled', ['s-1'], 'resume'],
    ['done', [], 'unavailable'],
    ['failed', [undefined], 'unavailable'],
  ] as const)('%s with sessions %j → %s', (status, sessions, mode) => {
    expect(deliveryMode(run(status, ...sessions))).toBe(mode)
  })
})

describe('composerOpen (FR-023)', () => {
  const ask = { kind: 'ask' as const, id: 'a', questions: [branch], resolved: false }
  it.each([
    ['running', ['s-1'], false, true],
    ['waiting', ['s-1'], false, true],
    ['queued', [], false, true],
    // Plain "continue this task" is S-08's action, not a message.
    ['done', ['s-1'], false, false],
    ['review', ['s-1'], false, false],
    // A question outlives its session: answering it in your own words reopens it.
    ['done', ['s-1'], true, true],
    ['done', [], true, false],
  ] as const)('%s, sessions %j, open ask %s → %s', (status, sessions, withAsk, open) => {
    expect(composerOpen(run(status, ...sessions), withAsk ? ask : undefined)).toBe(open)
  })
})

describe('openAsk', () => {
  const asked = (seq: number, id: string) =>
    ev(seq, 'ask.requested', { requestId: id, questions: [branch] })

  it('is the newest question while it is unanswered', () => {
    const transcript = reduceTranscript([ev(1, 'turn.started', { turnId: 't' }), asked(2, 'ask-1')])
    expect(openAsk(transcript)?.id).toBe('ask-1')
  })

  it('is nothing once the next message answered it', () => {
    const transcript = reduceTranscript([asked(1, 'ask-1'), ev(2, 'user-message', { text: 'Branch: dev' })])
    expect(openAsk(transcript)).toBeUndefined()
  })

  it('is only the newest when two were asked: the older one can never resolve', () => {
    const transcript = reduceTranscript([asked(1, 'ask-1'), asked(2, 'ask-2')])
    expect(openAsk(transcript)?.id).toBe('ask-2')
  })

  it('is nothing when the newest was answered, whatever came before', () => {
    const transcript = reduceTranscript([
      asked(1, 'ask-1'),
      asked(2, 'ask-2'),
      ev(3, 'user-message', { text: 'x' }),
    ])
    expect(openAsk(transcript)).toBeUndefined()
  })

  it('is nothing in a transcript without questions', () => {
    expect(openAsk(reduceTranscript([]))).toBeUndefined()
  })
})

describe('the answer the agent reads — upstream formatAnswer', () => {
  it('is "header: labels"', () => {
    expect(formatAnswer(branch, ['dev'])).toBe('Branch: dev')
    expect(formatAnswer(checks, ['lint', 'e2e'])).toBe('Checks: lint, e2e')
  })

  it('combines every question into one message, one per line', () => {
    expect(combineAnswers([branch, checks], { 0: ['main'], 1: ['test'] })).toBe('Branch: main\nChecks: test')
  })
})

describe('isOneTap', () => {
  it.each([
    [[branch], true],
    [[checks], false],
    [[branch, branch], false],
  ] as const)('%#', (questions, oneTap) => {
    expect(isOneTap(questions)).toBe(oneTap)
  })
})

describe('toggleSelection', () => {
  it('replaces for single-select', () => {
    expect(toggleSelection(['main'], 'dev', false)).toEqual(['dev'])
  })
  it('toggles for multi-select', () => {
    expect(toggleSelection(['lint'], 'test', true)).toEqual(['lint', 'test'])
    expect(toggleSelection(['lint', 'test'], 'lint', true)).toEqual(['test'])
  })
})

describe('resumeAfterIdleTeardown', () => {
  const wait = vi.fn(async (_delayMs: number) => undefined)

  it('retries only "run is still active", then succeeds', async () => {
    const resume = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ApiError('run is still active', 409))
      .mockRejectedValueOnce(new ApiError('run is still active', 409))
      .mockResolvedValue('ok')
    await expect(resumeAfterIdleTeardown(resume, wait)).resolves.toBe('ok')
    expect(resume).toHaveBeenCalledTimes(3)
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([50, 100])
  })

  it('gives up after the schedule and surfaces the refusal', async () => {
    wait.mockClear()
    const resume = vi.fn(async () => {
      throw new ApiError('run is still active', 409)
    })
    await expect(resumeAfterIdleTeardown(resume, wait)).rejects.toThrow('run is still active')
    expect(resume).toHaveBeenCalledTimes(IDLE_TEARDOWN_RETRY_DELAYS_MS.length + 1)
  })

  it('never retries any other refusal', async () => {
    const resume = vi.fn(async () => {
      throw new ApiError('provider claude is not connected', 409)
    })
    await expect(resumeAfterIdleTeardown(resume, wait)).rejects.toThrow('provider claude')
    expect(resume).toHaveBeenCalledTimes(1)
  })
})
