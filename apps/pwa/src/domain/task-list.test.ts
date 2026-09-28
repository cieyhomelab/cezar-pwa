import type { RunIndexEntry, RunsIndexResponse } from '@cezar-pwa/cezar-contract/contract'
import { describe, expect, it } from 'vitest'
import fixture from '../../test/fixtures/runs-index.json'
import {
  attentionCount,
  buildTaskList,
  compareRuns,
  flattenRows,
  foldSubtasks,
  type ListRow,
  type ListSection,
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

describe('foldSubtasks (#101)', () => {
  const child = (id: string, parentRunId: string, over: Partial<RunIndexEntry> = {}) =>
    entry({ id, dispatch: { rootRunId: 'root', parentRunId, kind: 'review' }, ...over })
  const row = (run: RunIndexEntry): ListRow => ({ run, queuePosition: null })

  /** The fold as a nested id tree: `['a', ['b', 'c']]` is `a` with children `b` and `c`. */
  type Tree = (string | Tree)[]
  const shape = (rows: readonly ListRow[]): Tree =>
    rows.flatMap((r) => (r.children ? [r.run.id, shape(r.children)] : [r.run.id]))

  const cases: [string, RunIndexEntry[], Tree][] = [
    ['a flat list stays flat', [entry({ id: 'a' }), entry({ id: 'b' })], ['a', 'b']],
    [
      'children fold under their parent, in the order they came in',
      [entry({ id: 'root' }), entry({ id: 'x' }), child('c2', 'root'), child('c1', 'root')],
      ['root', ['c2', 'c1'], 'x'],
    ],
    [
      'a child sorted above its parent still folds under it, where the parent stands',
      [child('c', 'root'), entry({ id: 'x' }), entry({ id: 'root' })],
      ['x', 'root', ['c']],
    ],
    [
      'a grandchild folds into its direct parent, not the root',
      [entry({ id: 'root' }), child('c', 'root'), child('g', 'c')],
      ['root', ['c', ['g']]],
    ],
    [
      'an orphan whose parent is not in the section stays top-level',
      [entry({ id: 'x' }), child('c', 'elsewhere')],
      ['x', 'c'],
    ],
    [
      'a grandchild whose parent is missing stays top-level even with the root present',
      [entry({ id: 'root' }), child('g', 'missing')],
      ['root', 'g'],
    ],
    [
      'a parent in another project is not this child\'s parent',
      [entry({ id: 'root', projectId: 'other' }), child('c', 'root')],
      ['root', 'c'],
    ],
    [
      'a cycle roots every member instead of hanging',
      [child('a', 'b'), child('b', 'a')],
      ['a', 'b'],
    ],
    ['a run that names itself as parent is a root', [child('a', 'a')], ['a']],
    [
      'a duplicate key is painted once',
      [entry({ id: 'root' }), entry({ id: 'root' })],
      ['root'],
    ],
  ]

  it.each(cases)('%s', (_name, input, expected) => {
    expect(shape(foldSubtasks(input.map(row)))).toEqual(expected)
  })

  it('carries each row as it was, queue position included', () => {
    const [parent] = foldSubtasks([
      { run: entry({ id: 'root', status: 'queued' }), queuePosition: 1 },
      { run: child('c', 'root', { status: 'queued' }), queuePosition: 2 },
    ])
    expect(parent?.queuePosition).toBe(1)
    expect(parent?.children?.[0]?.queuePosition).toBe(2)
  })

  it('flattenRows lists every folded run, parent first', () => {
    const rows = foldSubtasks([entry({ id: 'root' }), child('c', 'root'), child('g', 'c'), entry({ id: 'x' })].map(row))
    expect(flattenRows(rows).map((r) => r.run.id)).toEqual(['root', 'c', 'g', 'x'])
  })
})

describe('buildTaskList folding (#101)', () => {
  const tree = [
    entry({ id: 'root', status: 'running', createdAt: '2026-09-21T10:00:00.000Z' }),
    entry({ id: 'busy', status: 'running', createdAt: '2026-09-21T10:01:00.000Z', dispatch: { rootRunId: 'root', parentRunId: 'root' } }),
    entry({ id: 'asks', status: 'waiting', createdAt: '2026-09-21T10:02:00.000Z', dispatch: { rootRunId: 'root', parentRunId: 'root' } }),
    entry({ id: 'deep', status: 'running', createdAt: '2026-09-21T10:03:00.000Z', dispatch: { rootRunId: 'root', parentRunId: 'busy' } }),
    entry({ id: 'fin', status: 'done', createdAt: '2026-09-21T10:04:00.000Z', dispatch: { rootRunId: 'root', parentRunId: 'root' } }),
    entry({ id: 'w-root', status: 'waiting', createdAt: '2026-09-21T09:00:00.000Z' }),
    entry({ id: 'w-child', status: 'review', createdAt: '2026-09-21T09:01:00.000Z', dispatch: { rootRunId: 'w-root', parentRunId: 'w-root' } }),
  ]
  const sections = buildTaskList(tree, null)
  const section = (key: SectionKey) => sections.find((s) => s.key === key) as ListSection

  it('folds a running child and grandchild under the running parent', () => {
    const [root] = section('running').rows
    expect(section('running').rows.map((r) => r.run.id)).toEqual(['root'])
    expect(root?.children?.map((r) => r.run.id)).toEqual(['busy'])
    expect(root?.children?.[0]?.children?.map((r) => r.run.id)).toEqual(['deep'])
  })

  it('never hides a child that needs attention, and never folds the attention section', () => {
    expect(section('attention').rows.map((r) => [r.run.id, r.children])).toEqual([
      ['asks', undefined],
      ['w-root', undefined],
      ['w-child', undefined],
    ])
    expect(attentionCount(sections)).toBe(3)
  })

  it('leaves a child whose parent is in another section flat', () => {
    expect(section('finished').rows.map((r) => [r.run.id, r.children])).toEqual([['fin', undefined]])
  })
})
