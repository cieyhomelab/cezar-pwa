import type { RunIndexEntry, RunRecord, RunsIndexResponse } from '@cezar-pwa/cezar-contract/contract'
import { describe, expect, it } from 'vitest'
import fixture from '../../test/fixtures/runs-index.json'
import { applyWorkspaceFrame, lastActivityAt, toIndexEntry, type WorkspaceFrame } from './live-index.ts'

const index = fixture as RunsIndexResponse

/** A `run` frame as the server sends it: the whole record, stamped with `project`. */
const runFrame = (row: RunIndexEntry, over: Partial<RunRecord> = {}): WorkspaceFrame => {
  const { projectId, usage: _usage, ...rest } = row
  return {
    type: 'run',
    data: { ...rest, task: 'the prompt', steps: [], tokensUsed: 0, ...over, project: projectId },
  }
}

/** The 0.17.0 workspace frame (Cezar #1190): the record minus `WORKSPACE_RUN_EVENT_OMITTED_KEYS`. */
const slimFrame = (row: RunIndexEntry, over: Partial<RunRecord> = {}): WorkspaceFrame => {
  const { projectId, usage: _usage, lastActivityAt: _derived, ...rest } = row
  return { type: 'run', data: { ...rest, tokensUsed: 0, ...over, project: projectId } }
}

const find = (result: RunsIndexResponse, projectId: string, id: string) =>
  result.runs.find((row) => row.projectId === projectId && row.id === id)

describe('applyWorkspaceFrame', () => {
  const running = index.runs.find((row) => row.status === 'running')!

  it('moves a changed status into the cached row', () => {
    const result = applyWorkspaceFrame(index, runFrame(running, { status: 'waiting' }))
    expect(find(result, running.projectId, running.id)?.status).toBe('waiting')
    expect(result.runs).toHaveLength(index.runs.length)
    // Nothing else in the answer is touched.
    expect(result.truncated).toBe(index.truncated)
  })

  it('drops record-only fields: the row is what runs-index would have served', () => {
    const result = applyWorkspaceFrame(index, runFrame(running, { status: 'review' }))
    const row = find(result, running.projectId, running.id) as Record<string, unknown>
    expect(row).not.toHaveProperty('task')
    expect(row).not.toHaveProperty('steps')
    expect(row).not.toHaveProperty('project')
    expect(row.projectId).toBe(running.projectId)
  })

  it('keeps the last live usage sample, which only the index answer carries', () => {
    const withUsage = { ...index, runs: [{ ...running, usage: { cpuPct: 5, rssBytes: 1, procCount: 1 } }] }
    const result = applyWorkspaceFrame(withUsage, runFrame(running, { costUsd: 99 }))
    expect(result.runs[0].usage).toEqual({ cpuPct: 5, rssBytes: 1, procCount: 1 })
    expect(result.runs[0].costUsd).toBe(99)
  })

  it('clears a field the record no longer has', () => {
    const scheduled = index.runs.find((row) => row.autoResumeAt !== undefined)!
    const { autoResumeAt: _gone, ...resumed } = scheduled
    const result = applyWorkspaceFrame(index, runFrame(resumed as RunIndexEntry, { status: 'running' }))
    expect(find(result, scheduled.projectId, scheduled.id)).not.toHaveProperty('autoResumeAt')
  })

  it('adds a task it has never seen', () => {
    const fresh = { ...running, id: 'run-brand-new', status: 'queued' } as RunIndexEntry
    const result = applyWorkspaceFrame(index, runFrame(fresh))
    expect(result.runs).toHaveLength(index.runs.length + 1)
    expect(find(result, running.projectId, 'run-brand-new')?.status).toBe('queued')
  })

  it('tells the same id in two projects apart', () => {
    const twin = { ...running, projectId: 'another-project' }
    const result = applyWorkspaceFrame(index, runFrame(twin, { status: 'done' }))
    expect(find(result, running.projectId, running.id)?.status).toBe('running')
    expect(find(result, 'another-project', running.id)?.status).toBe('done')
  })

  it('returns the same object when a record changes nothing the row shows', () => {
    // A running task sends a record every turn; the list must not re-render for each.
    expect(applyWorkspaceFrame(index, runFrame(running, { tokensUsed: 12_345 }))).toBe(index)
  })

  it('passes a status it has never heard of through, as itself', () => {
    const result = applyWorkspaceFrame(
      index,
      runFrame(running, { status: 'paused' as RunRecord['status'] }),
    )
    expect(find(result, running.projectId, running.id)?.status).toBe('paused')
  })

  it('removes a deleted task', () => {
    const result = applyWorkspaceFrame(index, {
      type: 'run-deleted',
      data: { id: running.id, project: running.projectId },
    })
    expect(find(result, running.projectId, running.id)).toBeUndefined()
    expect(result.runs).toHaveLength(index.runs.length - 1)
  })

  const ignored: [string, WorkspaceFrame][] = [
    ['an unknown frame type', { type: 'something-new', data: { id: running.id } }],
    ['a ping', { type: 'ping', data: '' }],
    ['usage ticks (the row shows none)', { type: 'usage', data: { project: 'p', usage: {} } }],
    ['a run frame with no project stamp', { type: 'run', data: { ...running, projectId: undefined } }],
    ['a run frame that is not an object', { type: 'run', data: 'garbage' }],
    ['a run frame with no status', { type: 'run', data: { id: 'x', project: 'p', title: 't', createdAt: 'c' } }],
    ['a deletion of something not in the list', { type: 'run-deleted', data: { id: 'nope', project: 'p' } }],
    ['a deletion with no project', { type: 'run-deleted', data: { id: running.id } }],
    ['null data', { type: 'run', data: null }],
  ]
  it.each(ignored)('ignores %s without throwing', (_name, frame) => {
    expect(applyWorkspaceFrame(index, frame)).toBe(index)
  })
})

