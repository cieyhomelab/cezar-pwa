import type { RunIndexEntry, RunsIndexResponse } from '@cezar-pwa/cezar-contract/contract'
import { describe, expect, it } from 'vitest'
import fixture from '../../test/fixtures/runs-index.json'
import {
  attentionCount,
  buildTaskList,
  compareRuns,
  queuePositions,
  sectionOf,
  type SectionKey,
} from './task-list.ts'

const runs = (fixture as RunsIndexResponse).runs

const entry = (over: Partial<RunIndexEntry> = {}): RunIndexEntry => ({
  projectId: 'p',
  id: 'r',
  title: 'A task',
  status: 'running',
  createdAt: '2026-09-21T10:00:00.000Z',
  archived: false,
  workflow: 'quick-task',
  ...over,
})

describe('sectionOf', () => {
  const cases: [string, Partial<RunIndexEntry>, SectionKey][] = [
    ['waiting needs the operator', { status: 'waiting' }, 'attention'],
    ['review needs the operator', { status: 'review' }, 'attention'],
    ['a plain failure needs the operator', { status: 'failed' }, 'attention'],
    [
      'a failure waiting out a usage limit is queued, not an error',
      { status: 'failed', autoResumeAt: '2026-09-21T11:40:00.000Z' },
      'queued',
    ],
    ['running is running', { status: 'running' }, 'running'],
    ['monitoring is still running and asks nothing', { status: 'running', activity: 'monitoring' }, 'running'],
    ['queued is queued', { status: 'queued' }, 'queued'],
    ['done is finished', { status: 'done' }, 'finished'],
    ['cancelled is finished', { status: 'cancelled' }, 'finished'],
    [
      'a status this client has never seen is shown, under finished',
      { status: 'paused' as RunIndexEntry['status'] },
      'finished',
    ],
  ]

  it.each(cases)('%s', (_name, over, expected) => {
    expect(sectionOf(entry(over))).toBe(expected)
  })
})

describe('buildTaskList on the fixture', () => {
  const ids = (projectId: string | null) =>
    buildTaskList(runs, projectId).map((section) => [
      section.key,
      section.rows.map((row) => row.run.id),
    ])

  it('puts attention first, hides archived runs, and orders each section like the cockpit', () => {
    expect(ids(null)).toEqual([
      ['attention', ['run-waiting', 'run-review', 'run-failed']],
      ['running', ['run-running', 'run-monitoring']],
      ['queued', ['run-scheduled', 'run-queued-first', 'run-queued-second']],
      ['finished', ['run-done-unread', 'run-done-read', 'run-cancelled']],
    ])
  })

  it('narrows to one project and omits the sections that empties', () => {
    expect(ids('kai-phone')).toEqual([
      ['attention', ['run-review']],
      ['running', ['run-monitoring']],
      ['finished', ['run-done-unread']],
    ])
  })

  it('returns nothing for a project with no runs', () => {
    expect(buildTaskList(runs, 'nobody')).toEqual([])
  })

  it('numbers the queue across projects, and keeps the number under a filter', () => {
    const queued = (projectId: string | null) =>
      buildTaskList(runs, projectId)
        .flatMap((section) => section.rows)
        .filter((row) => row.queuePosition !== null)
        .map((row) => [row.run.id, row.queuePosition])

    expect(queued(null)).toEqual([
      ['run-queued-first', 1],
      ['run-queued-second', 2],
    ])
    expect(queued('cezar-pwa')).toEqual([['run-queued-second', 2]])
  })

  it('counts what wants the operator', () => {
    expect(attentionCount(buildTaskList(runs, null))).toBe(3)
    expect(attentionCount(buildTaskList(runs, 'notes'))).toBe(0)
  })
})

describe('compareRuns', () => {
  it('orders scheduled resumes by their appointment, soonest first', () => {
    const later = entry({ id: 'later', status: 'failed', autoResumeAt: '2026-09-21T11:40:00.000Z', createdAt: '2026-09-21T01:00:00.000Z' })
    const sooner = entry({ id: 'sooner', status: 'failed', autoResumeAt: '2026-09-21T11:14:00.000Z', createdAt: '2026-09-20T01:00:00.000Z' })
    expect([later, sooner].sort(compareRuns).map((run) => run.id)).toEqual(['sooner', 'later'])
  })

  it('puts a scheduled resume between running and queued work', () => {
    const scheduled = entry({ id: 's', status: 'failed', autoResumeAt: '2026-09-21T11:40:00.000Z' })
    const running = entry({ id: 'r', status: 'running' })
    const queued = entry({ id: 'q', status: 'queued' })
    expect([queued, scheduled, running].sort(compareRuns).map((run) => run.id)).toEqual(['r', 's', 'q'])
  })

  it('sorts equal statuses newest first', () => {
    const old = entry({ id: 'old', status: 'done', createdAt: '2026-09-20T10:00:00.000Z' })
    const recent = entry({ id: 'new', status: 'done', createdAt: '2026-09-21T10:00:00.000Z' })
    expect([old, recent].sort(compareRuns).map((run) => run.id)).toEqual(['new', 'old'])
  })
})

describe('queuePositions', () => {
  it('ignores archived queued runs and keys by project as well as id', () => {
    const positions = queuePositions([
      entry({ projectId: 'a', id: 'same', status: 'queued', createdAt: '2026-09-21T10:00:00.000Z' }),
      entry({ projectId: 'b', id: 'same', status: 'queued', createdAt: '2026-09-21T10:01:00.000Z' }),
      entry({ projectId: 'a', id: 'gone', status: 'queued', archived: true, createdAt: '2026-09-21T09:00:00.000Z' }),
    ])
    expect(Object.fromEntries(positions)).toEqual({ 'a/same': 1, 'b/same': 2 })
  })
})
