import type { AutomationLogResponse, AutomationsResponse } from '@cezar-pwa/cezar-contract/contract'
import { describe, expect, it } from 'vitest'
import automationLog from '../../test/fixtures/automation-log.json'
import automations from '../../test/fixtures/automations.json'
import { automationRows, eventText, isFailureResult, logRows, resultText, scheduleText, zoneSuffix } from './automations.ts'

const list = automations as unknown as AutomationsResponse
const log = automationLog as unknown as AutomationLogResponse
const withEntries = (...entries: unknown[]) => ({ ...list, automations: entries }) as unknown as AutomationsResponse

describe('scheduleText', () => {
  it.each([
    [{ type: 'daily', hour: 4, minute: 0 }, 'Every day at 04:00'],
    [{ type: 'weekdays', hour: 7, minute: 30 }, 'Weekdays at 07:30'],
    [{ type: 'weekly', day: 2, hour: 2 }, 'Tuesdays at 02:00'],
    [{ type: 'hours', every: 1 }, 'Every hour'],
    [{ type: 'hours', every: 6 }, 'Every 6 hours'],
    // The contract's defaults: 04:00, Monday, every 6 hours.
    [{ type: 'daily' }, 'Every day at 04:00'],
    [{ type: 'weekly' }, 'Mondays at 04:00'],
    [{ type: 'hours' }, 'Every 6 hours'],
    [{ type: 'monthly' }, 'Unknown trigger'],
    [undefined, 'Unknown trigger'],
  ])('%j → %s', (schedule, expected) => {
    expect(scheduleText(schedule)).toBe(expected)
  })
})

describe('zoneSuffix', () => {
  const summer = new Date('2026-07-01T12:00:00Z')
  it.each([
    ['UTC', 'UTC', ''],
    ['UTC', 'Etc/UTC', ''],
    ['UTC', 'Europe/Warsaw', ' (UTC)'],
    ['Europe/Warsaw', 'Europe/Warsaw', ''],
    // Same clock today, even under another name: nothing to explain.
    ['Europe/Berlin', 'Europe/Warsaw', ''],
    ['Not/A_Zone', 'Europe/Warsaw', ''],
    [undefined, 'Europe/Warsaw', ''],
  ])('%s on a phone in %s → %j', (zone, local, expected) => {
    expect(zoneSuffix(zone, local, summer)).toBe(expected)
  })
})

describe('automationRows', () => {
  it("names the server's zone on a schedule when the phone's clock differs", () => {
    const [nightly, triage] = automationRows(list, 'Europe/Warsaw')
    expect(nightly?.trigger).toBe('Every day at 04:00 (UTC)')
    // A GitHub poll has no wall time to explain.
    expect(triage?.trigger).toBe('GitHub: new issue, issue labelled')
  })


  it('reads the fixture', () => {
    expect(automationRows(list, 'UTC')).toEqual([
      {
        id: 'nightly-deps',
        name: 'Nightly dependency check',
        enabled: true,
        canRunNow: true,
        trigger: 'Every day at 04:00',
        lastRun: { at: '2026-09-24T04:00:02.000Z', runId: 'run-nightly-1', status: 'done' },
        nextRunAt: '2026-09-25T04:00:00.000Z',
      },
      {
        id: 'triage-issues',
        name: 'Triage new issues',
        enabled: false,
        canRunNow: false,
        trigger: 'GitHub: new issue, issue labelled',
      },
    ])
  })

  it.each([
    ['the last run falls back to the schedule state', { state: { lastRunAt: '2026-09-23T04:00:00Z' } }, { lastRun: { at: '2026-09-23T04:00:00Z' } }],
    ['an unknown kind keeps the row, without Run now', { kind: 'webhook' }, { trigger: 'Unknown trigger', canRunNow: false }],
    ['an unknown event reads as its raw word', { kind: 'github', events: ['issue.closed'] }, { trigger: 'GitHub: issue.closed' }],
    ['a nameless row reads as its id', { name: '' }, { name: 'a-1' }],
  ])('%s', (_name, extra, expected) => {
    const [row] = automationRows(withEntries({ id: 'a-1', name: 'A', enabled: true, kind: 'schedule', schedule: { type: 'daily' }, ...extra }))
    expect(row).toMatchObject(expected)
  })

  it('a paused automation never shows a next occurrence', () => {
    const [row] = automationRows(withEntries({ id: 'a-1', name: 'A', enabled: false, kind: 'schedule', nextRunAt: '2026-09-25T04:00:00Z' }))
    expect(row).not.toHaveProperty('nextRunAt')
  })

  it('drops a row without an id', () => {
    expect(automationRows(withEntries({ name: 'no id' }))).toEqual([])
  })
})

describe('logRows', () => {
  const names = new Map([
    ['nightly-deps', 'Nightly dependency check'],
    ['triage-issues', 'Triage new issues'],
  ])

  it('reads the fixture, newest first as served', () => {
    expect(logRows(log, names)).toEqual([
      {
        key: 'seq-7',
        at: '2026-09-24T09:00:00.000Z',
        automationName: 'Triage new issues',
        result: 'error',
        reason: 'gh: HTTP 502',
        github: '#41 Login loops on Safari',
      },
      {
        key: 'seq-6',
        at: '2026-09-24T04:00:02.000Z',
        automationName: 'Nightly dependency check',
        result: 'launched',
        run: { id: 'run-nightly-1', title: 'Nightly dependency check', status: 'done' },
      },
      // A deleted automation's rows stay in the log under its id.
      { key: 'seq-5', at: '2026-09-23T08:00:00.000Z', automationName: 'deleted-one', result: 'no-match' },
    ])
  })

  it('keeps a run the join did not find, by id', () => {
    const rows = logRows({ records: [{ seq: 1, ts: 'x', automationId: 'a', revision: 1, result: 'manual', runId: 'r-9' }], runs: {} } as unknown as AutomationLogResponse, names)
    expect(rows[0]?.run).toEqual({ id: 'r-9' })
  })
})

describe('words', () => {
  it.each([
    ['launched', 'Started a task'],
    ['manual', 'Run by hand'],
    ['something-new', 'something-new'],
  ])('result %s → %s', (result, expected) => {
    expect(resultText(result)).toBe(expected)
  })

  it('an event added upstream reads as its raw word', () => {
    expect(eventText('pull_request.merged')).toBe('pull_request.merged')
  })

  it.each([
    ['error', true],
    ['failed', true],
    ['rate-limited', true],
    ['no-match', false],
    ['launched', false],
  ])('%s is a failure: %s', (result, expected) => {
    expect(isFailureResult(result)).toBe(expected)
  })
})