describe('applyWorkspaceFrame, slim 0.17.0 frames', () => {
  const continued: RunIndexEntry = {
    projectId: 'p',
    id: 'r-continued',
    title: 'Continued',
    status: 'running',
    createdAt: '2026-10-21T10:00:00.000Z',
    startedAt: '2026-10-21T10:00:05.000Z',
    // A Continue launched a new step at noon: the server's index sorted on it.
    lastActivityAt: '2026-10-21T12:00:00.000Z',
    archived: false,
    workflow: 'quick-task',
  }
  const base: RunsIndexResponse = { ...index, runs: [continued] }

  it.each<[string, RunsIndexResponse, WorkspaceFrame, string]>([
    [
      'a continued run keeps its later instant',
      base,
      slimFrame(continued, { activity: 'monitoring' }),
      '2026-10-21T12:00:00.000Z',
    ],
    [
      'a newer finish on the frame still wins',
      base,
      slimFrame(continued, { status: 'done', finishedAt: '2026-10-21T13:00:00.000Z' }),
      '2026-10-21T13:00:00.000Z',
    ],
    [
      'a new run without steps gets its startedAt',
      { ...index, runs: [] },
      slimFrame(continued),
      '2026-10-21T10:00:05.000Z',
    ],
    [
      'a new queued run without steps gets its createdAt',
      { ...index, runs: [] },
      slimFrame({ ...continued, status: 'queued', startedAt: undefined } as RunIndexEntry),
      '2026-10-21T10:00:00.000Z',
    ],
    [
      'a full record is taken as-is, even when earlier',
      base,
      runFrame(continued, { steps: [] }),
      '2026-10-21T10:00:05.000Z',
    ],
  ])('%s', (_name, start, frame, expected) => {
    const result = applyWorkspaceFrame(start, frame)
    expect(find(result, 'p', 'r-continued')?.lastActivityAt).toBe(expected)
  })

  it('returns the same object when a slim frame changes nothing the row shows', () => {
    expect(applyWorkspaceFrame(base, slimFrame(continued))).toBe(base)
  })
})

