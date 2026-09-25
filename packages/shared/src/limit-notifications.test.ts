import { describe, expect, it } from 'vitest'
import type { LimitWindow, ProviderLimits } from './limits.ts'
import { limitCrossings, limitLevel, limitWindowKey, type LimitMemory } from './notifications.ts'

const NOW = new Date('2026-09-25T12:00:00Z')
const RESET = '2026-09-25T14:00:00Z'

const row = (windows: LimitWindow[], over: Partial<ProviderLimits> = {}): ProviderLimits => ({
  provider: 'claude',
  account: 'default',
  status: 'ok',
  observedAt: NOW.toISOString(),
  windows,
  ...over,
})

const fiveHour = (usedPercent: number, resetsAt: string | null = RESET): LimitWindow => ({
  kind: 'five_hour',
  usedPercent,
  ...(resetsAt ? { resetsAt } : {}),
})

const KEY = 'claude/default/five_hour'

describe('limitLevel', () => {
  const rows: [number, number, ReturnType<typeof limitLevel>][] = [
    [0, 90, undefined],
    [89.9, 90, undefined],
    [90, 90, 'near'],
    [99.9, 90, 'near'],
    [100, 90, 'exhausted'],
    [104, 90, 'exhausted'],
    [80, 75, 'near'],
    [Number.NaN, 90, undefined],
  ]
  it.each(rows)('%s%% at threshold %s → %s', (used, threshold, expected) => {
    expect(limitLevel(used, threshold)).toBe(expected)
  })
})

describe('limitWindowKey', () => {
  it('keys the per-model weekly window by its model', () => {
    expect(limitWindowKey('claude', 'work', { kind: 'weekly_model', model: 'opus' })).toBe('claude/work/weekly_model:opus')
    expect(limitWindowKey('codex', 'default', { kind: 'weekly' })).toBe('codex/default/weekly')
  })
})

