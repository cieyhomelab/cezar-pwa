import type { LimitsResponse, LimitWindow, ProviderLimits } from '@cezar-pwa/shared'
import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en.ts'
import { clampPercent, formatDuration, isStale, limitCards, resetText, windowRows } from './limits.ts'

const NOW = Date.parse('2026-09-25T12:00:00Z')
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString()
const MIN = 60_000
const t = en.limits

describe('formatDuration', () => {
  it.each([
    [0, '<1m'],
    [59_999, '<1m'],
    [MIN, '1m'],
    [45 * MIN, '45m'],
    [60 * MIN, '1h'],
    [134 * MIN + 59_000, '2h 14m'],
    [24 * 60 * MIN, '1d'],
    [(3 * 24 + 4) * 60 * MIN + 30 * MIN, '3d 4h'],
    [-5 * MIN, '<1m'],
  ])('%i ms → %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text)
  })
})

describe('resetText', () => {
  it.each([
    [at(134 * MIN), t.resetsIn('2h 14m')],
    [at(-MIN), t.resetDue],
    [at(0), t.resetDue],
    [undefined, t.noReset],
    ['not a date', t.noReset],
  ])('%s → %s', (resetsAt, text) => {
    expect(resetText(resetsAt, NOW)).toBe(text)
  })
})

describe('isStale', () => {
  it.each([
    [at(0), false],
    [at(-10 * MIN), false],
    [at(-10 * MIN - 1), true],
    [at(-3 * 60 * MIN), true],
    ['garbage', true],
  ])('observed %s → stale %s', (observedAt, stale) => {
    expect(isStale(observedAt, NOW)).toBe(stale)
  })
})

describe('clampPercent', () => {
  it.each([
    [42.4, 42],
    [42.5, 43],
    [-3, 0],
    [130, 100],
  ])('%d → %d', (input, output) => {
    expect(clampPercent(input)).toBe(output)
  })
})

describe('windowRows', () => {
  it('orders 5-hour, weekly, then per-model windows by model', () => {
    const windows: LimitWindow[] = [
      { kind: 'weekly_model', model: 'sonnet', usedPercent: 10, resetsAt: at(60 * MIN) },
      { kind: 'weekly', usedPercent: 33, resetsAt: at(60 * MIN) },
      { kind: 'weekly_model', model: 'opus', usedPercent: 61, resetsAt: at(60 * MIN) },
      { kind: 'five_hour', usedPercent: 42, resetsAt: at(134 * MIN) },
    ]
    expect(windowRows(windows, NOW).map((row) => [row.label, row.reading?.percent])).toEqual([
      [t.window.five_hour, 42],
      [t.window.weekly, 33],
      ['Weekly · Opus', 61],
      ['Weekly · Sonnet', 10],
    ])
  })

  it('shows a missing plan window as not reported — never as 0 or 100', () => {
    const rows = windowRows([{ kind: 'weekly', usedPercent: 80 }], NOW)
    expect(rows[0]).toEqual({ key: 'five_hour', label: t.window.five_hour })
    expect(rows[1]?.reading).toEqual({ percent: 80, reset: t.noReset })
  })

  it('does not invent per-model rows the provider left out', () => {
    expect(windowRows([], NOW).map((row) => row.key)).toEqual(['five_hour', 'weekly'])
  })
})

describe('limitCards', () => {
  const provider = (over: Partial<ProviderLimits>): ProviderLimits => ({
    provider: 'claude',
    account: 'default',
    status: 'ok',
    observedAt: at(-2 * MIN),
    windows: [],
    ...over,
  })
  const response = (providers: ProviderLimits[]): LimitsResponse => ({ observedAt: at(-2 * MIN), providers })

  it('orders Claude before Codex, and the default account first', () => {
    const cards = limitCards(
      response([
        provider({ provider: 'codex' }),
        provider({ account: 'work' }),
        provider({}),
      ]),
      NOW,
    )
    expect(cards.map((card) => card.key)).toEqual(['claude/default', 'claude/work', 'codex/default'])
  })

  it('reads an ok row: its windows, its age, not stale', () => {
    const [card] = limitCards(response([provider({ windows: [{ kind: 'five_hour', usedPercent: 42 }] })]), NOW)
    expect(card).toMatchObject({ state: 'ok', age: en.age.minutes(2), stale: false })
    expect(card?.reason).toBeUndefined()
    expect(card?.windows).toHaveLength(2)
  })

  it('marks a reading older than 10 minutes stale', () => {
    const [card] = limitCards(response([provider({ observedAt: at(-11 * MIN) })]), NOW)
    expect(card).toMatchObject({ stale: true, age: en.age.minutes(11) })
  })

  it('tells a provider switched off in the sidecar config from a failed one', () => {
    const cards = limitCards(
      response([
        provider({ status: 'unavailable', reason: 'off in the sidecar config (LIMITS_CLAUDE)' }),
        provider({ provider: 'codex', status: 'unavailable', reason: 'codex not installed' }),
      ]),
      NOW,
    )
    expect(cards.map((card) => [card.state, card.reason, card.windows])).toEqual([
      ['off', 'off in the sidecar config (LIMITS_CLAUDE)', []],
      ['unavailable', 'codex not installed', []],
    ])
  })
})