describe('toIndexEntry', () => {
  it('carries exactly the fields of the server projection', () => {
    const record = {
      id: 'r1',
      title: 'Title',
      titleSummary: 'summary',
      titleOrigin: 'auto',
      workflow: 'quick-task',
      task: 'prompt text',
      status: 'running',
      activity: 'monitoring',
      createdAt: '2026-09-21T10:00:00.000Z',
      startedAt: '2026-09-21T10:00:01.000Z',
      archived: false,
      tokensUsed: 10,
      branch: 'cez/r1',
      worktreePath: '/somewhere',
      dispatch: { rootRunId: 'root', parentRunId: 'parent', kind: 'review', depth: 1 },
      prNumber: 7,
      costUsd: 1.5,
      steps: [],
    } as unknown as RunRecord
    expect(toIndexEntry('p', record)).toEqual({
      projectId: 'p',
      id: 'r1',
      title: 'Title',
      titleSummary: 'summary',
      titleOrigin: 'auto',
      status: 'running',
      activity: 'monitoring',
      createdAt: '2026-09-21T10:00:00.000Z',
      startedAt: '2026-09-21T10:00:01.000Z',
      lastActivityAt: '2026-09-21T10:00:01.000Z',
      archived: false,
      workflow: 'quick-task',
      branch: 'cez/r1',
      dispatch: { rootRunId: 'root', parentRunId: 'parent', kind: 'review' },
      prNumber: 7,
      costUsd: 1.5,
    })
  })

  it('carries the worktree lifecycle and the automation, as the 0.16.2 server does', () => {
    const worktreeLifecycle = { worktreeId: 'w', generation: 2, phase: 'teardown', needsAttention: true }
    const record = {
      id: 'r2',
      title: 'Title',
      workflow: 'quick-task',
      status: 'done',
      createdAt: '2026-10-21T10:00:00.000Z',
      finishedAt: '2026-10-21T11:00:00.000Z',
      archived: false,
      worktreeLifecycle,
      automationTrigger: { automationId: 'auto-1' },
      steps: [],
    } as unknown as RunRecord
    expect(toIndexEntry('p', record)).toMatchObject({
      worktreeLifecycle,
      automationId: 'auto-1',
      lastActivityAt: '2026-10-21T11:00:00.000Z',
    })
  })
})

describe('toIndexEntry, 0.17.0', () => {
  it('leaves out the automation while a deferred binding is pending', () => {
    const record = {
      id: 'r3',
      title: 'Title',
      workflow: 'quick-task',
      status: 'queued',
      createdAt: '2026-10-21T10:00:00.000Z',
      archived: false,
      automationTrigger: { automationId: 'auto-1' },
      deferredBinding: { revision: 'rev-1', runner: 'claude', accounts: [] },
      steps: [],
    } as unknown as RunRecord
    expect(toIndexEntry('p', record)).not.toHaveProperty('automationId')
  })
})

describe('lastActivityAt', () => {
  const run = { createdAt: '2026-10-21T10:00:00.000Z' }
  it.each([
    ['only created', run, '2026-10-21T10:00:00.000Z'],
    ['started', { ...run, startedAt: '2026-10-21T10:00:05Z' }, '2026-10-21T10:00:05Z'],
    [
      'finished wins over started',
      { ...run, startedAt: '2026-10-21T10:00:05Z', finishedAt: '2026-10-21T10:30:00Z' },
      '2026-10-21T10:30:00Z',
    ],
    [
      'a newer step (a Continue) wins',
      {
        ...run,
        startedAt: '2026-10-21T10:00:05Z',
        steps: [{ startedAt: '2026-10-21T10:01:00Z', finishedAt: '2026-10-21T10:02:00Z' }, { startedAt: '2026-10-21T12:00:00Z' }],
      },
      '2026-10-21T12:00:00Z',
    ],
    [
      'compares instants, not text, within one second',
      { ...run, startedAt: '2026-10-21T10:00:05.500Z', steps: [{ finishedAt: '2026-10-21T10:00:05Z' }] },
      '2026-10-21T10:00:05.500Z',
    ],
  ])('%s', (_name, input, expected) => {
    expect(lastActivityAt(input)).toBe(expected)
  })
})
