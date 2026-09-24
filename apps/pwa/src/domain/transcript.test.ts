import type { RunEvent, RunHistoryPage } from '@cezar-pwa/cezar-contract/contract'
import { describe, expect, it } from 'vitest'
import liveContext from '../../test/fixtures/history-context.live-0.11.0.json'
import livePage from '../../test/fixtures/history.live-0.11.0.json'
import recording from '../../test/fixtures/transcript.ndjson?raw'
import {
  createDraft,
  finish,
  latestPlan,
  mergeBySeq,
  planProgress,
  reduceTranscript,
  step,
  stripMarkers,
  transcriptFooter,
  v1ToolDisplay,
  type Transcript,
  type TranscriptEntry,
} from './transcript.ts'

const ev = (seq: number, type: string, payload: Record<string, unknown> = {}): RunEvent => ({
  seq,
  ts: `2026-09-21T08:00:${String(seq % 60).padStart(2, '0')}.000Z`,
  type,
  ...payload,
})

const parseNdjson = (text: string): RunEvent[] =>
  text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as RunEvent)

const entries = (transcript: Transcript): TranscriptEntry[] => transcript.turns.flatMap((turn) => turn.entries)

describe('reduceTranscript — the hand-written recording', () => {
  const transcript = reduceTranscript(parseNdjson(recording))
  const [first, second] = transcript.turns

  it('opens a turn per user message, attaching the v2 turn.started to it', () => {
    expect(transcript.turns).toHaveLength(2)
    expect(first?.turnId).toBe('turn_1')
    expect(second?.turnId).toBe('turn_2')
    expect(second?.userMessage).toEqual({ text: 'Use dev.', imageCount: 1, ts: '2026-09-21T08:05:00.000Z' })
    expect(first?.completed).toEqual({ stopReason: 'end_turn', costUsd: 0.12, ts: '2026-09-21T08:00:09.000Z' })
  })

  it('shows each tool once: v2 wins within the turn and its v1 twin is dropped', () => {
    const tools = entries(transcript).filter((entry) => entry.kind === 'tool')
    expect(tools.map((tool) => tool.id)).toEqual(['toolu_1', 'toolu_2', 'toolu_3', 'toolu_4', 'v1:29'])
    const bash = tools[0]
    // item.completed overwrites what the deltas built.
    expect(bash).toMatchObject({ status: 'completed', output: 'ok 1\nok 2\n', exitCode: 0 })
  })

  it('drops the v1 prose twin but keeps prose only v1 carries', () => {
    const messages = entries(transcript).filter((entry) => entry.kind === 'message')
    // The marker lines go, the newline before them stays: upstream's strip, byte for byte.
    expect(messages.map((message) => message.kind === 'message' && message.text)).toEqual([
      'Tests **pass**.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n',
      'A result the v2 stream never described.',
    ])
  })

  it('strips the protocol markers from agent text', () => {
    const text = entries(transcript).find((entry) => entry.id === 'item_1')
    expect(text?.kind === 'message' && text.text).not.toMatch(/CEZ:/)
  })

  it('skips an unknown event type, an unknown item kind, an id-less item and a non-object item', () => {
    const ids = entries(transcript).map((entry) => entry.id)
    expect(ids).not.toContain('item_9')
    expect(entries(transcript).some((entry) => entry.kind === 'message' && entry.text === 'no id')).toBe(false)
  })

  it('keeps the plan snapshot on the turn that sent it', () => {
    expect(latestPlan(transcript)?.map((entry) => entry.status)).toEqual([
      'completed',
      'in_progress',
      'pending',
      'cancelled',
    ])
  })

  it('resolves the ask card with the next user message, keeping only well-formed questions', () => {
    const ask = entries(transcript).find((entry) => entry.kind === 'ask')
    expect(ask).toMatchObject({ id: 'ask-1', resolved: true, answer: 'Use dev.' })
    expect(ask?.kind === 'ask' && ask.questions.map((question) => question.header)).toEqual(['Branch'])
  })

  it('renders the lines that have no v2 twin', () => {
    expect(first?.entries[0]).toMatchObject({ kind: 'note', tone: 'dim' })
    expect(second?.entries).toEqual([
      { kind: 'note', id: 'v2:28', text: 'rate limited, retrying', tone: 'danger' },
      {
        kind: 'tool',
        id: 'v1:29',
        name: 'check',
        toolKind: 'execute',
        title: 'Ran npm run lint',
        status: 'failed',
        output: '1 error',
        exitCode: 1,
      },
      { kind: 'note', id: 'v1:30', text: 'step check failed — lint failed', tone: 'danger' },
      { kind: 'image', id: 'v1:31', name: 'screenshot.png', file: '2.png' },
    ])
    expect(transcript.sessionEnded).toEqual({ reason: 'end_turn' })
  })
})

