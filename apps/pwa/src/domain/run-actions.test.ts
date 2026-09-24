import { describe, expect, it } from 'vitest'
import { type ActionRun, type RunActionFlags, runActionFlags } from './run-actions.ts'

const session: ActionRun['steps'] = [{ id: 'task', name: 'Task', kind: 'agent', status: 'done', iterations: 1, tokensUsed: 1, sessionId: 's-1' }]
const noSession: ActionRun['steps'] = [{ id: 'task', name: 'Task', kind: 'agent', status: 'done', iterations: 1, tokensUsed: 1 }]

const run = (status: string, extra: Partial<ActionRun> = {}): ActionRun =>
  ({ status, steps: session, archived: false, ...extra }) as ActionRun

const none: RunActionFlags = { cancel: false, finish: false, draftPr: false, continueRun: false, pin: false, archive: false, cancelAutoResume: false }
const flags = (on: Partial<RunActionFlags>): RunActionFlags => ({ ...none, ...on })

describe('runActionFlags (upstream runActionFlags + the review panel)', () => {
  it.each<[string, ActionRun, RunActionFlags]>([
    // Active: the engine owns it. Cancel, pin, and nothing that would race the engine.
    ['running', run('running'), flags({ cancel: true, pin: true })],
    ['queued', run('queued'), flags({ cancel: true, pin: true })],
    ['waiting', run('waiting'), flags({ cancel: true, finish: true, pin: true })],
    // The review gate: accept, draft a PR, continue, pin, archive. Never cancel.
    ['review', run('review'), flags({ finish: true, draftPr: true, continueRun: true, pin: true, archive: true })],
    ['done', run('done'), flags({ continueRun: true, pin: true, archive: true })],
    ['failed', run('failed'), flags({ continueRun: true, pin: true, archive: true })],
    ['cancelled', run('cancelled'), flags({ continueRun: true, pin: true, archive: true })],
    // An unknown status is not active, like upstream: it can be archived.
    ['unknown status', run('paused'), flags({ continueRun: true, pin: true, archive: true })],
  ])('%s', (_name, input, expected) => {
    expect(runActionFlags(input)).toEqual(expected)
  })

  it('offers no continue without a recorded session', () => {
    expect(runActionFlags(run('done', { steps: noSession })).continueRun).toBe(false)
    expect(runActionFlags(run('failed', { steps: [] })).continueRun).toBe(false)
  })

  it('offers no draft PR once one is known, so a second tap cannot open a duplicate', () => {
    expect(runActionFlags(run('review', { pullRequestUrl: 'https://github.com/o/r/pull/7' })).draftPr).toBe(false)
    // A value that is not a web link does not count as a PR (upstream `isHttpUrl`).
    expect(runActionFlags(run('review', { pullRequestUrl: 'javascript:alert(1)' })).draftPr).toBe(true)
  })

  it.each<[string, ActionRun, boolean]>([
    ['failed with a booked resume', run('failed', { autoResumeAt: '2026-09-24T12:00:00.000Z' }), true],
    ['failed without one', run('failed'), false],
    // `autoResumeAt` only means "scheduled" on a failed run (`isScheduled`); anywhere else it is stale.
    ['done with a leftover autoResumeAt', run('done', { autoResumeAt: '2026-09-24T12:00:00.000Z' }), false],
    ['running with a leftover autoResumeAt', run('running', { autoResumeAt: '2026-09-24T12:00:00.000Z' }), false],
    ['cancelled with a leftover autoResumeAt', run('cancelled', { autoResumeAt: '2026-09-24T12:00:00.000Z' }), false],
  ])('cancel auto-resume (FR-030): %s', (_name, input, expected) => {
    expect(runActionFlags(input).cancelAutoResume).toBe(expected)
  })

  it('a scheduled task keeps its other failed-task actions', () => {
    expect(runActionFlags(run('failed', { autoResumeAt: '2026-09-24T12:00:00.000Z' }))).toEqual(
      flags({ continueRun: true, pin: true, archive: true, cancelAutoResume: true }),
    )
  })

  it('offers no pin on an archived run: archiving retires the pin', () => {
    expect(runActionFlags(run('done', { archived: true })).pin).toBe(false)
    expect(runActionFlags(run('done', { archived: true })).archive).toBe(true)
  })
})
