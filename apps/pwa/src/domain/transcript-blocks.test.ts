import { describe, expect, it } from 'vitest'
import { clipOutput, toolInputText, turnBlocks } from './transcript-blocks.ts'
import type { TranscriptTurn } from './transcript.ts'

const tool = (id: string, extra: Record<string, unknown> = {}) => ({
  kind: 'tool' as const,
  id,
  name: 'Bash',
  toolKind: 'execute' as const,
  title: `Ran ${id}`,
  status: 'completed' as const,
  ...extra,
})

describe('turnBlocks', () => {
  it('takes plan tools out, nests sub-agent items under their parent and keeps orphans', () => {
    const turn: TranscriptTurn = {
      id: 't',
      entries: [
        tool('plan', { toolKind: 'plan' }),
        tool('parent', { toolKind: 'task' }),
        tool('child', { parentItemId: 'parent' }),
        { kind: 'message', id: 'child-msg', role: 'assistant', text: 'sub', parentItemId: 'parent' },
        tool('orphan', { parentItemId: 'gone' }),
        tool('self', { parentItemId: 'self' }),
        { kind: 'note', id: 'n', text: 'note', tone: 'dim' },
      ],
    }
    const blocks = turnBlocks(turn)
    expect(blocks.map((block) => block.id)).toEqual(['parent', 'orphan', 'self', 'n'])
    const parent = blocks[0]
    expect(parent?.kind === 'tool' && parent.children.map((child) => child.id)).toEqual(['child', 'child-msg'])
  })
})

describe('toolInputText', () => {
  it.each([
    [undefined, ''],
    [null, ''],
    ['raw', 'raw'],
    [{ command: 'npm test', description: 'Run tests' }, 'npm test'],
    [{ command: 'ls', timeout: 5 }, '{\n  "command": "ls",\n  "timeout": 5\n}'],
    [{ file_path: 'a.ts' }, '{\n  "file_path": "a.ts"\n}'],
    [[1, 2], '[\n  1,\n  2\n]'],
  ])('%j', (input, expected) => {
    expect(toolInputText(input)).toBe(expected)
  })
})

describe('clipOutput', () => {
  it('keeps short output whole', () => {
    expect(clipOutput('abc', 5)).toEqual({ text: 'abc', clipped: 0 })
  })

  it('keeps the end of long output, where results and errors are', () => {
    expect(clipOutput('0123456789', 4)).toEqual({ text: '6789', clipped: 6 })
  })
})