describe('reduceTranscript — the live page from the instance (v0.11.0)', () => {
  const page = livePage as unknown as RunHistoryPage
  const transcript = reduceTranscript(page.events)
  const all = entries(transcript)

  it('shows every tool exactly once, although the file carries each one twice', () => {
    const v2ToolIds = new Set(
      page.events
        .filter((event) => event.type === 'item.completed' && (event.item as { kind?: string }).kind === 'tool')
        .map((event) => (event.item as { id: string }).id),
    )
    const tools = all.filter((entry) => entry.kind === 'tool')
    expect(page.events.filter((event) => event.type === 'tool-call').length).toBeGreaterThan(0)
    expect(tools.map((tool) => tool.id).sort()).toEqual([...v2ToolIds].sort())
  })

  it('keeps the user messages, which exist only in v1', () => {
    const userMessages = page.events.filter((event) => event.type === 'user-message')
    expect(transcript.turns.filter((turn) => turn.userMessage).length).toBe(userMessages.length)
  })

  it('shows no agent message twice', () => {
    const texts = all.filter((entry) => entry.kind === 'message').map((entry) => entry.kind === 'message' && entry.text)
    expect(new Set(texts).size).toBe(texts.length)
    expect(texts.length).toBeGreaterThan(0)
  })

  it('folds the context together with the page without losing anything', () => {
    const merged = mergeBySeq(liveContext.contextEvents as RunEvent[], page.events)
    expect(merged.length).toBeGreaterThanOrEqual(page.events.length)
    expect(() => reduceTranscript(merged)).not.toThrow()
  })
})

describe('reduceTranscript — robustness', () => {
  it('never throws on garbage, and garbage costs only itself', () => {
    const garbage = [
      null,
      42,
      'text',
      { seq: 1 },
      ev(2, 'item.delta', { itemId: 'nope', field: 'text', delta: 'x' }),
      ev(3, 'tool-result', { toolCallId: 'nope', result: 'x' }),
      ev(4, 'plan.updated', { entries: 'not an array' }),
      ev(5, 'turn.completed', { turnId: 'ghost' }),
      ev(6, 'text', { text: 'survivor' }),
    ] as unknown as RunEvent[]
    const transcript = reduceTranscript(garbage)
    expect(entries(transcript)).toEqual([{ kind: 'message', id: 'v1:6', role: 'assistant', text: 'survivor' }])
  })

  it('appends deltas to the live item and ignores a delta to the wrong field', () => {
    const transcript = reduceTranscript([
      ev(1, 'item.started', { stepId: 's', item: { kind: 'message', id: 'm', role: 'assistant', text: 'Hel' } }),
      ev(2, 'item.delta', { stepId: 's', itemId: 'm', field: 'text', delta: 'lo' }),
      ev(3, 'item.delta', { stepId: 's', itemId: 'm', field: 'output', delta: 'ignored' }),
      ev(4, 'item.started', { stepId: 's', item: { kind: 'tool', id: 't', name: 'Bash', toolKind: 'execute', title: 'Ran x', status: 'running' } }),
      ev(5, 'item.delta', { stepId: 's', itemId: 't', field: 'output', delta: 'line' }),
    ])
    expect(entries(transcript)).toMatchObject([
      { id: 'm', text: 'Hello' },
      { id: 't', output: 'line' },
    ])
  })

  it('keeps items of two steps apart even when their ids collide', () => {
    const transcript = reduceTranscript([
      ev(1, 'item.completed', { stepId: 'a', item: { kind: 'message', id: 'item_1', role: 'assistant', text: 'from a' } }),
      ev(2, 'user-message', { text: 'next' }),
      ev(3, 'item.completed', { stepId: 'b', item: { kind: 'message', id: 'item_1', role: 'assistant', text: 'from b' } }),
    ])
    expect(transcript.turns.map((turn) => turn.entries.map((entry) => entry.kind === 'message' && entry.text))).toEqual([
      ['from a'],
      ['from b'],
    ])
  })

  it('is the same fold whether driven by reduceTranscript or step by step', () => {
    const events = parseNdjson(recording)
    const draft = createDraft()
    for (const event of events) step(draft, event)
    expect(finish(draft)).toEqual(reduceTranscript(events))
  })

  it('recovers the plan from a pre-v2 TodoWrite call', () => {
    const transcript = reduceTranscript([
      ev(1, 'tool-call', {
        id: 'c1',
        tool: 'TodoWrite',
        input: { todos: [{ content: 'One', status: 'completed' }, { content: 'Two', status: 'weird' }] },
      }),
    ])
    expect(latestPlan(transcript)).toEqual([
      { content: 'One', status: 'completed' },
      { content: 'Two', status: 'pending' },
    ])
  })

  it('reassembles a legacy per-token v1 run and drops it as the v2 twin', () => {
    const transcript = reduceTranscript([
      ev(1, 'item.completed', { item: { kind: 'message', id: 'm', role: 'assistant', text: 'github.com/mercato' } }),
      ev(2, 'text', { text: 'github' }),
      ev(3, 'text', { text: '.com/merc' }),
      ev(4, 'text', { text: 'ato' }),
    ])
    expect(entries(transcript).map((entry) => entry.id)).toEqual(['m'])
  })

  it('hides a trailing ask block while the turn is live, and shows it when no card came', () => {
    const events = [
      ev(1, 'item.completed', {
        item: { kind: 'message', id: 'm', role: 'assistant', text: 'Pick one.\nCEZ:ASK {"questions":[]}' },
      }),
    ]
    const text = (transcript: Transcript) => {
      const entry = entries(transcript)[0]
      return entry?.kind === 'message' ? entry.text : undefined
    }
    expect(text(reduceTranscript(events, { activeTurn: true }))).toBe('Pick one.')
    expect(text(reduceTranscript(events))).toBe('Pick one.\nCEZ:ASK {"questions":[]}')
  })
})

