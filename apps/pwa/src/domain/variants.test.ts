import type { GroupResponse } from '@cezar-pwa/cezar-contract/contract'
import { describe, expect, it } from 'vitest'
import group from '../../test/fixtures/group.json'
import { changedFileCount, pickOffer, type VariantRow, variantRows } from './variants.ts'

describe('changedFileCount', () => {
  it.each([
    [' a.ts | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)\n', 1],
    [' 3 files changed, 25 insertions(+), 12 deletions(-)', 3],
    [' 12 files changed, 1 deletion(-)', 12],
    // The server sends '' for a removed worktree and for an empty diff alike: unknown, not zero.
    ['', undefined],
    ['(diff failed)', undefined],
  ])('%j → %s', (text, expected) => {
    expect(changedFileCount(text)).toBe(expected)
  })
})

describe('variantRows', () => {
  it('lists the group in variant order and marks the task on screen', () => {
    const rows = variantRows(group as GroupResponse, 'run-variant-b')
    expect(rows).toEqual([
      { id: 'run-variant-a', variant: 'A', title: 'Add a dark theme toggle', status: 'done', archived: false, costUsd: 0.41, changedFiles: 3, current: false },
      { id: 'run-variant-b', variant: 'B', title: 'Add a dark theme toggle', status: 'running', archived: false, changedFiles: 1, current: true },
      { id: 'run-variant-c', variant: 'C', title: 'Add a dark theme toggle', status: 'failed', archived: true, costUsd: 0.08, current: false },
    ])
  })

  it('keeps an entry with an unknown status, drops one without an id, and names a lost letter', () => {
    const rows = variantRows(
      {
        runs: [
          { id: 'x', status: 'hibernating', variant: '', title: 't', archived: false, extra: 1 },
          { status: 'done' },
          null,
        ] as unknown as GroupResponse['runs'],
      },
      'y',
    )
    expect(rows).toEqual([{ id: 'x', variant: '?', title: 't', status: 'hibernating', archived: false, current: false }])
  })
})

const row = (variant: string, status: string, extra: Partial<VariantRow> = {}): VariantRow => ({
  id: variant,
  variant,
  title: '',
  status,
  archived: false,
  current: false,
  ...extra,
})

describe('pickOffer', () => {
  it.each<[string, ReturnType<typeof pickOffer>, VariantRow[]]>([
    ['a settled variant with a live sibling', 'offer', [row('A', 'done', { current: true }), row('B', 'running')]],
    ['a variant in review', 'offer', [row('A', 'review', { current: true }), row('B', 'done')]],
    ['a failed variant can still be kept', 'offer', [row('A', 'failed', { current: true }), row('B', 'done')]],
    // The server answers 409 while the kept run is active.
    ['a running variant', 'wait', [row('A', 'running', { current: true }), row('B', 'done')]],
    ['a variant waiting for an answer', 'wait', [row('A', 'waiting', { current: true }), row('B', 'done')]],
    ['a variant that lost the pick', 'none', [row('A', 'done', { current: true, archived: true }), row('B', 'review')]],
    ['a group already decided', 'none', [row('A', 'review', { current: true }), row('B', 'done', { archived: true })]],
    ['a group of one', 'none', [row('A', 'done', { current: true })]],
    ['the task on screen is not in the answer', 'none', [row('A', 'done'), row('B', 'done')]],
  ])('%s → %s', (_name, expected, rows) => {
    expect(pickOffer(rows)).toBe(expected)
  })
})
