import type { RunIndexEntry, RunsIndexResponse } from '@cezar-pwa/cezar-contract/contract'
import { describe, expect, it } from 'vitest'
import fixture from '../../test/fixtures/runs-index.json'
import { readAllPlan } from './read-all.ts'
import { buildTaskList } from './task-list.ts'

const runs = (fixture as RunsIndexResponse).runs

const entry = (over: Partial<RunIndexEntry> = {}): RunIndexEntry => ({
  projectId: 'p',
  id: 'r',
  title: 'A task',
  status: 'done',
  createdAt: '2026-09-21T10:00:00.000Z',
  finishedAt: '2026-09-21T10:30:00.000Z',
  archived: false,
  workflow: 'quick-task',
  ...over,
})

const plan = (list: readonly RunIndexEntry[], filter: string | null) => readAllPlan(buildTaskList(list, filter))

describe('readAllPlan', () => {
  // The fixture's unread rows: `run-failed` (cezar-pwa) and `run-done-unread` (kai-phone). `notes`
  // has a scheduled failure and a cancelled run — neither is ever unread — so it is never called.
  const cases: [string, string | null, string[], number][] = [
    ['all projects: every project with an unread row, in list order', null, ['cezar-pwa', 'kai-phone'], 2],
    ['filtered to one project: only that project', 'kai-phone', ['kai-phone'], 1],
    ['filtered to the other: only that project', 'cezar-pwa', ['cezar-pwa'], 1],
    ['a project with nothing unread in view: no call at all', 'notes', [], 0],
    ['an unknown filter shows nothing, so calls nothing', 'gone', [], 0],
  ]

  it.each(cases)('%s', (_name, filter, projects, unread) => {
    expect(plan(runs, filter)).toEqual({ projects, unread })
  })

  it('calls a project once however many of its rows are unread', () => {
    const list = [entry({ id: 'a' }), entry({ id: 'b', status: 'failed' }), entry({ id: 'c', projectId: 'q' })]
    expect(plan(list, null)).toEqual({ projects: ['p', 'q'], unread: 3 })
  })

  it('does not call a project for rows the list hides or that cannot be unread', () => {
    const list = [
      entry({ projectId: 'archived', archived: true }),
      entry({ projectId: 'seen', seenAt: '2026-09-21T10:31:00.000Z' }),
      entry({ projectId: 'cancelled', status: 'cancelled' }),
      entry({ projectId: 'scheduled', status: 'failed', autoResumeAt: '2026-09-21T12:00:00.000Z' }),
      entry({ projectId: 'live', status: 'running', finishedAt: undefined }),
    ]
    expect(plan(list, null)).toEqual({ projects: [], unread: 0 })
  })

  it('calls again for a run that finished after it was last read', () => {
    const list = [entry({ seenAt: '2026-09-21T10:00:00.000Z', finishedAt: '2026-09-21T11:00:00.000Z' })]
    expect(plan(list, null)).toEqual({ projects: ['p'], unread: 1 })
  })
})