describe('stripMarkers', () => {
  it.each([
    ['Done.\nCEZ:DONE', false, 'Done.'],
    ['Watching.\n\nCEZ:MONITORING', false, 'Watching.'],
    ['Opened it.\nCEZ:PR=12\nCEZ:ISSUE=3\nCEZ:TITLE=shipping', false, 'Opened it.'],
    ['Q?\nCEZ:ASK {"a":1}', true, 'Q?'],
    ['Q?\nCEZ:ASK {"a":1}', false, 'Q?\nCEZ:ASK {"a":1}'],
    ['mentions CEZ:DONE mid-sentence and goes on', false, 'mentions CEZ:DONE mid-sentence and goes on'],
  ])('%j (stripAsk %s) → %j', (input, stripAsk, expected) => {
    expect(stripMarkers(input, stripAsk)).toBe(expected)
  })
})

describe('transcriptFooter', () => {
  it.each([
    ['waiting', undefined, { state: 'waiting' }],
    ['failed', 'boom', { state: 'failed', error: 'boom' }],
    ['failed', undefined, { state: 'failed' }],
    ['review', undefined, { state: 'review' }],
    ['done', undefined, { state: 'closed' }],
    ['cancelled', undefined, { state: 'closed' }],
    ['running', undefined, null],
    ['queued', undefined, null],
    ['a-status-from-the-future', undefined, null],
  ] as const)('%s → %j', (status, error, expected) => {
    expect(transcriptFooter(status, error)).toEqual(expected)
  })
})

describe('plan helpers', () => {
  it('counts cancelled entries out of the denominator', () => {
    expect(
      planProgress([
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'in_progress' },
        { content: 'c', status: 'cancelled' },
      ]),
    ).toEqual({ done: 1, total: 2 })
  })

  it('takes the latest snapshot across turns, an empty one included', () => {
    const transcript = reduceTranscript([
      ev(1, 'plan.updated', { entries: [{ content: 'a', status: 'pending' }] }),
      ev(2, 'user-message', { text: 'go on' }),
      ev(3, 'plan.updated', { entries: [] }),
    ])
    expect(latestPlan(transcript)).toEqual([])
    expect(latestPlan(reduceTranscript([]))).toBeUndefined()
  })
})

describe('v1ToolDisplay', () => {
  it.each([
    ['Bash', { command: 'npm   test\n' }, { toolKind: 'execute', title: 'Ran npm test' }],
    ['Read', { file_path: 'src/a.ts' }, { toolKind: 'read', title: 'Read src/a.ts' }],
    ['Edit', {}, { toolKind: 'edit', title: 'Edit' }],
    ['Grep', { pattern: 'foo' }, { toolKind: 'search', title: 'Search foo' }],
    ['TodoWrite', { todos: [] }, { toolKind: 'plan', title: 'Update plan' }],
    ['mcp__thing', null, { toolKind: 'other', title: 'mcp__thing' }],
  ])('%s', (name, input, expected) => {
    expect(v1ToolDisplay(name, input)).toEqual(expected)
  })
})