describe('limitCrossings', () => {
  type Case = {
    name: string
    windows: LimitWindow[]
    memory?: Record<string, LimitMemory>
    busy?: boolean
    rowOver?: Partial<ProviderLimits>
    levels: string[]
    memoryAfter: Record<string, LimitMemory>
  }
  const cases: Case[] = [
    { name: 'under the threshold: nothing', windows: [fiveHour(50)], levels: [], memoryAfter: {} },
    {
      name: 'entering the threshold while busy notifies once',
      windows: [fiveHour(92)],
      levels: ['near'],
      memoryAfter: { [KEY]: { level: 'near', resetsAt: RESET } },
    },
    {
      name: 'still near on the next poll: silent',
      windows: [fiveHour(95)],
      memory: { [KEY]: { level: 'near', resetsAt: RESET } },
      levels: [],
      memoryAfter: { [KEY]: { level: 'near', resetsAt: RESET } },
    },
    {
      name: 'near → exhausted is news',
      windows: [fiveHour(100)],
      memory: { [KEY]: { level: 'near', resetsAt: RESET } },
      levels: ['exhausted'],
      memoryAfter: { [KEY]: { level: 'exhausted', resetsAt: RESET } },
    },
    {
      name: 'straight to exhausted notifies once, as exhausted',
      windows: [fiveHour(100)],
      levels: ['exhausted'],
      memoryAfter: { [KEY]: { level: 'exhausted', resetsAt: RESET } },
    },
    {
      name: 'exhausted then near again before the reset: silent',
      windows: [fiveHour(97)],
      memory: { [KEY]: { level: 'exhausted', resetsAt: RESET } },
      levels: [],
      memoryAfter: { [KEY]: { level: 'exhausted', resetsAt: RESET } },
    },
    {
      name: 'nothing queued or running: silent and not remembered',
      windows: [fiveHour(95)],
      busy: false,
      levels: [],
      memoryAfter: {},
    },
    {
      name: 'back under the threshold: the window reset, memory forgotten',
      windows: [fiveHour(3, '2026-09-25T19:00:00Z')],
      memory: { [KEY]: { level: 'exhausted', resetsAt: RESET } },
      levels: [],
      memoryAfter: {},
    },
    {
      name: 'the recorded reset has passed: the window announces again',
      windows: [fiveHour(93, '2026-09-25T16:00:00Z')],
      memory: { [KEY]: { level: 'near', resetsAt: '2026-09-25T11:00:00Z' } },
      levels: ['near'],
      memoryAfter: { [KEY]: { level: 'near', resetsAt: '2026-09-25T16:00:00Z' } },
    },
    {
      name: 'an unavailable row changes nothing',
      windows: [],
      rowOver: { status: 'unavailable', reason: 'codex not installed' },
      memory: { [KEY]: { level: 'near', resetsAt: RESET } },
      levels: [],
      memoryAfter: { [KEY]: { level: 'near', resetsAt: RESET } },
    },
    {
      name: 'an absent window is not a reset',
      windows: [{ kind: 'weekly', usedPercent: 10 }],
      memory: { [KEY]: { level: 'near', resetsAt: RESET } },
      levels: [],
      memoryAfter: { [KEY]: { level: 'near', resetsAt: RESET } },
    },
    {
      name: 'a stale reading (its reset already passed): silent and not remembered',
      windows: [fiveHour(95, '2026-09-25T11:00:00Z')],
      levels: [],
      memoryAfter: {},
    },
    {
      name: 'a stale reading after the recorded reset passed: silent, memory forgotten',
      windows: [fiveHour(100, '2026-09-25T11:00:00Z')],
      memory: { [KEY]: { level: 'exhausted', resetsAt: '2026-09-25T11:00:00Z' } },
      levels: [],
      memoryAfter: {},
    },
    {
      name: 'a stale reading does not drop a newer memory',
      windows: [fiveHour(3, '2026-09-25T11:00:00Z')],
      memory: { [KEY]: { level: 'near', resetsAt: RESET } },
      levels: [],
      memoryAfter: { [KEY]: { level: 'near', resetsAt: RESET } },
    },
    {
      name: 'no reset time given: remembered until it drops back under',
      windows: [fiveHour(91, null)],
      levels: ['near'],
      memoryAfter: { [KEY]: { level: 'near' } },
    },
  ]

  it.each(cases)('$name', ({ windows, memory = {}, busy = true, rowOver, levels, memoryAfter }) => {
    const result = limitCrossings({ providers: [row(windows, rowOver)], memory, threshold: 90, busy, now: NOW })
    expect(result.notify.map((payload) => payload.level)).toEqual(levels)
    expect(result.memory).toEqual(memoryAfter)
  })

  it('keeps each window of each account apart', () => {
    const result = limitCrossings({
      providers: [
        row([fiveHour(95), { kind: 'weekly_model', model: 'opus', usedPercent: 100 }]),
        row([{ kind: 'weekly', usedPercent: 91 }], { provider: 'codex', account: 'work' }),
      ],
      memory: {},
      threshold: 90,
      busy: true,
      now: NOW,
    })
    expect(Object.keys(result.memory).sort()).toEqual([
      'claude/default/five_hour',
      'claude/default/weekly_model:opus',
      'codex/work/weekly',
    ])
    expect(result.notify).toHaveLength(3)
  })

  it('a stale full reading does not ring on every poll', () => {
    let memory: Record<string, LimitMemory> = {}
    const rings: number[] = []
    for (let poll = 0; poll < 3; poll++) {
      const result = limitCrossings({
        providers: [row([fiveHour(100, '2026-09-25T11:00:00Z')])],
        memory,
        threshold: 90,
        busy: true,
        now: NOW,
      })
      rings.push(result.notify.length)
      memory = result.memory
    }
    expect(rings).toEqual([0, 0, 0])
  })

  it('does not mutate the memory it was given', () => {
    const memory = { [KEY]: { level: 'near', resetsAt: RESET } as LimitMemory }
    limitCrossings({ providers: [row([fiveHour(100)])], memory, threshold: 90, busy: true, now: NOW })
    expect(memory[KEY]?.level).toBe('near')
  })

  it('names the account, window and reset — and nothing else', () => {
    const [payload] = limitCrossings({
      providers: [row([{ kind: 'weekly_model', model: 'opus', usedPercent: 90.6, resetsAt: RESET }], { account: 'work' })],
      memory: {},
      threshold: 90,
      busy: true,
      now: NOW,
    }).notify
    expect(payload).toEqual({
      kind: 'limit',
      provider: 'claude',
      account: 'work',
      window: 'weekly_model',
      model: 'opus',
      level: 'near',
      usedPercent: 91,
      resetsAt: RESET,
    })
  })
})
