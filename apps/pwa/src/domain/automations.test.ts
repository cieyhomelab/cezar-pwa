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
      {
        id: 'jira-triage',
        name: 'Triage Jira issues',
        enabled: true,
        // Run now is schedule-only on the server.
        canRunNow: false,
        trigger: 'Jira: new issue, issue status changed',
      },
    ])
  })

  const association = { kind: 'linear', source: { id: 's', webUrl: 'https://linear.app/acme' }, externalId: 't', externalName: 'Team' }
  it.each([
    ['a Linear poll', { trackerTrigger: { events: ['issue.opened'], association } }, 'Linear: new issue'],
    ['a tracker poll with no events', { trackerTrigger: { events: [], association } }, 'Linear activity'],
    ['a provider added upstream', { trackerTrigger: { events: ['issue.labeled'], association: { ...association, kind: 'github-projects' } } }, 'Tracker: issue labelled'],
    ['a tracker event added upstream', { trackerTrigger: { events: ['issue.closed'], association } }, 'Linear: issue.closed'],
    ['no trackerTrigger at all', {}, 'Tracker activity'],
    ['a malformed trackerTrigger', { trackerTrigger: 'jira' }, 'Tracker activity'],
    ['a prototype key as provider', { trackerTrigger: { events: ['constructor'], association: { ...association, kind: 'constructor' } } }, 'Tracker: constructor'],
  ])('tracker: %s', (_name, extra, expected) => {
    const [row] = automationRows(withEntries({ id: 't-1', name: 'T', enabled: true, kind: 'tracker', ...extra }))
    expect(row).toMatchObject({ trigger: expected, canRunNow: false })
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
    expect(logRows(log, new Map([...names, ['jira-triage', 'Triage Jira issues']]))).toEqual([
      {
        key: 'seq-8',
        at: '2026-09-27T11:00:00.000Z',
        automationName: 'Triage Jira issues',
        result: 'launched',
        subject: { text: 'PWA-12 Crash on the Limits screen', url: 'https://example.atlassian.net/browse/PWA-12' },
        run: { id: 'run-jira-1', title: 'Triage PWA-12', status: 'running' },
      },
      {
        key: 'seq-7',
        at: '2026-09-24T09:00:00.000Z',
        automationName: 'Triage new issues',
        result: 'error',
        reason: 'gh: HTTP 502',
        subject: { text: '#41 Login loops on Safari' },
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

  const record = (extra: object) =>
    logRows({ records: [{ seq: 1, ts: 'x', automationId: 'a', revision: 1, result: 'launched', ...extra }], runs: {} } as unknown as AutomationLogResponse, names)[0]
  it.each([
    ['a tracker key alone', { trackerKey: 'ENG-3' }, { text: 'ENG-3' }],
    ['a tracker title alone', { trackerTitle: 'Fix it' }, { text: 'Fix it' }],
    ['a Linear issue with its link', { trackerKey: 'ENG-3', trackerTitle: 'Fix it', trackerUrl: 'https://linear.app/acme/issue/ENG-3' }, { text: 'ENG-3 Fix it', url: 'https://linear.app/acme/issue/ENG-3' }],
    ['a non-http tracker link stays text', { trackerKey: 'ENG-3', trackerUrl: 'javascript:alert(1)' }, { text: 'ENG-3' }],
    ['a GitHub number alone', { githubNumber: 5 }, { text: '#5' }],
    ['a GitHub record with its link', { githubNumber: 5, githubTitle: 'Bug', githubUrl: 'https://github.com/o/r/issues/5' }, { text: '#5 Bug', url: 'https://github.com/o/r/issues/5' }],
    ['GitHub wins over tracker fields', { githubNumber: 5, trackerKey: 'ENG-3', trackerUrl: 'https://linear.app/x' }, { text: '#5' }],
  ])('subject: %s', (_name, extra, expected) => {
    expect(record(extra)?.subject).toEqual(expected)
  })

  it('a record that matched nothing has no subject', () => {
    expect(record({})).not.toHaveProperty('subject')
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

  it.each([
    ['issue.opened', 'new issue'],
    ['issue.status_changed', 'issue status changed'],
    ['issue.labeled', 'issue labelled'],
    ['issue.unlabeled', 'issue unlabelled'],
  ])('tracker event %s → %s', (event, expected) => {
    expect(eventText(event)).toBe(expected)
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
